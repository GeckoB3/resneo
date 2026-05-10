import OpenAI from 'openai';
import type { SchemaField } from '@/lib/import/constants';

const SYSTEM = `You are a data mapping assistant for ReserveNI, a booking platform.
Your job is to map columns from a CSV export of another booking platform to ReserveNI's data schema.
You must return ONLY valid JSON with no additional text, explanation, or markdown.`;

export type AiMappingRow = {
  source_column: string;
  action: 'map' | 'ignore' | 'split';
  target_field: string | null;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
  split_config?: {
    separator: string;
    parts: Array<{ field: string }>;
  };
};

export async function runAiColumnMapping(params: {
  headers: string[];
  sampleRows: Record<string, string>[];
  fileType: 'clients' | 'bookings';
  detectedPlatform?: string | null;
  targetFields: SchemaField[];
}): Promise<{ mappings: AiMappingRow[]; model: string } | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    console.warn('[import ai-map] OPENAI_API_KEY not set');
    return null;
  }

  const model = process.env.OPENAI_IMPORT_MODEL?.trim() || 'gpt-5.4-nano';

  const { headers, sampleRows, fileType, detectedPlatform, targetFields } = params;

  const userPrompt = `
The user has uploaded a CSV file containing ${fileType} data.
${detectedPlatform ? `We believe this is from ${detectedPlatform}.` : 'The source platform is unknown.'}

CSV column headers:
${JSON.stringify(headers)}

Sample data (first 5 rows):
${JSON.stringify(sampleRows.slice(0, 5), null, 2)}

ReserveNI target fields:
${JSON.stringify(
    targetFields.map((f) => ({ key: f.key, label: f.label, required: f.required, type: f.type })),
    null,
    2,
  )}

Return a JSON object with a single key "mappings" whose value is an array with one object per CSV column:
[
  {
    "source_column": "exact column name from CSV",
    "action": "map" | "ignore" | "split",
    "target_field": "reserveni field key or null",
    "confidence": "high" | "medium" | "low",
    "reasoning": "brief explanation in plain English",
    "split_config": {
      "separator": " ",
      "parts": [{"field": "first_name"}, {"field": "last_name"}]
    }
  }
]

Rules:
- Only suggest target fields that exist in the provided field list
- A target field can only be the destination of ONE source column
- If two columns could map to the same field, pick the better one and ignore the other
- For client files, map columns called First Name, Forename, Given Name, or similar to "first_name"
- For client files, map columns called Surname, Last Name, Family Name, or similar to "last_name"
- If a client file only has one combined Name, Full Name, Client Name, Customer Name, or Guest Name column, map it to "full_name" or use action "split" into first_name and last_name
- For booking files, map booking guest/client first-name columns to "guest_first_name" and surname/last-name columns to "guest_last_name"
- For booking files, if only one booking guest/client name column exists, map it to "guest_full_name"
- Confidence should be 'high' if clearly matching, 'medium' if reasonable guess, 'low' if uncertain
- Prefer 'ignore' over a low-confidence mapping for columns you are unsure about
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
    const parsed = JSON.parse(raw) as { mappings?: AiMappingRow[] };
    const mappings = Array.isArray(parsed.mappings) ? parsed.mappings : [];
    return { mappings: dedupeMappings(mappings, targetFields), model };
  } catch (e) {
    console.error('[import ai-map] OpenAI error:', e);
    return null;
  }
}

function dedupeMappings(rows: AiMappingRow[], targetFields: SchemaField[]): AiMappingRow[] {
  const allowed = new Set(targetFields.map((f) => f.key));
  const used = new Set<string>();
  const out: AiMappingRow[] = [];

  for (const row of rows) {
    const r = { ...row };
    if (r.action === 'map' && r.target_field) {
      if (!allowed.has(r.target_field) || used.has(r.target_field)) {
        r.action = 'ignore';
        r.target_field = null;
      } else {
        used.add(r.target_field);
      }
    }
    if (r.action === 'split' && r.split_config?.parts) {
      for (const p of r.split_config.parts) {
        if (p.field && allowed.has(p.field)) used.add(p.field);
      }
    }
    out.push(r);
  }
  return out;
}
