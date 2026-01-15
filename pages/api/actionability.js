import OpenAI from "openai";

export default async function handler(req, res) {
  try {
    const { abstract } = req.body;
    if (!abstract) {
      return res.status(400).json({ error: "Missing abstract" });
    }

    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    const prompt = `
You are a senior psychiatrist evaluating research relevance.

Question:
Would this study plausibly influence psychiatric clinical decision-making,
treatment discussions, or guideline development within the next 5–10 years?

Rules:
- Focus on human psychiatry.
- Exclude basic science, animal-only studies, prevalence-only studies,
  psychometrics, imaging-only correlates, or speculative mechanisms.
- Include psychotherapy trials, medication trials, and meaningful clinical interventions.
- Be conservative.

Return ONLY valid JSON:

{
  "actionable": true | false,
  "reason": "one short sentence"
}
`;

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: abstract },
      ],
      response_format: { type: "json_object" },
    });

    const result = JSON.parse(completion.choices[0].message.content);
    res.status(200).json(result);

  } catch (err) {
    console.error("🔥 Actionability error:", err);
    res.status(500).json({ error: err.message });
  }
}