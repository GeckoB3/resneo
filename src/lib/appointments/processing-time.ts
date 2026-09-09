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
/** How far past the end of the service a processing period may run. */
export const PROCESSING_TAIL_MAX_MINUTES = 480;

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
 * Sort by start, refuse overlaps, and bound each block against the service.
 *
 * A block must START inside the service or exactly at its end, and may run on
 * past the end: that trailing part is processing the client sits through after
 * the service itself (colour developing before a cut), which the practitioner
 * is free for and the next service of the same visit waits behind. It is not
 * part of the service duration, so `durationMinutes` here is the service (or
 * booking) length alone.
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
    if (b.start_minute < 0 || b.start_minute > durationMinutes) {
      return {
        ok: false,
        error: 'Processing periods must start within the service, or at its end',
      };
    }
    if (b.start_minute + b.duration_minutes > durationMinutes + PROCESSING_TAIL_MAX_MINUTES) {
      return {
        ok: false,
        error: `Processing time cannot run more than ${PROCESSING_TAIL_MAX_MINUTES} minutes past the end of the service`,
      };
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

/**
 * Where the practitioner's last busy stretch ends, in minutes from the start.
 *
 * Processing that runs to the end of the service (or past it, or is a chain of
 * touching blocks that does) means the practitioner is free from its start
 * onwards, so the calendar has nothing to paint after that point. Equals
 * `durationMinutes` when no block reaches the end.
 */
export function processingActiveEndMinutes(
  blocks: ProcessingTimeBlock[],
  durationMinutes: number,
): number {
  const limit = Math.max(0, durationMinutes);
  let end = limit;
  const sorted = [...blocks].sort((a, b) => b.start_minute - a.start_minute);
  for (const b of sorted) {
    const blockEnd = b.start_minute + b.duration_minutes;
    if (b.start_minute <= end && blockEnd >= end) end = Math.min(end, Math.max(0, b.start_minute));
  }
  return end;
}

/** How far the processing runs past the end of the service (0 when it does not). */
export function processingTailMinutes(
  blocks: ProcessingTimeBlock[],
  durationMinutes: number,
): number {
  const limit = Math.max(0, durationMinutes);
  let maxEnd = limit;
  for (const b of blocks) maxEnd = Math.max(maxEnd, b.start_minute + b.duration_minutes);
  return maxEnd - limit;
}

/**
 * From the start to the moment the diary moves on: the service, any processing
 * that runs past its end, then the buffer. This is what the next service of the
 * same visit waits behind, and the span the working-hours checks fit.
 */
export function serviceSpanMinutes(params: {
  durationMinutes: number;
  bufferMinutes: number;
  processingBlocks: ProcessingTimeBlock[] | null | undefined;
}): number {
  const d = Math.max(0, params.durationMinutes);
  return d + processingTailMinutes(params.processingBlocks ?? [], d) + Math.max(0, params.bufferMinutes);
}

export interface FitProcessingBlocksResult {
  /** Blocks that fit `toDurationMinutes`, sorted by start. */
  blocks: ProcessingTimeBlock[];
  /** Dropped: a middle gap that starts past the new end, or one left too short. */
  removed: ProcessingTimeBlock[];
  /** Kept but shortened. */
  trimmed: ProcessingTimeBlock[];
  /** Kept at their length but moved, because they hang off the end of the service. */
  shifted: ProcessingTimeBlock[];
  changed: boolean;
}

/**
 * Re-fit a processing pattern from the duration it was drawn against to a new one.
 *
 * Two kinds of block, treated differently:
 *
 * - A gap that runs to the end of the old duration, or past it (a chain of
 *   touching blocks counts as one), is the wait AFTER the practitioner's last
 *   stretch, so it moves with the end: lengthening the service pushes it later,
 *   shortening pulls it earlier. Its length never changes.
 * - A gap in the middle stays where the practitioner put it. Shortening past it
 *   trims it to the new end, and a trim leaving less than
 *   `PROCESSING_BLOCK_MIN_MINUTES` drops it instead; one that would now start
 *   after the end is dropped too.
 *
 * A moved tail never overlaps a middle gap (it starts no earlier than the gap
 * ends) and never starts before 0, so the result always validates.
 */
export function fitProcessingBlocksToDuration(
  blocks: ProcessingTimeBlock[],
  params: { fromDurationMinutes: number; toDurationMinutes: number },
): FitProcessingBlocksResult {
  const from = Math.max(0, Math.floor(params.fromDurationMinutes));
  const to = Math.max(0, Math.floor(params.toDurationMinutes));
  const sorted = [...blocks].sort((a, z) => a.start_minute - z.start_minute);
  const tailStart = processingActiveEndMinutes(sorted, from);
  const delta = to - from;

  const kept: ProcessingTimeBlock[] = [];
  const removed: ProcessingTimeBlock[] = [];
  const trimmed: ProcessingTimeBlock[] = [];
  const shifted: ProcessingTimeBlock[] = [];
  let prevEnd = 0;

  for (const b of sorted) {
    // Already too short to be a block at all (only reachable from hand-edited rows).
    if (b.duration_minutes < PROCESSING_BLOCK_MIN_MINUTES) {
      removed.push(b);
      continue;
    }
    const reachesEnd = b.start_minute >= tailStart;
    let start = Math.max(0, b.start_minute);
    let end = b.start_minute + b.duration_minutes;
    if (reachesEnd) {
      start += delta;
      end += delta;
    } else if (start > to) {
      removed.push(b);
      continue;
    } else if (end > to) {
      end = to;
    }
    start = Math.max(0, start, prevEnd);
    if (end - start < PROCESSING_BLOCK_MIN_MINUTES) {
      removed.push(b);
      continue;
    }
    const out =
      start === b.start_minute && end - start === b.duration_minutes
        ? b
        : { ...b, start_minute: start, duration_minutes: end - start };
    kept.push(out);
    prevEnd = end;
    if (out.duration_minutes < b.duration_minutes) trimmed.push(out);
    else if (out.start_minute !== b.start_minute) shifted.push(out);
  }

  return {
    blocks: kept,
    removed,
    trimmed,
    shifted,
    changed: removed.length > 0 || trimmed.length > 0 || shifted.length > 0,
  };
}

/**
 * The blocks a modification should send when it changes a booking's duration.
 *
 * Mirrors how the server resolves them, so the client sends what the validator
 * was going to judge anyway: a stored snapshot wins even when it is empty (that
 * booking deliberately has no gap), a missing snapshot falls back to the
 * catalogue template, and `undefined` means the caller never loaded the column,
 * where sending nothing and leaving the row alone is the only safe answer.
 *
 * The snapshot was drawn against the booking's CURRENT length and the template
 * against the catalogue's, so each is re-fitted from its own.
 */
export function processingBlocksForDurationChange(params: {
  /** Raw `bookings.processing_time_blocks`; `undefined` when not loaded. */
  snapshot: unknown;
  /** The booking's length before this change. */
  currentDurationMinutes: number;
  /** Catalogue pattern for the booking's service and variant. */
  templateBlocks: ProcessingTimeBlock[];
  /** The catalogue length that pattern was drawn against. */
  templateDurationMinutes: number;
  durationMinutes: number;
}): ProcessingTimeBlock[] | null {
  const { snapshot, templateBlocks, durationMinutes } = params;
  if (snapshot === undefined) return null;
  if (snapshot === null) {
    return fitProcessingBlocksToDuration(templateBlocks, {
      fromDurationMinutes: params.templateDurationMinutes,
      toDurationMinutes: durationMinutes,
    }).blocks;
  }
  return fitProcessingBlocksToDuration(parseProcessingTimeBlocksFromDb(snapshot), {
    fromDurationMinutes: params.currentDurationMinutes,
    toDurationMinutes: durationMinutes,
  }).blocks;
}

/** Default length for a block added in the service form. */
export const PROCESSING_BLOCK_DEFAULT_MINUTES = PROCESSING_BLOCK_MIN_MINUTES * 2;

/**
 * Where the service form places a newly added processing block.
 *
 * The first one goes AFTER the service: it starts at the end and runs on, which
 * is the common case (colour develops once the stylist has finished applying it,
 * the chair is free, and the next service of the visit waits behind it). Once a
 * period already runs past the end, a further one goes at the end of the latest
 * free stretch inside the service, kept clear of the trailing run so the two
 * stay distinct. Returns null when nothing fits.
 */
export function placeNewProcessingBlock(
  blocks: ProcessingTimeBlock[],
  durationMinutes: number,
): Pick<ProcessingTimeBlock, 'start_minute' | 'duration_minutes'> | null {
  const limit = Math.max(0, Math.floor(durationMinutes));
  if (limit < PROCESSING_BLOCK_MIN_MINUTES) return null;
  if (processingTailMinutes(blocks, limit) === 0) {
    return { start_minute: limit, duration_minutes: PROCESSING_BLOCK_DEFAULT_MINUTES };
  }
  const sorted = [...blocks].sort((a, b) => a.start_minute - b.start_minute);
  // Leave one minimum stretch of active time before the trailing run.
  let gapEnd = Math.min(limit, processingActiveEndMinutes(sorted, limit) - PROCESSING_BLOCK_MIN_MINUTES);
  for (let i = sorted.length - 1; i >= -1; i--) {
    const gapStart = i >= 0 ? Math.min(gapEnd, sorted[i]!.start_minute + sorted[i]!.duration_minutes) : 0;
    const room = gapEnd - gapStart;
    if (room >= PROCESSING_BLOCK_MIN_MINUTES) {
      const duration = Math.min(PROCESSING_BLOCK_DEFAULT_MINUTES, room);
      return { start_minute: gapEnd - duration, duration_minutes: duration };
    }
    if (i >= 0) gapEnd = Math.min(gapEnd, sorted[i]!.start_minute);
  }
  return null;
}

/**
 * A block's new position after its length is edited in the service form.
 *
 * Start and Length are what they say, with one exception: a block that ends
 * exactly at the end of the service and starts before it stays anchored there,
 * so making it longer moves its start earlier rather than pushing it past the
 * end. A block that starts at the end (or already runs past it) simply grows
 * later, which is how a period after the service is set. The start never goes
 * below 0.
 */
export function resizeProcessingBlock(
  block: ProcessingTimeBlock,
  nextDurationMinutes: number,
  durationMinutes: number,
): ProcessingTimeBlock {
  const limit = Math.max(0, Math.floor(durationMinutes));
  const endsAtLimit =
    block.start_minute < limit && block.start_minute + block.duration_minutes === limit;
  const start = endsAtLimit ? Math.max(0, limit - nextDurationMinutes) : block.start_minute;
  return { ...block, start_minute: start, duration_minutes: nextDurationMinutes };
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
 * Processing that runs past the end of the service is free time; the buffer comes after it.
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
    // Turnover follows the client's time here, so processing that runs past
    // the end of the service pushes the buffer back with it.
    const extent = d + processingTailMinutes(blocks, d);
    if (buf > 0) {
      busy.push({ start: extent, end: extent + buf });
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

/**
 * A service row at another length, its pattern re-fitted from the length it was
 * drawn against. For the engine inputs the create routes extend with add-on or
 * staff minutes: without the re-fit, a wait after the service would sit inside
 * the extended duration and free time the practitioner is actually working.
 */
export function serviceWithDurationMinutes<
  T extends { duration_minutes: number; processing_time_blocks?: ProcessingTimeBlock[] },
>(svc: T, durationMinutes: number): T {
  if (durationMinutes === svc.duration_minutes) return svc;
  return {
    ...svc,
    duration_minutes: durationMinutes,
    processing_time_blocks: fitProcessingBlocksToDuration(svc.processing_time_blocks ?? [], {
      fromDurationMinutes: svc.duration_minutes,
      toDurationMinutes: durationMinutes,
    }).blocks,
  };
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

/**
 * The snapshot for a booking whose length differs from the catalogue's (add-on
 * minutes, a staff custom duration): the pattern re-fitted from the length it
 * was drawn against, so a wait after the service still follows the whole
 * appointment rather than starting where the catalogue service would have ended.
 */
export function snapshotProcessingTimeBlocksForBooking(params: {
  service: Pick<AppointmentService, 'processing_time_blocks'>;
  variant: Pick<ServiceVariant, 'processing_time_blocks'> | null | undefined;
  /** The catalogue length the pattern belongs to: the variant's, else the service's, add-ons excluded. */
  templateDurationMinutes: number;
  /** The length the booking is being written with. */
  bookingDurationMinutes: number;
}): ProcessingTimeBlock[] {
  const template = snapshotProcessingTimeBlocksFromCatalog(params);
  if (params.templateDurationMinutes === params.bookingDurationMinutes) return template;
  return fitProcessingBlocksToDuration(template, {
    fromDurationMinutes: params.templateDurationMinutes,
    toDurationMinutes: params.bookingDurationMinutes,
  }).blocks;
}

/**
 * One shape for "processing that reaches the end of the service".
 *
 * Two stored shapes said the same thing: a 120 minute service with a block at
 * 60 to 120 (the shape the editor produced before 2026-09-08), and a 60 minute
 * service with a block at 60 to 120 (the shape it produces now). The engine and
 * the diary already read both as "the practitioner is free from minute 60", but
 * the booked length (`booking_end_time`, the modify form, the customer's
 * confirmation) came from `duration_minutes`, so the old shape booked two hours
 * where the new shape booked one, and the same service copied into a partner
 * venue behaved differently from its origin. The owner's rule: the service
 * duration excludes any processing that runs to or beyond its end.
 *
 * The first shape becomes the second: the duration shrinks to where the
 * end-reaching run of blocks starts, and that run (touching blocks count as
 * one) is merged into a single block from there, so it validates against the
 * shorter duration. Blocks with free time after them stay where they are.
 * Total span (duration plus tail) is unchanged, so nothing about chaining,
 * hours gates or busy time moves.
 */
export function canonicalServiceShape(params: {
  durationMinutes: number;
  processingBlocks: ProcessingTimeBlock[] | null | undefined;
}): { durationMinutes: number; processingBlocks: ProcessingTimeBlock[]; changed: boolean } {
  const duration = Math.max(0, params.durationMinutes);
  const blocks = params.processingBlocks ?? [];
  if (blocks.length === 0) return { durationMinutes: duration, processingBlocks: blocks, changed: false };
  const activeEnd = processingActiveEndMinutes(blocks, duration);
  if (activeEnd >= duration || activeEnd < PROCESSING_BLOCK_MIN_MINUTES) {
    return { durationMinutes: duration, processingBlocks: blocks, changed: false };
  }
  const sorted = [...blocks].sort((a, b) => a.start_minute - b.start_minute);
  const middle = sorted.filter((b) => b.start_minute < activeEnd);
  const run = sorted.filter((b) => b.start_minute >= activeEnd);
    const runEnd = Math.max(...run.map((b) => b.start_minute + b.duration_minutes));
  // The merged tail must still pass validation; a longer one is left as stored.
  if (runEnd - activeEnd > PROCESSING_TAIL_MAX_MINUTES) {
    return { durationMinutes: duration, processingBlocks: blocks, changed: false };
  }
  const merged: ProcessingTimeBlock = {
    ...run[0]!,
    start_minute: activeEnd,
    duration_minutes: runEnd - activeEnd,
  };
  return { durationMinutes: activeEnd, processingBlocks: [...middle, merged], changed: true };
}
