import { useState, useEffect, useMemo } from "react";
import { supabase } from "../lib/supabase";

export default function Home() {

  // ---- DATA ----
  const maxHomepageCards = 24;
  const maxArchiveCards = 50;

  const categoryIcons = {
    Mood: "☀️",
    Anxiety: "🌀",
    Psychosis: "⚡",
    Neurodevelopmental: "🧠",
    "Sleep-Wake": "🌙",
    Other: "⋯",
  };

    // ---- LIVE DATA (from Supabase) ----
  const [studies, setStudies] = useState([]);
  const [aiInsights, setAiInsights] = useState([]);
  const [loading, setLoading] = useState(true);

  // ✅ Hover state (correct placement)
  const [hoveredCard, setHoveredCard] = useState(null);

  // ---- FETCH LIVE DATA ----
  useEffect(() => {
    async function fetchData() {
      setLoading(true);

      const { data: studiesData, error: studiesError } = await supabase
        .from("studies")
        .select("*")
        .order("publication_date", { ascending: false });

      if (studiesError) {
        console.error("❌ Error fetching studies:", studiesError);
      } else {
        setStudies(studiesData || []);
      }

      const { data: insightsData, error: insightsError } = await supabase
        .from("ai_insights")
        .select("*");

      if (insightsError) {
        console.error("❌ Error fetching AI insights:", insightsError);
      } else {
        setAiInsights(insightsData || []);
      }

      setLoading(false);
    }

    fetchData();
  }, []);

  // ---- JOIN studies + ai_insights ----
  const insightsByStudyId = useMemo(() => {
    const map = {};
    aiInsights.forEach((i) => {
      map[i.study_id] = i;
    });
    return map;
  }, [aiInsights]);

    const hydratedStudies = useMemo(() => {
    if (!studies.length) return [];

    return studies.map((s) => {
      const insight = insightsByStudyId[s.id];

      return {
        id: s.id,
        title: s.title,
        authors: s.authors || [],
        journal: s.journal,
        date: s.publication_date,
        doi: s.doi,
        type: s.study_type,
        categories: s.category ? [s.category] : ["Other"],
        pubmed: s.pubmed_id ? `https://pubmed.ncbi.nlm.nih.gov/${s.pubmed_id}/` : "#",
        ai_insights: insight
  ? [
      insight.sample_size && `N=${insight.sample_size}`,
      insight.population,
      insight.intervention && `Arms: ${insight.intervention}`,
      ...(insight.key_findings || []),
    ].filter(Boolean)
  : [],
        archive: s.archive,
      };
    });
  }, [studies, insightsByStudyId]);

  const categories = ["All", "Mood", "Anxiety", "Psychosis", "Neurodevelopmental", "Sleep-Wake", "Other"];

  // ---- STATE ----
  const [activeCategory, setActiveCategory] = useState("All");
  const [searchTerm, setSearchTerm] = useState("");
  const [showArchive, setShowArchive] = useState(false);

  // ---- HELPERS ----
  function formatAuthors(authors) {
    return authors.length > 3 ? authors.slice(0, 3).join(", ") + ", et al." : authors.join(", ");
  }

function uiStudyTypeLabel(raw) {
  const s = (raw || "").toLowerCase().trim();

  if (!s) return "Study";

  // High-signal / common types
  if (s.includes("random") && s.includes("controlled")) return "RCT";
  if (s.includes("double-blind")) return "DB RCT";
  if (s.includes("single-blind")) return "SB RCT";
  if (s.includes("open-label")) return "Open-label";
  if (s.includes("placebo")) return "Placebo";
  if (s.includes("pilot")) return "Pilot";
  if (s.includes("feasibility")) return "Feasibility";

  // Observational family
  if (s.includes("systematic review")) return "Sys Rev";
  if (s.includes("meta-analysis")) return "Meta-analysis";
  if (s.includes("cohort")) return "Cohort";
  if (s.includes("case-control")) return "Case-control";
  if (s.includes("cross-sectional")) return "Cross-sectional";
  if (s.includes("registry")) return "Registry";
  if (s.includes("observational")) return "Observational";

  // “mirror-image”, “post hoc”, etc.
  if (s.includes("mirror-image")) return "Mirror-image";
  if (s.includes("post hoc")) return "Post hoc";

  // Fallback: Title Case but short-ish
  const titleCased = s.replace(/\b\w/g, (c) => c.toUpperCase());
  return titleCased.length > 22 ? titleCased.slice(0, 22) + "…" : titleCased;
}

  // ---- FILTERING LOGIC ----
  const filteredList = useMemo(() => {
    const list = loading ? [] : hydratedStudies;

    let out = list;

    if (activeCategory !== "All") {
      out = out.filter((s) => s.categories.includes(activeCategory));
    }

    if (searchTerm.trim() !== "") {
      const t = searchTerm.toLowerCase();
      out = out.filter(
        (s) =>
          s.title.toLowerCase().includes(t) ||
          s.authors.join(" ").toLowerCase().includes(t) ||
          s.journal.toLowerCase().includes(t)
      );
    }

    // Neurodevelopmental bonus rules
    if (activeCategory === "Neurodevelopmental") {
      out = out.filter((s) =>
        ["Neurodevelopmental", "ADHD", "Autism", "Intellectual Disability", "Learning Disorders"].some((k) =>
          s.title.toLowerCase().includes(k.toLowerCase()) || s.categories.includes("Neurodevelopmental")
        )
      );
    }

    return out;
  }, [loading, hydratedStudies, activeCategory, searchTerm, showArchive]);

function isHighSignal(study) {
  const insights = study.ai_insights || [];

  const hasSampleSize = insights.some(i => /^N=\d+/.test(i));
  const hasIntervention = insights.some(i =>
    /(therapy|treatment|intervention|drug|medication|inhalation|therapy)/i.test(i)
  );

  return (
    insights.length >= 3 &&
    (hasSampleSize || hasIntervention)
  );
}

  const displayed = filteredList
  .filter(isHighSignal)
  .slice(0, showArchive ? maxArchiveCards : maxHomepageCards);

  // ---- STYLES (inline for now; we can later move to CSS modules or Tailwind) ----
  const styles = {
    body: {
      fontFamily: "sans-serif",
      margin: 0,
      padding: 0,
      background: "linear-gradient(to bottom, #e8f4fb, #f9fafb)",
      color: "#111",
    },
    container: {
  maxWidth: "1200px",
  margin: "0 auto",
  padding: "10px 20px 20px 20px", // 🔑 top, right, bottom, left
},
    h1: { fontSize: "28px", fontWeight: "bold", marginBottom: "10px" },
    p: { marginBottom: "20px", color: "#555" },
    headerTagline: {
  margin: 0,
  marginTop: 2,
  lineHeight: 1.35,
  color: "#555",
  fontSize: "90%",
},
    topBar: { display: "flex", flexWrap: "wrap", alignItems: "center", marginBottom: "20px", gap: "10px" },
    filters: { display: "flex", flexWrap: "wrap", gap: "10px", marginBottom: "20px" },
    filterBtn: {
      padding: "7px 14px",
      borderRadius: "25px",
      backgroundColor: "rgba(180,224,248,0.4)",
      color: "#111",
      border: "none",
      cursor: "pointer",
    },
    filterBtnActive: { backgroundColor: "#b4e0f8" },
    searchBox: {
  padding: "7px",
  borderRadius: "8px",
  border: "1px solid #ccc",
  flexGrow: 1,
  minWidth: "150px",
  backgroundColor: "#ffffff",   // <— FIX
  color: "#111",                 // <— FIX
}
,
    cards: {
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
      gap: "20px",
    },
    card: {
      padding: "20px",
      background: "white",
      borderRadius: "14px",
      boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
      position: "relative",
      lineHeight: "1.45",
      transition: "transform 0.2s ease, box-shadow 0.2s ease",
    },
    cardHover: {
      transform: "translateY(-4px)",
      boxShadow: "0 6px 16px rgba(0,0,0,0.15)",
    },
    archiveSection: {
      marginTop: "30px",
      padding: "15px",
      background: "#e5e7eb",
      borderRadius: "10px",
      textAlign: "center",
      color: "#555",
    },
    footer: {
      textAlign: "center",
      padding: "10px",
      background: "#f3f4f6",
      fontSize: "14px",
      marginTop: "25px",
    },
  };

  // ---- RENDER ----
return (
  <div style={styles.body}>
    <div style={styles.container}>

      {/* HEADER */}
<div
  style={{
    textAlign: "center",
    marginTop: 8,   // 🔑 THIS is the key line
    marginBottom: 8,
  }}
>
  <img
    src="/logo/psychbrief-logo.png"
    alt="Psych Brief"
    style={{
      height: 110,
      width: "auto",
      display: "block",
      margin: "0 auto 2px auto",
    }}
  />

  <p
    style={{
      margin: 0,
      lineHeight: 1.3,
      color: "#555",
      fontSize: "90%",
    }}
  >
    Curated and summarized clinical psychiatry
    <br />
    A mental health research intelligence source — continuously updated, elegantly delivered
  </p>
  <p
  style={{
    marginTop: 6,
    marginBottom: 0,
    fontSize: "75%",
    color: "#666",
    lineHeight: 1.4,
  }}
>
  Designed by <strong>C. Patrick, PhD</strong> ·{" "}
  <a
    href="mailto:cpatrick035@gmail.com"
    style={{ color: "#555", textDecoration: "none" }}
  >
    cpatrick035@gmail.com
  </a>
</p>
</div>

      {/* TOP BAR */}
<div style={styles.topBar}>
  <input
    type="text"
    placeholder="Search studies..."
    style={styles.searchBox}
    value={searchTerm}
    onChange={(e) => setSearchTerm(e.target.value)}
  />

  <div style={{ marginTop: "5px", display: "flex", gap: "10px" }}>
    <button
      style={{
        ...styles.filterBtn,
        ...(showArchive ? {} : styles.filterBtnActive),
      }}
      onClick={() => setShowArchive(false)}
    >
      Main
    </button>

    <button
      style={{
        ...styles.filterBtn,
        ...(showArchive ? styles.filterBtnActive : {}),
      }}
      onClick={() => setShowArchive(true)}
    >
      Archive
    </button>
  </div>
</div>

{/* CATEGORY FILTERS */}
<div style={styles.filters}>
          {categories.map((c) => (
            <button
              key={c}
              style={{
                ...styles.filterBtn,
                ...(activeCategory === c ? styles.filterBtnActive : {}),
              }}
              onClick={() => setActiveCategory(c)}
            >
              {c === "All" ? c : `${categoryIcons[c]} ${c}`}
            </button>
          ))}
        </div>

        {/* CARDS */}
<div style={styles.cards}>
  {displayed.map((study) => {
    const insightsRaw = Array.isArray(study.ai_insights) ? study.ai_insights : [];

const safety = insightsRaw.find((x) =>
  String(x).toLowerCase().startsWith("safety:")
);

const takeaway = insightsRaw.find((x) =>
  String(x).toLowerCase().startsWith("takeaway:")
);

const other = insightsRaw.filter((x) => {
  const t = String(x).toLowerCase();
  return !t.startsWith("safety:") && !t.startsWith("takeaway:");
});

const hasRealSafety =
  safety &&
  !String(safety).toLowerCase().includes("not reported in abstract");

const insights = [
  ...other.slice(0, 6),
  ...(hasRealSafety ? [safety] : []),
  takeaway ||
    "Takeaway: Interpret results in the context of study design and generalizability.",
];
    return (
    <div
    key={study.id}
    style={{
      ...styles.card,
      ...(hoveredCard === study.id ? styles.cardHover : {}),
    }}
    onMouseEnter={() => setHoveredCard(study.id)}
    onMouseLeave={() => setHoveredCard(null)}
  >
      <div style={{ position: "absolute", top: 12, left: 12, display: "flex", gap: 6 }}>
        {study.categories.map((c) => (
          <span key={c} style={{ fontSize: 12 }}>
            {categoryIcons[c]}
          </span>
        ))}
      </div>

      <div
  style={{
    position: "absolute",
    top: 10,
    right: 10,
    fontSize: 11,
    padding: "4px 8px",
    borderRadius: 999,
    background: "rgba(0,0,0,0.06)",
    color: "#333",
    maxWidth: 120,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  }}
  title={study.type || ""}
>
  {uiStudyTypeLabel(study.type)}
</div>

      <h2
  style={{
    fontSize: "100%",
    fontWeight: 600,
    margin: "35px 0 8px 0",
    lineHeight: 1.3,
  }}
>
  {study.title.startsWith("Study In") || study.title === "Untitled Study"
    ? "Clinical Study"
    : study.title}
</h2>

      <p style={{ fontSize: "85%", color: "#444", margin: "0 0 12px 0" }}>
  {study.authors.length > 0 && (
    <span>{formatAuthors(study.authors)} | </span>
  )}

  {study.journal && (
    <span>
      <em>{study.journal}</em> |{" "}
    </span>
  )}

  <span>Date: {study.date} | </span>

  <span>DOI: {study.doi} | </span>

  <a href={study.pubmed} target="_blank" rel="noreferrer">
    PubMed
  </a>
</p>

      <ul style={{ fontSize: "85%", margin: "10px 0 0 20px", padding: 0 }}>
  {insights.slice(0, 8).map((i, idx) => (
  <li key={idx}>{i}</li>
))}
</ul>
    </div>
  );
})}
</div>

{/* QUALITY NOTE */}
<p
  style={{
    fontSize: "72%",
    color: "#888",
    marginTop: 20,
    textAlign: "center",
    letterSpacing: "0.02em",
  }}
>
  Showing high-signal clinical studies only
</p>

        {/* ARCHIVE SECTION */}
        {showArchive && (
          <div style={styles.archiveSection}>Archive section (up to 500 cards)</div>
        )}
      </div>

      <footer style={styles.footer}>
        C. Patrick, PhD | PsychBrief © 2026
      </footer>
    </div>
  );
}
