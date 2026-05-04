import { z } from 'zod';
import type { AppointmentService, ProcessingTimeBlock, ServiceVariant } from '@/types/booking-models';

function newBlockId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    return c.randomUUID();
  }
  return `blk_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}

export const processingTimeBlockSchema = z.object({
  id: z.string().uuid().optional(),
  start_minute: z.number().int().min(0),
  duration_minutes: z.number().int().min(1),
});

export const processingTimeBlocksSchema = z.array(processingTimeBlockSchema).max(20);

export const PROCESSING_BLOCK_MIN_MINUTES = 5;

function ensureBlockIds(blocks: z.infer<typeof processingTimeBlockSchema>[]): ProcessingTimeBlock[] {
  return blocks.map((b) => ({
    id: b.id ?? newBlockId(),
    start_minute: b.start_minute,
    duration_minutes: b.duration_minutes,
  }));
}

/**
 * Parse JSON from DB/API; returns empty array on invalid input.
 */
export function parseProcessingTimeBlocksFromDb(raw: unknown): ProcessingTimeBlock[] {
  if (raw == null) return [];
  const parsed = processingTimeBlocksSchema.safeParse(raw);
  if (!parsed.success) return [];
  return ensureBlockIds(parsed.data);
}

export interface ValidateBlocksResult {
  ok: boolean;
  error?: string;
  normalized?: ProcessingTimeBlock[];
}

/**
 * Sort by start, merge overlaps into error, clamp to duration.
 */
export function validateProcessingTimeBlocks(
  blocks: ProcessingTimeBlock[],
  durationMinutes: number,
): ValidateBlocksResult {
  if (blocks.length === 0) {
    return { ok: true, normalized: [] };
  }
  if (durationMinutes < PROCESSING_BLOCK_MIN_MINUTES) {
    return { ok: false, error: 'Duration is too short for processing time blocks' };
  }
  const sorted = [...blocks].sort((a, b) => a.start_minute - b.start_minute);
  for (const b of sorted) {
    if (b.duration_minutes < PROCESSING_BLOCK_MIN_MINUTES) {
      return {
        ok: false,
        error: `Each processing block must be at least ${PROCESSING_BLOCK_MIN_MINUTES} minutes`,
      };
    }
    if (b.start_minute < 0 || b.start_minute + b.duration_minutes > durationMinutes) {
      return { ok: false, error: 'Processing blocks must lie within the service duration (before buffer)' };
    }
  }
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    if (cur.start_minute < prev.start_minute + prev.duration_minutes) {
      return { ok: false, error: 'Processing blocks must not overlap' };
    }
  }
  const withIds: ProcessingTimeBlock[] = sorted.map((b) => ({
    ...b,
    id: b.id ?? newBlockId(),
  }));
  return { ok: true, normalized: withIds };
}

/** Total customer + turnover span on the calendar (core + buffer). */
export function customerOccupyMinutes(
  durationMinutes: number,
  bufferMinutes: number,
): number {
  return durationMinutes + bufferMinutes;
}

/**
 * Practitioner-busy intervals as minute offsets from booking start (half-open [start, end)).
 * When `processingBlocks` is non-empty, legacy `processing_time_minutes` tail is ignored for conflicts.
 */
export function practitionerBusyMinuteOffsets(params: {
  durationMinutes: number;
  bufferMinutes: number;
  processingBlocks: ProcessingTimeBlock[];
  legacyProcessingTailMinutes: number;
}): Array<{ start: number; end: number }> {
  const { durationMinutes, bufferMinutes, processingBlocks, legacyProcessingTailMinutes } = params;
  const buf = Math.max(0, bufferMinutes);
  const d = Math.max(0, durationMinutes);

  if (processingBlocks.length > 0) {
    const validated = validateProcessingTimeBlocks(processingBlocks, d);
    const blocks = validated.ok ? validated.normalized! : [];
    const busy: Array<{ start: number; end: number }> = [];
    let cursor = 0;
    for (const blk of blocks) {
      if (blk.start_minute > cursor) {
        busy.push({ start: cursor, end: blk.start_minute });
      }
      cursor = Math.max(cursor, blk.start_minute + blk.duration_minutes);
    }
    if (cursor < d) {
      busy.push({ start: cursor, end: d });
    }
    if (buf > 0) {
      busy.push({ start: d, end: d + buf });
    }
    return mergeBusyOffsets(busy);
  }

  const tail = Math.max(0, legacyProcessingTailMinutes);
  const end = d + buf + tail;
  if (end <= 0) return [];
  return [{ start: 0, end }];
}

function mergeBusyOffsets(intervals: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const out: Array<{ start: number; end: number }> = [];
  for (const cur of sorted) {
    if (cur.end <= cur.start) continue;
    const last = out[out.length - 1];
    if (!last || cur.start > last.end) {
      out.push({ ...cur });
    } else {
      last.end = Math.max(last.end, cur.end);
    }
  }
  return out;
}

export function offsetsOverlapWallClock(
  bookingStartMin: number,
  offsets: Array<{ start: number; end: number }>,
  rangeStart: number,
  rangeEnd: number,
): boolean {
  for (const o of offsets) {
    const a = bookingStartMin + o.start;
    const b = bookingStartMin + o.end;
    if (a < rangeEnd && rangeStart < b) return true;
  }
  return false;
}

/** True if any busy offset pair overlaps (half-open). */
export function busyIntervalsOverlap(
  a: Array<{ start: number; end: number }>,
  b: Array<{ start: number; end: number }>,
): boolean {
  for (const ia of a) {
    for (const ib of b) {
      if (ia.start < ib.end && ib.start < ia.end) return true;
    }
  }
  return false;
}

/** Variant blocks override parent when non-empty; otherwise parent template applies. */
export function effectiveProcessingBlocksForTemplate(params: {
  parentBlocks: ProcessingTimeBlock[];
  variantBlocks: ProcessingTimeBlock[] | null | undefined;
}): ProcessingTimeBlock[] {
  const v = params.variantBlocks;
  if (v && v.length > 0) return v;
  return params.parentBlocks;
}

/** Persisted on `bookings.processing_time_blocks` at creation from catalog + variant. */
export function snapshotProcessingTimeBlocksFromCatalog(params: {
  service: Pick<AppointmentService, 'processing_time_blocks'>;
  variant: Pick<ServiceVariant, 'processing_time_blocks'> | null | undefined;
}): ProcessingTimeBlock[] {
  return effectiveProcessingBlocksForTemplate({
    parentBlocks: params.service.processing_time_blocks ?? [],
    variantBlocks: params.variant?.processing_time_blocks,
  });
}
