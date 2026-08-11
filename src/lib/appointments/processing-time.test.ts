import { describe, it, expect } from 'vitest';
import type { ProcessingTimeBlock } from '@/types/booking-models';
import {
  busyIntervalsOverlap,
  effectiveProcessingBlocksForTemplate,
  fitProcessingBlocksToDuration,
  parseProcessingTimeBlocksFromDb,
  practitionerBusyMinuteOffsets,
  processingBlocksForDurationChange,
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

  describe('fitProcessingBlocksToDuration', () => {
    const colour: ProcessingTimeBlock[] = [{ id: 'a', start_minute: 15, duration_minutes: 30 }];

    it('leaves blocks alone when they still fit', () => {
      const same = fitProcessingBlocksToDuration(colour, 60);
      expect(same.blocks).toEqual(colour);
      expect(same.changed).toBe(false);

      const longer = fitProcessingBlocksToDuration(colour, 120);
      expect(longer.blocks).toEqual(colour);
      expect(longer.changed).toBe(false);
    });

    it('trims a block that straddles the new end', () => {
      const r = fitProcessingBlocksToDuration(colour, 40);
      expect(r.blocks).toEqual([{ id: 'a', start_minute: 15, duration_minutes: 25 }]);
      expect(r.trimmed).toHaveLength(1);
      expect(r.removed).toHaveLength(0);
      expect(r.changed).toBe(true);
    });

    it('removes a block with no room left rather than trimming below the minimum', () => {
      const r = fitProcessingBlocksToDuration(colour, 18);
      expect(r.blocks).toEqual([]);
      expect(r.removed).toHaveLength(1);
      expect(r.trimmed).toHaveLength(0);
    });

    it('removes blocks that start at or past the new end', () => {
      const r = fitProcessingBlocksToDuration(colour, 15);
      expect(r.blocks).toEqual([]);
      expect(r.removed).toHaveLength(1);
    });

    it('keeps earlier blocks while dropping later ones', () => {
      const two: ProcessingTimeBlock[] = [
        { id: 'b', start_minute: 60, duration_minutes: 20 },
        { id: 'a', start_minute: 10, duration_minutes: 15 },
      ];
      const r = fitProcessingBlocksToDuration(two, 45);
      expect(r.blocks).toEqual([{ id: 'a', start_minute: 10, duration_minutes: 15 }]);
      expect(r.removed.map((b) => b.id)).toEqual(['b']);
    });

    /** The whole point: whatever comes back must clear the gate that produced the bug. */
    it('produces blocks the interval validator accepts', () => {
      for (const duration of [5, 15, 18, 25, 40, 45, 60, 90]) {
        const r = fitProcessingBlocksToDuration(colour, duration);
        expect(validateProcessingTimeBlocks(r.blocks, duration).ok).toBe(true);
      }
    });

    it('drops everything for a duration too short to hold any block', () => {
      const r = fitProcessingBlocksToDuration(colour, 4);
      expect(r.blocks).toEqual([]);
      expect(validateProcessingTimeBlocks(r.blocks, 4).ok).toBe(true);
    });
  });

  describe('processingBlocksForDurationChange', () => {
    const template: ProcessingTimeBlock[] = [{ id: 't', start_minute: 15, duration_minutes: 30 }];
    const snapshot = [{ id: '5a3c1f7e-0000-4000-8000-000000000001', start_minute: 20, duration_minutes: 20 }];

    it('sends nothing when the caller never loaded the column', () => {
      // Guessing [] here would clear real processing time on save.
      expect(
        processingBlocksForDurationChange({ snapshot: undefined, templateBlocks: template, durationMinutes: 40 }),
      ).toBeNull();
    });

    it('prefers the stored snapshot over the catalogue', () => {
      expect(
        processingBlocksForDurationChange({ snapshot, templateBlocks: template, durationMinutes: 60 }),
      ).toEqual(snapshot);
    });

    it('treats an empty snapshot as "this booking has no gap", not as missing', () => {
      // The server does the same, so falling back to the template here would
      // add processing time the booking deliberately does not have.
      expect(
        processingBlocksForDurationChange({ snapshot: [], templateBlocks: template, durationMinutes: 60 }),
      ).toEqual([]);
    });

    it('falls back to the catalogue only when the column is null', () => {
      expect(
        processingBlocksForDurationChange({ snapshot: null, templateBlocks: template, durationMinutes: 60 }),
      ).toEqual(template);
    });

    it('fits whatever it resolved to the new duration', () => {
      expect(
        processingBlocksForDurationChange({ snapshot, templateBlocks: template, durationMinutes: 30 }),
      ).toEqual([{ ...snapshot[0]!, duration_minutes: 10 }]);
      expect(
        processingBlocksForDurationChange({ snapshot: null, templateBlocks: template, durationMinutes: 30 }),
      ).toEqual([{ ...template[0]!, duration_minutes: 15 }]);
    });
  });

  it('busyIntervalsOverlap detects any crossing pair', () => {
    expect(busyIntervalsOverlap([{ start: 10, end: 20 }], [{ start: 5, end: 12 }])).toBe(true);
    expect(busyIntervalsOverlap([{ start: 10, end: 20 }], [{ start: 20, end: 30 }])).toBe(false);
  });
});
