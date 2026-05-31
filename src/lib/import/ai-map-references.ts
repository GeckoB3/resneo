import OpenAI from 'openai';

const SYSTEM = `You are matching external booking export strings to Resneo catalogue entities.
Return ONLY valid JSON, no markdown.`;

export type AiRefSuggestion = {
  reference_id: string;
  suggested_entity_id: string | null;
  suggested_entity_label: string | null;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
};

export async function runAiMapReferences(params: {
  references: Array<{ id: string; reference_type: string; raw_value: string }>;
  candidates: Array<{ id: string; name: string; kind: string }>;
}): Promise<{ suggestions: AiRefSuggestion[]; model: string } | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    console.warn('[ai-map-references] OPENAI_API_KEY not set');
    return null;
  }

  const model = process.env.OPENAI_IMPORT_MODEL?.trim() || 'gpt-5.4-nano';

  if (!params.references.length) {
    return { suggestions: [], model };
  }

  const userPrompt = `
Candidates (pick by id only if confident; service/staff types are independent):
${JSON.stringify(params.candidates, null, 2)}

References to match:
${JSON.stringify(
    params.references.map((r) => ({
      reference_id: r.id,
      reference_type: r.reference_type,
      raw_value: r.raw_value,
    })),
    null,
    2,
  )}

Return JSON: { "suggestions": [
  {
    "reference_id": "uuid",
    "suggested_entity_id": "uuid or null",
    "suggested_entity_label": "human label or null",
    "confidence": "high" | "medium" | "low",
    "reasoning": "short"
  }
]}

Rules:
- Match each reference to at most one candidate id of a compatible kind (service -> service_item candidate, staff -> calendar or practitioner candidate as provided).
- If no good match, use nulls for ids and low confidence.
`;

  try {
    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { suggestions?: AiRefSuggestion[] };
    const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
    return { suggestions, model };
  } catch (e) {
    console.error('[ai-map-references] OpenAI error:', e);
    return null;
  }
}
