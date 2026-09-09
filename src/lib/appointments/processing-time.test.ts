import { describe, it, expect } from 'vitest';
import type { ProcessingTimeBlock } from '@/types/booking-models';
import { canonicalServiceShape } from './processing-time';
import {
  PROCESSING_TAIL_MAX_MINUTES,
  busyIntervalsOverlap,
  effectiveProcessingBlocksForTemplate,
  fitProcessingBlocksToDuration,
  parseProcessingTimeBlocksFromDb,
  placeNewProcessingBlock,
  practitionerBusyMinuteOffsets,
  processingActiveEndMinutes,
  processingBlocksForDurationChange,
  processingTailMinutes,
  resizeProcessingBlock,
  serviceSpanMinutes,
  snapshotProcessingTimeBlocksForBooking,
  snapshotProcessingTimeBlocksFromCatalog,
  validateProcessingTimeBlocks,
} from './processing-time';

describe('processing-time', () => {
  it('validateProcessingTimeBlocks rejects overlap and a start past the end', () => {
    const blocks: ProcessingTimeBlock[] = [
      { id: 'a', start_minute: 0, duration_minutes: 20 },
      { id: 'b', start_minute: 15, duration_minutes: 10 },
    ];
    const r = validateProcessingTimeBlocks(blocks, 60);
    expect(r.ok).toBe(false);
    const ok = validateProcessingTimeBlocks([{ id: 'c', start_minute: 0, duration_minutes: 15 }], 60);
    expect(ok.ok).toBe(true);
    // Starts after the service has ended: nothing for it to be processing.
    const past = validateProcessingTimeBlocks([{ id: 'd', start_minute: 61, duration_minutes: 15 }], 60);
    expect(past.ok).toBe(false);
    expect(past.error).toMatch(/start within the service, or at its end/);
  });

  /**
   * The wait after a service (colour developing before the cut) is a block that
   * starts at the end of the service and runs on. It used to be refused as
   * "must lie within the service duration".
   */
  it('validateProcessingTimeBlocks accepts processing that runs past the end of the service', () => {
    expect(validateProcessingTimeBlocks([{ id: 't', start_minute: 60, duration_minutes: 30 }], 60).ok).toBe(true);
    expect(validateProcessingTimeBlocks([{ id: 's', start_minute: 50, duration_minutes: 25 }], 60).ok).toBe(true);
    const tooFar = validateProcessingTimeBlocks(
      [{ id: 'x', start_minute: 60, duration_minutes: PROCESSING_TAIL_MAX_MINUTES + 1 }],
      60,
    );
    expect(tooFar.ok).toBe(false);
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

  it('practitionerBusyMinuteOffsets frees the practitioner for a wait after the service and moves the buffer behind it', () => {
    const busy = practitionerBusyMinuteOffsets({
      durationMinutes: 60,
      bufferMinutes: 10,
      processingBlocks: [{ id: 't', start_minute: 60, duration_minutes: 30 }],
      legacyProcessingTailMinutes: 0,
    });
    expect(busy).toEqual([
      { start: 0, end: 60 },
      { start: 90, end: 100 },
    ]);
    // A block that starts inside the service and runs past it: free from its start.
    expect(
      practitionerBusyMinuteOffsets({
        durationMinutes: 60,
        bufferMinutes: 0,
        processingBlocks: [{ id: 's', start_minute: 45, duration_minutes: 30 }],
        legacyProcessingTailMinutes: 0,
      }),
    ).toEqual([{ start: 0, end: 45 }]);
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

  describe('processingActiveEndMinutes / processingTailMinutes / serviceSpanMinutes', () => {
    it('reports the whole duration when no block reaches the end', () => {
      const mid: ProcessingTimeBlock[] = [{ id: 'm', start_minute: 20, duration_minutes: 20 }];
      expect(processingActiveEndMinutes(mid, 60)).toBe(60);
      expect(processingTailMinutes(mid, 60)).toBe(0);
      expect(serviceSpanMinutes({ durationMinutes: 60, bufferMinutes: 10, processingBlocks: mid })).toBe(70);
    });

    it('ends the active span where processing that reaches the end begins', () => {
      expect(processingActiveEndMinutes([{ id: 'e', start_minute: 50, duration_minutes: 10 }], 60)).toBe(50);
      expect(processingActiveEndMinutes([{ id: 's', start_minute: 45, duration_minutes: 30 }], 60)).toBe(45);
      expect(processingActiveEndMinutes([{ id: 't', start_minute: 60, duration_minutes: 30 }], 60)).toBe(60);
    });

    it('treats touching blocks that run to the end as one trailing run', () => {
      const run: ProcessingTimeBlock[] = [
        { id: 'a', start_minute: 20, duration_minutes: 30 },
        { id: 'b', start_minute: 50, duration_minutes: 10 },
        { id: 'c', start_minute: 60, duration_minutes: 30 },
      ];
      expect(processingActiveEndMinutes(run, 60)).toBe(20);
      expect(processingTailMinutes(run, 60)).toBe(30);
      expect(serviceSpanMinutes({ durationMinutes: 60, bufferMinutes: 10, processingBlocks: run })).toBe(100);
    });
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

  it('snapshotProcessingTimeBlocksForBooking keeps a wait after the service behind add-on minutes', () => {
    const service = { processing_time_blocks: [{ id: 't', start_minute: 60, duration_minutes: 30 }] };
    // A 60 minute colour with a 15 minute add-on is 75 minutes long; the develop still follows it.
    expect(
      snapshotProcessingTimeBlocksForBooking({
        service,
        variant: null,
        templateDurationMinutes: 60,
        bookingDurationMinutes: 75,
      }),
    ).toEqual([{ id: 't', start_minute: 75, duration_minutes: 30 }]);
    // Same length: the template exactly as it is.
    expect(
      snapshotProcessingTimeBlocksForBooking({
        service,
        variant: null,
        templateDurationMinutes: 60,
        bookingDurationMinutes: 60,
      }),
    ).toEqual(service.processing_time_blocks);
  });

  describe('fitProcessingBlocksToDuration', () => {
    const colour: ProcessingTimeBlock[] = [{ id: 'a', start_minute: 15, duration_minutes: 30 }];
    const fit = (blocks: ProcessingTimeBlock[], from: number, to: number) =>
      fitProcessingBlocksToDuration(blocks, { fromDurationMinutes: from, toDurationMinutes: to });

    it('leaves a middle gap alone when it still fits', () => {
      const same = fit(colour, 60, 60);
      expect(same.blocks).toEqual(colour);
      expect(same.changed).toBe(false);

      const longer = fit(colour, 60, 120);
      expect(longer.blocks).toEqual(colour);
      expect(longer.changed).toBe(false);
    });

    it('trims a middle gap that straddles the new end', () => {
      const r = fit(colour, 60, 40);
      expect(r.blocks).toEqual([{ id: 'a', start_minute: 15, duration_minutes: 25 }]);
      expect(r.trimmed).toHaveLength(1);
      expect(r.removed).toHaveLength(0);
      expect(r.changed).toBe(true);
    });

    it('removes a middle gap with no room left rather than trimming below the minimum', () => {
      const r = fit(colour, 60, 18);
      expect(r.blocks).toEqual([]);
      expect(r.removed).toHaveLength(1);
      expect(r.trimmed).toHaveLength(0);
    });

    it('removes middle gaps that start at or past the new end', () => {
      const r = fit(colour, 60, 15);
      expect(r.blocks).toEqual([]);
      expect(r.removed).toHaveLength(1);
    });

    it('keeps earlier middle gaps while dropping later ones', () => {
      const two: ProcessingTimeBlock[] = [
        { id: 'b', start_minute: 60, duration_minutes: 20 },
        { id: 'a', start_minute: 10, duration_minutes: 15 },
      ];
      const r = fit(two, 100, 45);
      expect(r.blocks).toEqual([{ id: 'a', start_minute: 10, duration_minutes: 15 }]);
      expect(r.removed.map((b) => b.id)).toEqual(['b']);
    });

    /**
     * The wait after the service belongs after the service, whatever its length:
     * a shorter colour still develops for as long, and so does a longer one.
     */
    it('moves a wait that runs past the end with the end, keeping its length', () => {
      const tail: ProcessingTimeBlock[] = [{ id: 't', start_minute: 60, duration_minutes: 30 }];
      expect(fit(tail, 60, 45).blocks).toEqual([{ id: 't', start_minute: 45, duration_minutes: 30 }]);
      expect(fit(tail, 60, 90).blocks).toEqual([{ id: 't', start_minute: 90, duration_minutes: 30 }]);
      const r = fit(tail, 60, 90);
      expect(r.shifted).toHaveLength(1);
      expect(r.changed).toBe(true);
    });

    it('moves a gap that runs to the end of the service the same way', () => {
      const endBlock: ProcessingTimeBlock[] = [{ id: 'e', start_minute: 50, duration_minutes: 10 }];
      expect(fit(endBlock, 60, 75).blocks).toEqual([{ id: 'e', start_minute: 65, duration_minutes: 10 }]);
      expect(fit(endBlock, 60, 30).blocks).toEqual([{ id: 'e', start_minute: 20, duration_minutes: 10 }]);
    });

    it('moves a whole trailing run of touching blocks together', () => {
      const run: ProcessingTimeBlock[] = [
        { id: 'a', start_minute: 50, duration_minutes: 10 },
        { id: 'b', start_minute: 60, duration_minutes: 30 },
      ];
      expect(fit(run, 60, 45).blocks).toEqual([
        { id: 'a', start_minute: 35, duration_minutes: 10 },
        { id: 'b', start_minute: 45, duration_minutes: 30 },
      ]);
    });

    it('never lets a moved wait overlap a middle gap, and never starts it before 0', () => {
      const both: ProcessingTimeBlock[] = [
        { id: 'm', start_minute: 10, duration_minutes: 10 },
        { id: 't', start_minute: 60, duration_minutes: 30 },
      ];
      // Shortened to 15: the wait would start at 15, which is fine (the gap ends at 20 only if...)
      const r = fit(both, 60, 15);
      expect(r.blocks).toEqual([
        { id: 'm', start_minute: 10, duration_minutes: 5 },
        { id: 't', start_minute: 15, duration_minutes: 30 },
      ]);
      // Shorter than the wait itself: it starts at 0, still its full length.
      const tail: ProcessingTimeBlock[] = [{ id: 't', start_minute: 60, duration_minutes: 30 }];
      expect(fit(tail, 60, 5).blocks).toEqual([{ id: 't', start_minute: 5, duration_minutes: 30 }]);
    });

    /** The whole point: whatever comes back must clear the gate that produced the bug. */
    it('produces blocks the interval validator accepts', () => {
      const patterns: ProcessingTimeBlock[][] = [
        colour,
        [{ id: 't', start_minute: 60, duration_minutes: 30 }],
        [
          { id: 'm', start_minute: 10, duration_minutes: 10 },
          { id: 'e', start_minute: 50, duration_minutes: 10 },
          { id: 't', start_minute: 60, duration_minutes: 30 },
        ],
      ];
      for (const pattern of patterns) {
        for (const duration of [5, 15, 18, 25, 40, 45, 60, 90]) {
          const r = fit(pattern, 60, duration);
          expect(validateProcessingTimeBlocks(r.blocks, duration).ok).toBe(true);
        }
      }
    });

    it('drops everything for a duration too short to hold any middle gap', () => {
      const r = fit(colour, 60, 4);
      expect(r.blocks).toEqual([]);
      expect(validateProcessingTimeBlocks(r.blocks, 4).ok).toBe(true);
    });
  });

  describe('processingBlocksForDurationChange', () => {
    const template: ProcessingTimeBlock[] = [{ id: 't', start_minute: 15, duration_minutes: 30 }];
    const snapshot = [{ id: '5a3c1f7e-0000-4000-8000-000000000001', start_minute: 20, duration_minutes: 20 }];
    const change = (snap: unknown, durationMinutes: number) =>
      processingBlocksForDurationChange({
        snapshot: snap,
        currentDurationMinutes: 60,
        templateBlocks: template,
        templateDurationMinutes: 60,
        durationMinutes,
      });

    it('sends nothing when the caller never loaded the column', () => {
      // Guessing [] here would clear real processing time on save.
      expect(change(undefined, 40)).toBeNull();
    });

    it('prefers the stored snapshot over the catalogue', () => {
      expect(change(snapshot, 60)).toEqual(snapshot);
    });

    it('treats an empty snapshot as "this booking has no gap", not as missing', () => {
      // The server does the same, so falling back to the template here would
      // add processing time the booking deliberately does not have.
      expect(change([], 60)).toEqual([]);
    });

    it('falls back to the catalogue only when the column is null', () => {
      expect(change(null, 60)).toEqual(template);
    });

    it('fits whatever it resolved to the new duration', () => {
      expect(change(snapshot, 30)).toEqual([{ ...snapshot[0]!, duration_minutes: 10 }]);
      expect(change(null, 30)).toEqual([{ ...template[0]!, duration_minutes: 15 }]);
    });

    it('re-fits the snapshot from the booking length and the template from the catalogue length', () => {
      const wait = [{ id: '5a3c1f7e-0000-4000-8000-000000000002', start_minute: 90, duration_minutes: 30 }];
      // A 90 minute booking whose wait starts at 90, shortened to 60: the wait follows.
      expect(
        processingBlocksForDurationChange({
          snapshot: wait,
          currentDurationMinutes: 90,
          templateBlocks: [{ id: 'c', start_minute: 60, duration_minutes: 30 }],
          templateDurationMinutes: 60,
          durationMinutes: 60,
        }),
      ).toEqual([{ ...wait[0]!, start_minute: 60 }]);
      // No snapshot: the 60 minute catalogue pattern applied to a 90 minute booking.
      expect(
        processingBlocksForDurationChange({
          snapshot: null,
          currentDurationMinutes: 90,
          templateBlocks: [{ id: 'c', start_minute: 60, duration_minutes: 30 }],
          templateDurationMinutes: 60,
          durationMinutes: 90,
        }),
      ).toEqual([{ id: 'c', start_minute: 90, duration_minutes: 30 }]);
    });
  });

  it('busyIntervalsOverlap detects any crossing pair', () => {
    expect(busyIntervalsOverlap([{ start: 10, end: 20 }], [{ start: 5, end: 12 }])).toBe(true);
    expect(busyIntervalsOverlap([{ start: 10, end: 20 }], [{ start: 20, end: 30 }])).toBe(false);
  });

  describe('placeNewProcessingBlock (service form "Add processing period")', () => {
    it('puts the first block after the service, starting at its end', () => {
      expect(placeNewProcessingBlock([], 60)).toEqual({ start_minute: 60, duration_minutes: 10 });
    });

    it('returns null for a service too short to carry processing at all', () => {
      expect(placeNewProcessingBlock([], 4)).toBeNull();
    });

    it('once a period runs past the end, fills backwards inside the service, clear of it', () => {
      const tail: ProcessingTimeBlock = { id: 'a', start_minute: 60, duration_minutes: 30 };
      // Ends five minutes before the trailing run so the two stay distinct.
      expect(placeNewProcessingBlock([tail], 60)).toEqual({ start_minute: 45, duration_minutes: 10 });
    });

    it('uses the latest gap that has room, skipping gaps that are too narrow', () => {
      const blocks: ProcessingTimeBlock[] = [
        { id: 'a', start_minute: 20, duration_minutes: 10 },
        { id: 'b', start_minute: 33, duration_minutes: 27 },
        { id: 't', start_minute: 60, duration_minutes: 20 },
      ];
      // The run 33..80 reaches the end, so the room is below 28; 30..33 is too
      // narrow and 0..20 is the next gap back.
      expect(placeNewProcessingBlock(blocks, 60)).toEqual({ start_minute: 10, duration_minutes: 10 });
    });

    it('returns null when the service is already full', () => {
      expect(
        placeNewProcessingBlock(
          [
            { id: 'a', start_minute: 0, duration_minutes: 60 },
            { id: 't', start_minute: 60, duration_minutes: 10 },
          ],
          60,
        ),
      ).toBeNull();
    });
  });

  describe('resizeProcessingBlock (service form Length field)', () => {
    const endBlock: ProcessingTimeBlock = { id: 'a', start_minute: 50, duration_minutes: 10 };

    it('lengthening a block that runs to the end moves its start earlier', () => {
      expect(resizeProcessingBlock(endBlock, 25, 60)).toEqual({ id: 'a', start_minute: 35, duration_minutes: 25 });
    });

    it('shortening a block that runs to the end keeps it at the end', () => {
      expect(resizeProcessingBlock(endBlock, 5, 60)).toEqual({ id: 'a', start_minute: 55, duration_minutes: 5 });
    });

    it('a block that starts at the end grows later, which is how a wait after the service is set', () => {
      const tail: ProcessingTimeBlock = { id: 't', start_minute: 60, duration_minutes: 10 };
      expect(resizeProcessingBlock(tail, 30, 60)).toEqual({ id: 't', start_minute: 60, duration_minutes: 30 });
      expect(resizeProcessingBlock(tail, 5, 60)).toEqual({ id: 't', start_minute: 60, duration_minutes: 5 });
    });

    it('a middle block keeps its start whatever its length', () => {
      const mid: ProcessingTimeBlock = { id: 'a', start_minute: 20, duration_minutes: 10 };
      expect(resizeProcessingBlock(mid, 30, 60)).toEqual({ id: 'a', start_minute: 20, duration_minutes: 30 });
      expect(resizeProcessingBlock(mid, 50, 60)).toEqual({ id: 'a', start_minute: 20, duration_minutes: 50 });
    });

    it('never starts before 0: a block longer than the service runs on past its end', () => {
      const r = resizeProcessingBlock(endBlock, 70, 60);
      expect(r).toEqual({ id: 'a', start_minute: 0, duration_minutes: 70 });
      expect(validateProcessingTimeBlocks([r], 60).ok).toBe(true);
    });
  });
});

describe('canonicalServiceShape', () => {
  it('leaves a service alone when no block reaches its end', () => {
    const blocks: ProcessingTimeBlock[] = [{ id: 'a', start_minute: 30, duration_minutes: 30 }];
    expect(canonicalServiceShape({ durationMinutes: 90, processingBlocks: blocks })).toEqual({
      durationMinutes: 90,
      processingBlocks: blocks,
      changed: false,
    });
    // Already the new shape: the block starts AT the end.
    const tail: ProcessingTimeBlock[] = [{ id: 'a', start_minute: 60, duration_minutes: 60 }];
    expect(canonicalServiceShape({ durationMinutes: 60, processingBlocks: tail }).changed).toBe(false);
    expect(canonicalServiceShape({ durationMinutes: 60, processingBlocks: [] }).changed).toBe(false);
  });

  it('shortens a service whose block runs to its end, keeping the total span', () => {
    const out = canonicalServiceShape({
      durationMinutes: 120,
      processingBlocks: [{ id: 'a', start_minute: 60, duration_minutes: 60 }],
    });
    expect(out).toEqual({
      durationMinutes: 60,
      processingBlocks: [{ id: 'a', start_minute: 60, duration_minutes: 60 }],
      changed: true,
    });
  });

  it('merges a touching run that reaches the end and keeps a middle gap', () => {
    const out = canonicalServiceShape({
      durationMinutes: 150,
      processingBlocks: [
        { id: 'mid', start_minute: 30, duration_minutes: 15 },
        { id: 'b', start_minute: 90, duration_minutes: 30 },
        { id: 'c', start_minute: 120, duration_minutes: 40 },
      ],
    });
    expect(out.durationMinutes).toBe(90);
    expect(out.processingBlocks).toEqual([
      { id: 'mid', start_minute: 30, duration_minutes: 15 },
      { id: 'b', start_minute: 90, duration_minutes: 70 },
    ]);
    // Validates against the shorter duration, and the span is what it was.
    expect(validateProcessingTimeBlocks(out.processingBlocks, out.durationMinutes).ok).toBe(true);
    expect(
      serviceSpanMinutes({ durationMinutes: out.durationMinutes, bufferMinutes: 0, processingBlocks: out.processingBlocks }),
    ).toBe(160);
  });

  it('refuses to shrink a service to nothing', () => {
    const out = canonicalServiceShape({
      durationMinutes: 30,
      processingBlocks: [{ id: 'a', start_minute: 0, duration_minutes: 30 }],
    });
    expect(out.changed).toBe(false);
  });
});
