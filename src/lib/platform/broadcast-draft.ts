import { z } from 'zod';
import { BROADCAST_LIMITS, normaliseBroadcastContent, type BroadcastContent } from '@/lib/platform/broadcast-email';
import {
  audienceSelectionToJson,
  parseAudienceSelection,
  type BroadcastAudienceSelection,
} from '@/lib/platform/broadcast-audience';

/** What the composer posts when it saves a draft or sends. Every field is optional on a save. */
const draftSchema = z.object({
  subject: z.string().max(BROADCAST_LIMITS.subject).optional(),
  content: z.record(z.string(), z.unknown()).optional(),
  important: z.boolean().optional(),
  audience: z.record(z.string(), z.unknown()).optional(),
});

export interface ParsedDraft {
  subject?: string;
  content?: BroadcastContent;
  important?: boolean;
  audience?: BroadcastAudienceSelection;
}

export function parseDraftPayload(json: unknown): ParsedDraft | null {
  const parsed = draftSchema.safeParse(json ?? {});
  if (!parsed.success) return null;
  const d = parsed.data;
  return {
    subject: d.subject,
    content: d.content ? normaliseBroadcastContent(d.content) : undefined,
    important: d.important,
    audience: d.audience ? parseAudienceSelection(d.audience) : undefined,
  };
}

/** Column updates for platform_broadcasts from a parsed draft. */
export function draftToColumns(d: ParsedDraft): Record<string, unknown> {
  const cols: Record<string, unknown> = {};
  if (d.subject !== undefined) cols.subject = d.subject;
  if (d.content !== undefined) cols.content = d.content;
  if (d.important !== undefined) cols.important = d.important;
  if (d.audience !== undefined) cols.audience = audienceSelectionToJson(d.audience);
  return cols;
}

export const BROADCAST_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
