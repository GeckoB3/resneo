import { describe, it, expect } from 'vitest';
import type { ProcessingTimeBlock } from '@/types/booking-models';
import {
  busyIntervalsOverlap,
  effectiveProcessingBlocksForTemplate,
  parseProcessingTimeBlocksFromDb,
  practitionerBusyMinuteOffsets,
  snapshotProcessingTimeBlocksFromCatalog,
  validateProcessingTimeBlocks,
} from './processing-time';

describe('processing-time', () => {
  it('validateProcessingTimeBlocks rejects overlap and out-of-range', () => {
    const blocks: ProcessingTimeBlock[] = [
      { id: 'a', start_minute: 0, duration_minutes: 20 },
      { id: 'b', start_minute: 15, duration_minutes: 10 },
    ];
    const r = validateProcessingTimeBlocks(blocks, 60);
    expect(r.ok).toBe(false);
    const ok = validateProcessingTimeBlocks([{ id: 'c', start_minute: 0, duration_minutes: 15 }], 60);
    expect(ok.ok).toBe(true);
    const past = validateProcessingTimeBlocks([{ id: 'd', start_minute: 50, duration_minutes: 15 }], 60);
    expect(past.ok).toBe(false);
  });

  it('practitionerBusyMinuteOffsets uses gaps for blocks and ignores legacy tail when blocks present', () => {
    const blocks: ProcessingTimeBlock[] = [{ id: 'p', start_minute: 20, duration_minutes: 20 }];
    const busy = practitionerBusyMinuteOffsets({
      durationMinutes: 60,
      bufferMinutes: 10,
      processingBlocks: blocks,
      legacyProcessingTailMinutes: 30,
    });
    expect(busy).toEqual([
      { start: 0, end: 20 },
      { start: 40, end: 70 },
    ]);
  });

  it('practitionerBusyMinuteOffsets uses single contiguous interval for legacy tail only', () => {
    const busy = practitionerBusyMinuteOffsets({
      durationMinutes: 40,
      bufferMinutes: 5,
      processingBlocks: [],
      legacyProcessingTailMinutes: 10,
    });
    expect(busy).toEqual([{ start: 0, end: 55 }]);
  });

  it('parseProcessingTimeBlocksFromDb tolerates bad JSON and assigns ids', () => {
    expect(parseProcessingTimeBlocksFromDb(null)).toEqual([]);
    expect(parseProcessingTimeBlocksFromDb([{ start_minute: 0, duration_minutes: 10 }])).toHaveLength(1);
    expect(parseProcessingTimeBlocksFromDb([{ start_minute: 0, duration_minutes: 10 }])[0]!.id).toBeTruthy();
  });

  it('effectiveProcessingBlocksForTemplate prefers variant when non-empty', () => {
    const parent: ProcessingTimeBlock[] = [{ id: '1', start_minute: 0, duration_minutes: 10 }];
    const variant: ProcessingTimeBlock[] = [{ id: '2', start_minute: 30, duration_minutes: 10 }];
    expect(effectiveProcessingBlocksForTemplate({ parentBlocks: parent, variantBlocks: [] })).toEqual(parent);
    expect(effectiveProcessingBlocksForTemplate({ parentBlocks: parent, variantBlocks: variant })).toEqual(variant);
  });

  it('snapshotProcessingTimeBlocksFromCatalog matches effective template', () => {
    const s = snapshotProcessingTimeBlocksFromCatalog({
      service: { processing_time_blocks: [{ id: 'x', start_minute: 5, duration_minutes: 10 }] },
      variant: { processing_time_blocks: [{ id: 'y', start_minute: 20, duration_minutes: 10 }] },
    });
    expect(s[0]!.start_minute).toBe(20);
  });

  it('busyIntervalsOverlap detects any crossing pair', () => {
    expect(busyIntervalsOverlap([{ start: 10, end: 20 }], [{ start: 5, end: 12 }])).toBe(true);
    expect(busyIntervalsOverlap([{ start: 10, end: 20 }], [{ start: 20, end: 30 }])).toBe(false);
  });
});
