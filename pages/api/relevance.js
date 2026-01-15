import OpenAI from "openai";

const openai = new OpenAI();

export default async function handler(req, res) {
  try {
    const { abstract } = req.body;

    const systemPrompt = `
You are a senior psychiatrist screening studies for a clinical intelligence platform.

Include ONLY if:
- Human subjects
- Mental health condition
- Clinical intervention, therapy, or treatment
- Findings could reasonably inform clinical practice

Exclude if:
- Animal or preclinical
- Experimental psychology only
- Neuroimaging without clinical application
- Epidemiology, prevalence, validation, or methodology only
- Reviews, protocols, or meta-analyses
- Fringe or implausible interventions

Answer ONLY with valid JSON:
{ "relevant": true } or { "relevant": false }
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: abstract }
      ],
      temperature: 0,
    });

    const result = JSON.parse(completion.choices[0].message.content);
    res.status(200).json(result);

  } catch (err) {
    console.error("Relevance error:", err);
    res.status(500).json({ relevant: false });
  }
}