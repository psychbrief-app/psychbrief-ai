import OpenAI from "openai";
import { supabase } from "../../lib/supabase";

/* ---------------------------------------------------------
   CLINICIAN-OPTIMIZED TITLE GENERATOR (Acronym-Safe Title Case)
--------------------------------------------------------- */
function generateSmartTitle(extracted) {
  let intervention = extracted.intervention || "";
  let population = extracted.population || "";

  function clean(str) {
    return str
      .replace(/\.$/, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  // 🔥 Standard clinical acronyms (BD excluded)
  const acronymMap = [
    ["major depressive disorder", "MDD"],
    ["major depression", "MDD"],
    ["depression", "MDD"],

    ["generalized anxiety disorder", "GAD"],

    ["schizophrenia", "SCZ"],
    ["autism spectrum disorder", "ASD"],
    ["autism", "ASD"],
    ["adhd", "ADHD"],
    ["attention-deficit/hyperactivity disorder", "ADHD"],

    ["post-traumatic stress disorder", "PTSD"],
    ["obsessive-compulsive disorder", "OCD"],
  ];

  // Acronyms we must protect from titleCase mangling
  const ACRONYMS = ["MDD", "GAD", "ADHD", "ASD", "SCZ", "PTSD", "OCD"];

  const bipolarTerms = [
    "bipolar",
    "bipolar disorder",
    "bipolar depression",
    "bipolar i",
    "bipolar ii",
    "manic-depressive",
  ];

  function containsBipolar(str) {
    const lower = str.toLowerCase();
    return bipolarTerms.some((t) => lower.includes(t));
  }

  function applyAcronymsExceptBipolar(str) {
    if (!str) return str;
    if (containsBipolar(str)) return str; // ❗ Never abbreviate BD
    let out = str;
    acronymMap.forEach(([phrase, acronym]) => {
      out = out.replace(new RegExp(phrase, "gi"), acronym);
    });
    return out;
  }

  intervention = applyAcronymsExceptBipolar(clean(intervention));
  population = applyAcronymsExceptBipolar(clean(population));

  // Standard title case
  function softTitleCase(str) {
    return str.replace(/\w\S*/g, (w) =>
      w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    );
  }

  // Restore acronyms **after** title case (Mdd → MDD)
  function restoreAcronyms(str) {
    ACRONYMS.forEach((acronym) => {
      const re = new RegExp(acronym, "gi");
      str = str.replace(re, acronym);
    });
    return str;
  }

  // Normalize population phrasing
  population = population
    .replace(/^adults? with\s+/i, "")
    .replace(/^patients? with\s+/i, "")
    .replace(/^individuals? with\s+/i, "")
    .replace(/^people with\s+/i, "")
    .trim();

  // Build candidate title
  let title =
    intervention && population
      ? `${intervention} for ${population}`
      : intervention || (population && `Study in ${population}`) || "Untitled Study";

  // Apply casing rules
  title = softTitleCase(title);
  title = restoreAcronyms(title);

  // Replace "Versus" with short-form "vs"
title = title.replace(/\bVersus\b/gi, "vs");

  return title.trim();
}

function normalizeAcronyms(title) {
  if (!title) return title;

  const ACRONYMS = [
    "ADHD",
    "ASD",
    "PTSD",
    "MDD",
    "TF-CBT",
    "CBT",
    "SSRI",
    "SNRI",
    "OCD",
    "BD" // bipolar disorder stays spelled out per your rule
  ];

  let out = title;

  ACRONYMS.forEach((acronym) => {
    const regex = new RegExp(acronym.split("").join("[\\- ]?"), "ig");
    out = out.replace(regex, acronym);
  });

  return out;
}

export default async function handler(req, res) {
  try {
    console.log("🔵 API /extract called");

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    if (!process.env.OPENAI_API_KEY) {
      console.error("❌ OPENAI_API_KEY is missing");
      throw new Error("Missing API key");
    }

    const {
  abstract,
  title: providedTitle,
  journal: providedJournal,
  doi: providedDoi,
  authors: providedAuthors,
  pmid,
} = req.body;

    console.log("📄 Received abstract:", abstract);

    if (!abstract) {
      return res.status(400).json({ error: "Missing abstract" });
    }

// ✅ Dedup by PMID (skip if already ingested)
if (pmid) {
  const { data: existing, error: existingErr } = await supabase
    .from("studies")
    .select("id")
    .eq("pubmed_id", String(pmid))
    .limit(1);

  if (existingErr) {
    console.error("❌ PMID lookup error:", existingErr);
  } else if (existing && existing.length > 0) {
    console.log("⏭️ Skipping duplicate PMID:", pmid);
    return res.status(200).json({
      success: true,
      skipped: true,
      reason: "duplicate_pmid",
      pmid,
      existing_study_id: existing[0].id,
    });
  }
}
    const systemPrompt = `
You are Psych Brief’s AI extraction engine for psychiatry.
Extract the following fields from the abstract. Return valid JSON ONLY.

{
  "title": string,
  "journal": string or null,
  "authors": ["Last F", "Last F", "..."],
  "sample_size": number or null,
  "population": string or null,
  "intervention": string or null,
  "arms": string or null,
  "key_findings": ["...", "..."],   // MUST be 2–6 bullets (do NOT include Arms/Safety/Takeaway here)
  "takeaway": string or null,
  "study_type": "RCT | DB RCT | SB RCT | Triple-blind RCT | Clinical Trial | Observational | Cohort | Case-Control | Systematic Review | Meta-analysis | Post hoc | Secondary analysis | Protocol | Other",
  "safety_notes": string or null,
  "category": "Mood | Anxiety | Psychosis | Neurodevelopmental | Sleep-Wake | Other"
}

ARMS RULES:
- If the study compares two or more groups, you MUST populate "arms".
- Format: "Intervention A vs Intervention B" (or "Intervention vs placebo").
- Keep concise and clinician-readable.
- If there is only one group or no comparator, return null.
- If acronyms appear in "arms", this counts as first mention for expansion rules.

CATEGORY RULES:
- Mood → depression/MDD, bipolar depression, mania, affective disorders.
- Anxiety → GAD, panic, phobias, PTSD-related symptoms/treatments, OCD.
- Psychosis → schizophrenia, schizoaffective, hallucinations, delusions.
- Neurodevelopmental → ADHD, ASD/autism, intellectual disability, learning disorders.
- Sleep-Wake → insomnia, hypersomnia, circadian disorders, melatonin.
- Other → substance use, personality disorders, psychosocial interventions outside above groups.

CATEGORY PRIORITY RULE:
- If the study population is primarily a neurodevelopmental disorder
  (e.g., ADHD, autism, learning disorders),
  classify as "Neurodevelopmental" EVEN IF the intervention targets sleep.
- Sleep-Wake should only be used when sleep is the primary condition
  (e.g., primary insomnia without another dominant psychiatric diagnosis).

STUDY_TYPE NORMALIZATION RULES (IMPORTANT):
- "DB RCT" = double-blind randomized controlled trial
- "SB RCT" = single-blind randomized controlled trial
- "Triple-blind RCT" = triple-blind randomized controlled trial
- "RCT" = randomized controlled trial (blinding not specified)
- Use "Post hoc" for post hoc analyses.
- Use "Secondary analysis" for secondary/exploratory analyses.
- Use "Observational" if observational design is stated but specific type is unclear.
- Prefer the shortest correct label from the allowed list.
- Do NOT output long phrases like “Single-blind, randomized, sham-controlled clinical study”.

TITLE RULES:
- Title must be concise and clinically meaningful.
- Write clear, clinician-friendly titles.
- Capitalize major words.
- Use “vs” instead of “Versus”.
- Do NOT add study design labels (e.g., no "(randomized controlled trial)").
- Prefer condition-focused titles (e.g., "Melatonin for Sleep-Onset Insomnia in Children With ADHD") over dosing or duration details unless clinically essential.
- Do NOT include study design, dose, duration, or sample size in the title.

TITLE HARD EXCLUSIONS:
- NEVER include medication dose (e.g., mg, mg/kg).
- NEVER include duration or frequency (e.g., nightly, weeks).
- NEVER begin a title with a number.

TITLE NON-REDUNDANCY RULES:
- Do NOT include dosage, duration, or exact age ranges.
- Do NOT repeat details that appear in key findings.
- Focus on the core comparison or clinical question only.
- Prefer population + intervention framing.

TITLE STYLE GUIDE:
- Favor titles like:
  "Melatonin for Sleep Disturbance in Children With ADHD"
  "Sertraline vs Placebo in Major Depressive Disorder"
- Avoid procedural phrasing (e.g., "nightly for 8 weeks").

CAPITALIZATION RULES:
- Use standard medical capitalization.
- Do NOT capitalize units or abbreviations (e.g., mg, kg, vs).
- Acronyms (e.g., ADHD, MDD, GAD) must be ALL CAPS.

ACRONYM RULES:
- Preserve standard clinical acronyms in ALL CAPS (e.g., PTSD, ADHD, TF-CBT, CBT, SSRI, MDD, GAD).
- Do not alter the casing of recognized acronyms.

ACRONYM EXPANSION RULES (IMPORTANT):
- For ANY acronym that is NOT in the “Common psych acronyms” list below, you MUST define it at first mention in the output text:
  Format: Full Term (ACRONYM)
  After first definition, you may use the acronym alone.

- This rule applies to: "intervention", "population", and EACH item in "key_findings".
- If the acronym appears in Arms, that counts as “first mention” (so define it there).

Common psych acronyms that do NOT need definition:
ADHD, ASD, PTSD, MDD, GAD, OCD, SSRI, SNRI, CBT, DBT, RCT, CI, OR, HR, PANSS

Scales and sleep metrics MUST be expanded on first use (examples):
MADRS, SDS, PSP, Q-LES-Q-SF, AHI, TST

AUTHOR RULES:
- Output short-form names only: “Smith J”, “Garcia M”.
- If authors cannot be determined from the abstract, return an empty array [].
- Do NOT fabricate author names.

KEY_FINDINGS RULES (VERY IMPORTANT):
- key_findings must be 2–6 bullets.
- Do NOT include any bullet that starts with "Arms:".
- Do NOT include "Safety:" or "Takeaway:" inside key_findings.
- Bullets should be clinician-facing and start with a capital letter.

ARMS RULE:
- Populate "arms" as a single concise string WITHOUT the "Arms:" prefix
  Example: "Low-sodium oxybate (LXB) vs placebo"
- If no comparator: "Esketamine-nasal spray + oral antidepressant (single-arm)"

TAKEAWAY RULE:
- Populate "takeaway" with a single clinician-friendly sentence.
- Do NOT prefix with "Takeaway:" (we will add that in UI).
- If unclear, return null.

INTERVENTION / ARMS RULES:
- The "intervention" field MUST describe study arms in a comparator format when available.
  Examples:
  - "Esketamine vs placebo"
  - "Suvorexant vs placebo"
  - "Sertraline vs CBT"
  - "Paliperidone palmitate LAI vs aripiprazole LAI"
- If there is no comparator (single-arm study), use:
  - "Esketamine (single-arm)"
- If unclear, return null (do not guess).

JOURNAL RULES:
- If the journal cannot be reliably inferred from the abstract alone, return null.

Return ONLY valid JSON.
`;

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: abstract },
      ],
      response_format: { type: "json_object" },
    });

    console.log("✅ OpenAI raw response:", completion);

    const extracted = JSON.parse(completion.choices[0].message.content);

// Helpers
function sentenceCase(s) {
  if (!s) return s;
  const t = String(s).trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function stripPrefixes(b) {
  return String(b || "")
    .trim()
    .replace(/^arms:\s*/i, "")
    .replace(/^safety:\s*/i, "")
    .replace(/^takeaway:\s*/i, "");
}

// Normalize casing
extracted.population = sentenceCase(stripPrefixes(extracted.population));
extracted.intervention = stripPrefixes(extracted.intervention);
extracted.arms = stripPrefixes(extracted.arms);

let findings = Array.isArray(extracted.key_findings) ? extracted.key_findings : [];
findings = findings
  .map(stripPrefixes)
  .map(sentenceCase)
  .filter(Boolean);

// Safety bullet (always second-last)
const safetyBullet =
  extracted.safety_notes && String(extracted.safety_notes).trim()
    ? `Safety: ${sentenceCase(extracted.safety_notes)}`
    : "Safety: Not reported in abstract.";

// Takeaway bullet (always last)
const takeawayText =
  extracted.takeaway && String(extracted.takeaway).trim()
    ? sentenceCase(extracted.takeaway)
    : (findings[0] ? sentenceCase(findings[0]) : "Consider clinical relevance and generalizability before applying these findings.");

const takeawayBullet = `Takeaway: ${takeawayText.replace(/\.$/, "")}.`;

// Final bullets: findings (max 6) + safety + takeaway = max 8
findings = findings.slice(0, 6);
extracted.key_findings = [...findings, safetyBullet, takeawayBullet];

    function normalizeStudyType(raw) {
  const s = (raw || "").toLowerCase();
  if (!s) return "Clinical Trial";

  // Reviews (put FIRST so "random" doesn't steal them)
  if (s.includes("meta-analysis") || s.includes("meta analysis")) return "Meta-analysis";
  if (s.includes("systematic review")) return "Systematic Review";

  // RCT variants
  if (s.includes("triple") && s.includes("blind") && s.includes("random")) return "Triple-blind RCT";
  if (s.includes("double") && s.includes("blind") && s.includes("random")) return "DB RCT";
  if (s.includes("single") && s.includes("blind") && s.includes("random")) return "SB RCT";
  if (s.includes("random")) return "RCT";

  // Analytic labels
  if (s.includes("post hoc")) return "Post hoc";
  if (s.includes("secondary") || s.includes("exploratory")) return "Secondary analysis";

  // Observational families
  if (s.includes("cohort")) return "Cohort";
  if (s.includes("case-control") || s.includes("case control")) return "Case-Control";
  if (s.includes("observational")) return "Observational";

  // Protocols
  if (s.includes("protocol")) return "Protocol";

  return "Clinical Trial";
}

extracted.study_type = normalizeStudyType(extracted.study_type);

function sentenceCaseBullet(s) {
  if (!s) return s;
  const trimmed = s.trim();
  if (!trimmed) return trimmed;

  function sentenceCaseBullet(s) {
  if (!s) return s;
  const t = String(s).trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function cleanBullets(arr) {
  return (Array.isArray(arr) ? arr : [])
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    // remove any accidental Arms/Safety/Takeaway bullets from model
    .filter((b) => !/^arms:/i.test(b))
    .filter((b) => !/^safety:/i.test(b))
    .filter((b) => !/^takeaway:/i.test(b))
    .map(sentenceCaseBullet);
}

function buildSafetyBullet(extracted) {
  // Prefer explicit safety_notes when present
  if (extracted?.safety_notes && String(extracted.safety_notes).trim()) {
    return sentenceCaseBullet(`Safety: ${String(extracted.safety_notes).trim()}`);
  }
  return "Safety: Not reported in abstract.";
}

function buildTakeawayBullet(extracted) {
  // Simple, robust MVP: use the first main finding if available
  const main = Array.isArray(extracted?.key_findings) && extracted.key_findings.length
    ? String(extracted.key_findings[0]).trim()
    : null;

  if (main) return sentenceCaseBullet(`Takeaway: ${main.replace(/\.$/, "")}.`);
  return "Takeaway: Consider clinical relevance and generalizability before applying these findings.";
}

// 1) clean findings
let findings = cleanBullets(extracted.key_findings);

// 2) force Arms bullet at top
const armsText = extracted?.arms && String(extracted.arms).trim()
  ? String(extracted.arms).trim()
  : null;

const armsBullet = armsText
  ? sentenceCaseBullet(`Arms: ${armsText}`)
  : "Arms: Not specified in abstract.";

findings = [armsBullet, ...findings];

// 3) append Safety + Takeaway
findings.push(buildSafetyBullet(extracted));
findings.push(buildTakeawayBullet(extracted));

// 4) enforce max 8 bullets (keep end bullets!)
if (findings.length > 8) {
  // keep: first (Arms), last 2 (Safety, Takeaway), and best middle bullets
  const middle = findings.slice(1, -2).slice(0, 5);
  findings = [findings[0], ...middle, ...findings.slice(-2)];
}

// 5) write back
extracted.key_findings = findings;

  // If it starts with a letter, uppercase it; preserve acronyms after.
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

if (Array.isArray(extracted.key_findings)) {
  extracted.key_findings = extracted.key_findings.map(sentenceCaseBullet);
}
/* 1️⃣ Insert into studies FIRST */
const { data: studyRows, error: studyError } = await supabase
  .from("studies")
  .insert([
  {
  // Prefer AI-refined title if present, otherwise use the PubMed title, otherwise fallback
  title: extracted.title
    ? normalizeAcronyms(extracted.title)
    : (providedTitle ? normalizeAcronyms(providedTitle) : "Clinical Study"),

  // Prefer PubMed journal; only fall back to AI if you want (optional)
  journal: providedJournal || extracted.journal || null,

  // Prefer PubMed DOI (if available)
  doi: providedDoi || null,

  // Use real PubMed ID so hyperlink works
  pubmed_id: pmid || null,

  publication_date: new Date().toISOString().slice(0, 10),

  study_type: extracted.study_type || "Clinical Trial",
  category: extracted.category || "Other",
  archive: false,

  // Prefer PubMed authors; fall back to extracted if PubMed didn’t provide
  authors: Array.isArray(providedAuthors) && providedAuthors.length
    ? providedAuthors
    : (extracted.authors || []),
},
])
  .select();   // 👈 IMPORTANT: returns inserted row

if (studyError) {
  console.error("❌ Study insert error:", studyError);
  return res.status(500).json({ error: "Study insert failed" });
}

const studyId = studyRows[0].id;

/* 2️⃣ Insert into ai_insights USING study_id */
const { data: insightRows, error: insightError } = await supabase
  .from("ai_insights")
  .insert([
    {
      study_id: studyId,
      sample_size: extracted.sample_size || null,
population: extracted.population || null,
intervention: extracted.intervention || null,
key_findings: extracted.key_findings || [],
safety_notes: extracted.safety_notes || null,
    },
  ])
  .select(); // 👈 REQUIRED

if (insightError) {
  console.error("❌ AI insight insert error:", insightError);
  return res.status(500).json({ error: "AI insights insert failed" });
}

console.log("✅ AI insights inserted:", insightRows);

    /* 3️⃣ Success */
    res.status(200).json({
      success: true,
      study_id: studyId,
      extracted,
    });

  } catch (err) {
    console.error("🔥 FULL EXTRACTION ERROR:", err);
    res.status(500).json({ error: err.message || "AI extraction failed" });
  }
}