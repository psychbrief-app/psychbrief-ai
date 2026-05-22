export default async function handler(req, res) {

  const authHeader = req.headers.authorization || "";
  const expected = `Bearer ${process.env.CRON_SECRET}`;

  if (authHeader !== expected) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const response = await fetch(`${process.env.BASE_URL}/api/ingest-pubmed`);
    const data = await response.json();

    return res.status(200).json({
      message: "Cron ingestion triggered",
      result: data
    });

  } catch (error) {
    console.error("Cron ingestion failed:", error);

    return res.status(500).json({
      error: "Cron ingestion failed"
    });
  }

}