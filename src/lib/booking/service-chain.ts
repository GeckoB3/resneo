import { z } from 'zod';

/**
 * A visit made of several services booked back to back with one person.
 *
 * The guest ticks every service first; the availability route then looks for
 * starts where the WHOLE chain fits (see `appointment-chain.ts`). This module
 * holds the shape that crosses the wire (`services` query parameter on
 * `GET /api/booking/availability`) and the arithmetic both sides share.
 */

/** Most services one visit can hold; also the `create-multi-service` cap. */
export const MAX_SERVICES_PER_VISIT = 4;

export const serviceChainSegmentSchema = z.object({
  service_id: z.string().uuid(),
  variant_id: z.string().uuid().optional().nullable(),
  addon_ids: z.array(z.string().uuid()).max(50).optional(),
  /**
   * Staff custom duration for this segment (the dashboard's per-service
   * override). Public callers may send it too; it only narrows what fits.
   */
  duration_minutes: z.number().int().min(5).max(14 * 60).optional().nullable(),
});

export const serviceChainSchema = z.array(serviceChainSegmentSchema).min(1).max(MAX_SERVICES_PER_VISIT);

export type ServiceChainSegmentParam = z.infer<typeof serviceChainSegmentSchema>;

/**
 * Parse the `services` query parameter. Returns null when absent, and an
 * error string when present but malformed, so the route can answer 400.
 */
export function parseServiceChainParam(
  raw: string | null,
): { ok: true; chain: ServiceChainSegmentParam[] | null } | { ok: false; error: string } {
  if (raw == null || raw === '') return { ok: true, chain: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'services must be JSON' };
  }
  const result = serviceChainSchema.safeParse(parsed);
  if (!result.success) return { ok: false, error: 'Invalid services' };
  return { ok: true, chain: result.data };
}

/** Serialise the chain for the query string, dropping empty optionals. */
export function serialiseServiceChainParam(chain: ServiceChainSegmentParam[]): string {
  return JSON.stringify(
    chain.map((s) => ({
      service_id: s.service_id,
      ...(s.variant_id ? { variant_id: s.variant_id } : {}),
      ...(s.addon_ids && s.addon_ids.length > 0 ? { addon_ids: s.addon_ids } : {}),
      ...(s.duration_minutes != null ? { duration_minutes: s.duration_minutes } : {}),
    })),
  );
}

/**
 * Minutes from the first start to the last end, counting the buffer between
 * services but not the buffer after the last one. This is the block the
 * month view asks about, since the month route only knows one length.
 */
export function chainSpanMinutes(
  segments: ReadonlyArray<{ durationMinutes: number; bufferMinutes: number }>,
): number {
  let total = 0;
  segments.forEach((seg, i) => {
    total += seg.durationMinutes;
    if (i < segments.length - 1) total += seg.bufferMinutes;
  });
  return total;
}
