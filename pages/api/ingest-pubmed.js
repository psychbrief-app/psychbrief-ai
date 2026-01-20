export default async function handler(req, res) {
  try {
    console.log("🔵 PubMed ingestion started");

const proto = req.headers["x-forwarded-proto"] || "https";
const host = req.headers["x-forwarded-host"] || req.headers.host;
const baseUrl = `${proto}://${host}`;

    async function isClinicallyRelevant(abstract) {
  const resp = await fetch(`${baseUrl}/api/relevance`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ abstract }),
  });

  const data = await resp.json();
  return data.relevant === true;
}

    // 1️⃣ Search PubMed 
    const searchUrl =
  "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi" +
  "?db=pubmed" +
  "&term=(" +
    "(" +
      "Depressive Disorder[MeSH Terms] OR " +
      "Anxiety Disorders[MeSH Terms] OR " +
      "Schizophrenia[MeSH Terms] OR " +
      "Bipolar Disorder[MeSH Terms] OR " +
      "Post-Traumatic Stress Disorder[MeSH Terms] OR " +
      "Attention Deficit Disorder with Hyperactivity[MeSH Terms] OR " +
      "Sleep Wake Disorders[MeSH Terms]" +
    ")" +
    " AND (" +
      "psychotherapy OR pharmacotherapy OR treatment OR intervention" +
    ")" +
    " AND (" +
  "Randomized Controlled Trial[Publication Type] OR " +
  "Clinical Trial[Publication Type] OR " +
  "Controlled Clinical Trial[Publication Type] OR " +
  "Pragmatic Clinical Trial[Publication Type] OR " +
  "Meta-Analysis[Publication Type] OR " +
  "Observational Study[Publication Type]" +
")" +
    " AND Humans[MeSH Terms]" +
    " AND english[lang]" +      
    " NOT (" +
      "prevalence OR epidemiology OR protocol OR validation OR reliability" +
      " OR stroke OR fibromyalgia OR \"restless legs\"" +
    ")" +
  ")" +
  "&retmax=45" +
  "&sort=pub+date" +
  "&reldate=60" +
  "&datetype=pdat" +
  "&retmode=json";

    const searchResp = await fetch(searchUrl);
    const searchData = await searchResp.json();

    const ids = searchData.esearchresult.idlist;
    if (!ids.length) {
      return res.status(200).json({ message: "No PubMed IDs found" });
    }

    console.log("📌 PubMed IDs:", ids);

    // 2️⃣ Fetch abstracts
    const fetchUrl =
      "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi" +
      `?db=pubmed&id=${ids.join(",")}` +
      "&retmode=xml";

    const fetchResp = await fetch(fetchUrl);
    const xmlText = await fetchResp.text();

// 3️⃣ Parse PubMed XML into article objects (pmid/title/journal/doi/authors/abstract)
function decodeEntities(s = "") {
  if (!s) return "";

  return s
    // basic named entities
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")

    // numeric hex entities: &#x10d;
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )

    // numeric decimal entities: &#246;
    .replace(/&#([0-9]+);/g, (_, num) =>
      String.fromCodePoint(parseInt(num, 10))
    );
}

function pickFirst(xml, regex) {
  const m = xml.match(regex);
  return m ? decodeEntities(m[1]).trim() : null;
}

function pickAll(xml, regex) {
  return [...xml.matchAll(regex)]
    .map((m) => decodeEntities(m[1]).trim())
    .filter(Boolean);
}

function parsePubmedArticles(xmlText) {
  const articles = xmlText
    .split("<PubmedArticle>")
    .slice(1)
    .map((chunk) => "<PubmedArticle>" + chunk);

  return articles.map((a) => {
    const pmid = pickFirst(a, /<PMID[^>]*>(.*?)<\/PMID>/s);
    const title = pickFirst(a, /<ArticleTitle[^>]*>(.*?)<\/ArticleTitle>/s);

  const journal_title = pickFirst(
  a,
  /<Journal>[\s\S]*?<Title>(.*?)<\/Title>[\s\S]*?<\/Journal>/s
);

const journal_abbrev = pickFirst(
  a,
  /<Journal>[\s\S]*?<ISOAbbreviation>(.*?)<\/ISOAbbreviation>[\s\S]*?<\/Journal>/s
);

// what you’ll pass as "journal" (UI/display default)
const journal = journal_abbrev || journal_title || null;

    const doi = pickFirst(a, /<ArticleId[^>]*IdType="doi"[^>]*>(.*?)<\/ArticleId>/s);

    // Abstract (join sections)
    const abstractParts = pickAll(a, /<AbstractText[^>]*>(.*?)<\/AbstractText>/gs);
    const abstract = abstractParts.length ? abstractParts.join(" ") : null;

    // Authors: LastName + Initials
    const authorBlocks = [...a.matchAll(/<Author\b[\s\S]*?<\/Author>/g)].map((m) => m[0]);
    const authors = authorBlocks
      .map((block) => {
        const last = pickFirst(block, /<LastName[^>]*>(.*?)<\/LastName>/s);
        const initials = pickFirst(block, /<Initials[^>]*>(.*?)<\/Initials>/s);
        if (!last || !initials) return null;
        return `${last} ${initials}`;
      })
      .filter(Boolean);

    return { pmid, title, journal, journal_abbrev, doi, authors, abstract };
  });
}

const articles = parsePubmedArticles(xmlText).filter((a) => a.abstract);
console.log(`📄 Parsed ${articles.length} PubMed articles with abstracts`);

// 4️⃣ Run relevance/actionability on each *article.abstract*, then extract using abstract + metadata
const results = [];

for (const a of articles) {
  const abstract = a.abstract;

  const relevant = await isClinicallyRelevant(abstract);
  if (!relevant) {
    console.log("⛔ Skipped non-clinical study");
    continue;
  }

 // 🔍 Actionability check
const actionResp = await fetch(`${baseUrl}/api/actionability`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ abstract }),
});

// 🚨 FAIL FAST if the internal API call itself failed
if (!actionResp.ok) {
  throw new Error(`Actionability API failed: ${actionResp.status}`);
}

const actionResult = await actionResp.json();

if (!actionResult.actionable) {
  console.log("⛔ Skipped non-actionable study:", actionResult.reason);
  continue;
}

  // ✅ Send abstract + trusted PubMed metadata into /extract
  const extractResp = await fetch(`${baseUrl}/api/extract`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    abstract,
    pmid: a.pmid,
    title: a.title,
    journal: a.journal,
    journal_abbrev: a.journal_abbrev,
    doi: a.doi,
    authors: a.authors,
  }),
});

if (!extractResp.ok) {
  throw new Error(`Extract API failed: ${extractResp.status}`);
}

const extractResult = await extractResp.json();
results.push(extractResult);
}

// ✅ respond AFTER the loop finishes
return res.status(200).json({
  success: true,
  ingested: results.length,
  results,
});

} catch (err) {
  console.error("🔥 PubMed ingestion error:", err);
  return res.status(500).json({ error: err.message });
}
}