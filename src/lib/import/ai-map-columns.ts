import type { SchemaField } from '@/lib/import/constants';
import type { ColumnProfile } from '@/lib/import/column-profile';
import { runImportAiJson } from '@/lib/import/openai-client';

const SYSTEM = `You are a data mapping assistant for ResNeo, a booking platform.
Your job is to map columns from a CSV export of another booking platform to ResNeo's data schema.`;

export type AiMappingRow = {
  source_column: string;
  action: 'map' | 'ignore' | 'split';
  target_field: string | null;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
  split_config?: {
    separator: string;
    parts: Array<{ field: string }>;
  } | null;
};

/** Strict structured-output schema: one entry per CSV column. */
const MAPPING_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['mappings'],
  properties: {
    mappings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['source_column', 'action', 'target_field', 'confidence', 'reasoning', 'split_config'],
        properties: {
          source_column: { type: 'string', description: 'Exact column name from the CSV.' },
          action: { type: 'string', enum: ['map', 'ignore', 'split'] },
          target_field: {
            type: ['string', 'null'],
            description: 'ResNeo field key when action is "map", else null.',
          },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          reasoning: { type: 'string', description: 'Brief plain-English explanation.' },
          split_config: {
            type: ['object', 'null'],
            additionalProperties: false,
            required: ['separator', 'parts'],
            properties: {
              separator: { type: 'string' },
              parts: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['field'],
                  properties: { field: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
  },
};

export async function runAiColumnMapping(params: {
  headers: string[];
  sampleRows: Record<string, string>[];
  fileType: 'clients' | 'bookings' | 'staff';
  detectedPlatform?: string | null;
  targetFields: SchemaField[];
  /** Full-file column statistics — much stronger signal than 5 sample rows. */
  columnProfiles?: ColumnProfile[] | null;
  /** Free-text guidance written by the user ("the Ref column is our client ID", …). */
  userInstructions?: string | null;
  /** Columns already mapped deterministically by name — the AI must not reuse these fields. */
  knownMappings?: Array<{ source_column: string; target_field: string }> | null;
}): Promise<{ mappings: AiMappingRow[]; model: string } | null> {
  const { headers, sampleRows, fileType, detectedPlatform, targetFields, columnProfiles, userInstructions, knownMappings } =
    params;

  const profileSection = columnProfiles?.length
    ? `
Column statistics computed over the whole file (fill_rate is the fraction of non-empty cells;
type_counts shows how many sampled values look like each type; top_values are the most common values):
${JSON.stringify(columnProfiles, null, 1)}
`
    : '';

  const instructionsSection = userInstructions?.trim()
    ? `
The user wrote these instructions about their data — FOLLOW THEM, they override the
generic rules below wherever they conflict:
"""
${userInstructions.trim().slice(0, 2000)}
"""
`
    : '';

  const knownSection = knownMappings?.length
    ? `
These columns are ALREADY mapped by an exact column-name match — treat them as decided.
Do NOT map any OTHER column to these same target fields; map the remaining columns only:
${JSON.stringify(knownMappings, null, 1)}
`
    : '';

  const fileKindLine =
    fileType === 'staff'
      ? 'a STAFF LIST (each row is a member of staff). Map name/contact columns to the staff fields.'
      : `${fileType} data.`;

  const userPrompt = `
The user has uploaded a CSV file containing ${fileKindLine}
${detectedPlatform ? `We believe this is from ${detectedPlatform}.` : 'The source platform is unknown.'}
${instructionsSection}${knownSection}
CSV column headers:
${JSON.stringify(headers)}

Sample data (first rows):
${JSON.stringify(sampleRows.slice(0, 8), null, 1)}
${profileSection}
ResNeo target fields:
${JSON.stringify(
    targetFields.map((f) => ({ key: f.key, label: f.label, required: f.required, type: f.type })),
    null,
    1,
  )}

Return one mappings entry per CSV column.

Rules:
- Only suggest target fields that exist in the provided field list.
- A target field can only be the destination of ONE source column. If two columns could map to the same field, pick the better one and ignore the other.
- Be thorough: map every column that plausibly corresponds to a target field. Required fields matter most — if any column could satisfy a required field, map it rather than ignoring it.
- For client files, map columns called First Name, Forename, Given Name, or similar to "first_name"; Surname, Last Name, Family Name, or similar to "last_name".
- If a client file only has one combined Name / Full Name / Client Name / Customer Name column, map it to "full_name" (preferred — ResNeo splits it into first/last automatically, handling "Surname, First" and compound surnames).
- For booking files, map guest/client first-name columns to "guest_first_name" and surname columns to "guest_last_name"; a single combined name column maps to "guest_full_name".
- Booking exports usually contain the client's details too (name, email, phone) — map those to the guest_*/client_* booking fields; they are used to create or match client records.
- A column whose values combine date AND time (e.g. "2026-03-14 14:30" or "14/03/2026 2:30 PM") can be mapped directly to "booking_date" — the time component is recovered automatically. Use action "split" into booking_date + booking_time only when the user asks for it.
- For staff files, a single combined name column maps to "staff_name"; separate columns map to "staff_first_name"/"staff_last_name".
- Columns holding genuinely useful client data with no matching target field (e.g. allergies, referral source) should NOT be ignored — leave them action "map" with target_field null is invalid, so use action "ignore" but say in reasoning that the user may want a custom field for it.
- Confidence: 'high' if clearly matching, 'medium' if reasonable guess, 'low' if uncertain.
- Prefer 'ignore' over a low-confidence mapping for columns you are unsure about.
- split_config must be null unless action is "split".
`;

  const result = await runImportAiJson<{ mappings: AiMappingRow[] }>({
    callSite: 'ai-map-columns',
    system: SYSTEM,
    user: userPrompt,
    schemaName: 'column_mappings',
    schema: MAPPING_SCHEMA,
  });

  if (!result) return null;
  const mappings = Array.isArray(result.data.mappings) ? result.data.mappings : [];
  return { mappings: dedupeMappings(mappings, targetFields), model: result.model };
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
      const validParts = r.split_config.parts.filter((p) => p.field && allowed.has(p.field) && !used.has(p.field));
      if (validParts.length === 0) {
        r.action = 'ignore';
        r.target_field = null;
        r.split_config = null;
      } else {
        for (const p of validParts) used.add(p.field);
        r.split_config = { ...r.split_config, parts: validParts };
      }
    }
    out.push(r);
  }
  return out;
}
