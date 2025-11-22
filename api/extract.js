import OpenAI from "openai";

export default async function handler(req, res) {
  try {
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const { abstract } = req.body;

    if (!abstract) {
      return res.status(400).json({ error: "Missing abstract text" });
    }

    const systemPrompt = `
You are Psych Brief’s AI extraction engine.
Your task is to read a PubMed abstract and return structured JSON with:
- N (sample size)
- Population description
- Intervention or study arms
- Key findings (up to 6 concise bullets)
- Study type
- Any safety findings
    `;

    const completion = await client.chat.completions.create({
      model: "gpt-5.1",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: abstract }
      ],
      response_format: { type: "json_object" }
    });

    const output = completion.choices[0].message.content;

    res.status(200).json(JSON.parse(output));
  } catch (error) {
    console.error("AI extraction error:", error);
    res.status(500).json({ error: "Extraction failed" });
  }
}
