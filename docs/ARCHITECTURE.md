# PsychBrief – Architecture & Editorial Notes

## Stack
- Next.js (pages router)
- Supabase (studies, ai_insights)
- Vercel (hosting, cron-ready)
- PubMed E-utilities ingestion

## Core Flows
1. /api/ingest-pubmed
2. relevance → actionability → extract
3. Extracted JSON normalized before DB insert
4. Homepage renders high-signal studies only

## Editorial Rules
- High-signal = ≥3 bullets AND (sample size OR intervention)
- Acronyms:
  - First appearance: Full Term (ACR)
  - Subsequent: ACR only
- Safety always second-last
- Takeaway always last

## Known Pitfalls Solved
- Never hardcode localhost in production APIs
- Use req headers to derive baseUrl
- Supabase env vars must exist at build time
- Next.js static generation can break if envs missing

## Open To-Dos
- Automated daily ingestion (Vercel cron)
- Archive rollover logic
- Optional re-extraction of legacy cards