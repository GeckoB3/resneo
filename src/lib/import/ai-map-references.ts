import { runImportAiJson } from '@/lib/import/openai-client';
import { fuzzyNameScore } from '@/lib/import/fuzzy-match';

const SYSTEM = `You are matching external booking export strings (service names, staff names, etc.)
to a venue's existing catalogue entities on Resneo, a booking platform.`;

export type AiRefSuggestion = {
  reference_id: string;
  suggested_entity_id: string | null;
  suggested_entity_label: string | null;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
};

const SUGGESTION_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['suggestions'],
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'reference_id',
          'suggested_entity_id',
          'suggested_entity_label',
          'confidence',
          'reasoning',
        ],
        properties: {
          reference_id: { type: 'string' },
          suggested_entity_id: { type: ['string', 'null'] },
          suggested_entity_label: { type: ['string', 'null'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          reasoning: { type: 'string' },
        },
      },
    },
  },
};

export interface RefCandidate {
  id: string;
  name: string;
  kind: string;
}

export interface RefToMatch {
  id: string;
  reference_type: string;
  raw_value: string;
}

/** Kinds compatible with each reference type (mirrors the route's entity-type mapping). */
export const REF_COMPATIBLE_KINDS: Record<string, string[]> = {
  service: ['service_item', 'appointment_service'],
  staff: ['calendar', 'practitioner'],
  event: ['event_session'],
  class: ['class_instance'],
  resource: ['resource_calendar'],
};

const BATCH_SIZE = 50;
const SHORTLIST_SIZE = 12;

/**
 * Match references to catalogue entities. References are batched, and each
 * reference gets a fuzzy-ranked shortlist of compatible candidates rather than
 * the whole catalogue — better accuracy and bounded prompt size.
 */
export async function runAiMapReferences(params: {
  references: RefToMatch[];
  candidates: RefCandidate[];
  /** Free-text guidance written by the user (e.g. "K. Smith is Katie Smith"). */
  userInstructions?: string | null;
}): Promise<{ suggestions: AiRefSuggestion[]; model: string } | null> {
  if (!params.references.length) {
    return { suggestions: [], model: 'none' };
  }

  const instructionsSection = params.userInstructions?.trim()
    ? `
The user wrote these instructions about their data — follow them where relevant:
"""
${params.userInstructions.trim().slice(0, 2000)}
"""
`
    : '';

  const all: AiRefSuggestion[] = [];
  let model = 'unknown';

  for (let i = 0; i < params.references.length; i += BATCH_SIZE) {
    const batch = params.references.slice(i, i + BATCH_SIZE);
    const entries = batch.map((r) => {
      const compatible = REF_COMPATIBLE_KINDS[r.reference_type] ?? [];
      const shortlist = params.candidates
        .filter((c) => compatible.includes(c.kind))
        .map((c) => ({ c, score: fuzzyNameScore(r.raw_value, c.name) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, SHORTLIST_SIZE)
        .map(({ c }) => ({ id: c.id, name: c.name, kind: c.kind }));
      return {
        reference_id: r.id,
        reference_type: r.reference_type,
        raw_value: r.raw_value,
        candidates: shortlist,
      };
    });

    const userPrompt = `
${instructionsSection}Each reference below is a raw string from another platform's export. For each one,
pick the best-matching candidate from ITS OWN "candidates" list (these are already
filtered to compatible types and ranked by name similarity), or null if none is a
genuine match for the same real-world service/person/thing.

References with their candidates:
${JSON.stringify(entries, null, 1)}

Rules:
- suggested_entity_id must be one of that reference's candidate ids, or null.
- "Gents Cut" vs "Men's Haircut" is a plausible high/medium match; "Haircut" vs "Massage" is not.
- Abbreviations, plurals, punctuation and reordering are fine ("Jo Smith" ~ "Joanne Smith" medium).
- If no candidate is plausibly the same thing, return null with low confidence.
- Return one suggestion per reference, in any order.
`;

    const result = await runImportAiJson<{ suggestions: AiRefSuggestion[] }>({
      callSite: 'ai-map-references',
      system: SYSTEM,
      user: userPrompt,
      schemaName: 'reference_suggestions',
      schema: SUGGESTION_SCHEMA,
    });

    if (!result) {
      // Partial batches are still useful; fail fully only when nothing succeeded.
      if (all.length === 0) return null;
      break;
    }
    model = result.model;
    if (Array.isArray(result.data.suggestions)) {
      all.push(...result.data.suggestions);
    }
  }

  return { suggestions: all, model };
}
