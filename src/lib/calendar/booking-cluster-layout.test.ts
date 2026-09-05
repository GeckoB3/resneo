import { describe, expect, it } from 'vitest';
import {
  clusterLayoutHorizontalStyle,
  hostRegionsAroundNested,
  layoutOverlapClusters,
  NESTED_BOOKING_INSET_PX,
  type ClusterLayoutItem,
} from './booking-cluster-layout';

const t = (h: number, m = 0) => h * 60 + m;

/** 90 minute colour service with the client under the colour from +30 to +60. */
function tint(key: string, start: number): ClusterLayoutItem {
  return { key, start, end: start + 90, gaps: [{ start: start + 30, end: start + 60 }] };
}

describe('layoutOverlapClusters', () => {
  it('leaves non-overlapping bookings in a single full-width lane', () => {
    const layouts = layoutOverlapClusters([
      { key: 'a', start: t(9), end: t(10) },
      { key: 'b', start: t(10), end: t(11) },
    ]);
    expect(layouts.get('a')).toEqual({ laneIndex: 0, laneCount: 1 });
    expect(layouts.get('b')).toEqual({ laneIndex: 0, laneCount: 1 });
  });

  it('splits plain overlaps into side-by-side lanes', () => {
    const layouts = layoutOverlapClusters([
      { key: 'a', start: t(9), end: t(10, 30) },
      { key: 'b', start: t(10), end: t(11) },
    ]);
    expect(layouts.get('a')).toEqual({ laneIndex: 0, laneCount: 2 });
    expect(layouts.get('b')).toEqual({ laneIndex: 1, laneCount: 2 });
  });

  /**
   * The case this module exists for: a 30 minute cut slotted into the gap while
   * a tint develops. Both used to be squeezed to half the column.
   */
  it('nests a booking that fits entirely inside a processing gap, keeping one lane', () => {
    const layouts = layoutOverlapClusters([
      tint('tint', t(11)),
      { key: 'cut', start: t(11, 30), end: t(12) },
    ]);
    expect(layouts.get('tint')).toEqual({
      laneIndex: 0,
      laneCount: 1,
      nestedRanges: [{ start: t(11, 30), end: t(12) }],
    });
    expect(layouts.get('cut')).toEqual({ laneIndex: 0, laneCount: 1, nestedInKey: 'tint' });
  });

  it('nests a shorter booking that fills only part of the gap', () => {
    const layouts = layoutOverlapClusters([
      tint('tint', t(11)),
      { key: 'trim', start: t(11, 35), end: t(11, 50) },
    ]);
    expect(layouts.get('trim')?.nestedInKey).toBe('tint');
  });

  it('does not nest a booking that spills past the gap', () => {
    const layouts = layoutOverlapClusters([
      tint('tint', t(11)),
      { key: 'cut', start: t(11, 30), end: t(12, 15) },
    ]);
    expect(layouts.get('cut')?.nestedInKey).toBeUndefined();
    expect(layouts.get('cut')?.laneCount).toBe(2);
    expect(layouts.get('tint')?.laneCount).toBe(2);
  });

  it('does not nest a booking that starts before the gap opens', () => {
    const layouts = layoutOverlapClusters([
      tint('tint', t(11)),
      { key: 'cut', start: t(11, 15), end: t(11, 45) },
    ]);
    expect(layouts.get('cut')?.nestedInKey).toBeUndefined();
  });

  it('lets two non-overlapping bookings share one gap, and lanes a third that overlaps them', () => {
    const layouts = layoutOverlapClusters([
      { key: 'host', start: t(11), end: t(13), gaps: [{ start: t(11, 30), end: t(12, 30) }] },
      { key: 'a', start: t(11, 30), end: t(12) },
      { key: 'b', start: t(12), end: t(12, 30) },
      { key: 'c', start: t(11, 45), end: t(12, 15) },
    ]);
    expect(layouts.get('a')?.nestedInKey).toBe('host');
    expect(layouts.get('b')?.nestedInKey).toBe('host');
    expect(layouts.get('c')?.nestedInKey).toBeUndefined();
    // Host and c share the lanes; a and b ride in the host's lane.
    expect(layouts.get('host')?.laneCount).toBe(2);
    expect(layouts.get('c')?.laneIndex).toBe(1);
    expect(layouts.get('a')?.laneIndex).toBe(layouts.get('host')?.laneIndex);
  });

  it('never nests more than one level deep', () => {
    // The nested cut has a gap of its own that a trim would fit in.
    const layouts = layoutOverlapClusters([
      tint('tint', t(11)),
      { key: 'cut', start: t(11, 30), end: t(12), gaps: [{ start: t(11, 40), end: t(11, 50) }] },
      { key: 'trim', start: t(11, 40), end: t(11, 50) },
    ]);
    expect(layouts.get('cut')?.nestedInKey).toBe('tint');
    // trim also fits the tint's gap directly but overlaps the already nested cut,
    // so it takes a lane rather than nesting two deep.
    expect(layouts.get('trim')?.nestedInKey).toBeUndefined();
  });

  it('nests inside the host even when the host is itself in a lane', () => {
    const layouts = layoutOverlapClusters([
      tint('tint', t(11)),
      { key: 'other', start: t(10, 30), end: t(11, 30) },
      { key: 'cut', start: t(11, 30), end: t(12) },
    ]);
    const tintLayout = layouts.get('tint')!;
    expect(tintLayout.laneCount).toBe(2);
    expect(tintLayout.nestedRanges).toEqual([{ start: t(11, 30), end: t(12) }]);
    expect(layouts.get('cut')).toEqual({
      laneIndex: tintLayout.laneIndex,
      laneCount: 2,
      nestedInKey: 'tint',
    });
  });

  /** Three hour colour whose processing time is its last hour, the chair free until it ends. */
  function balayage(key: string, start: number): ClusterLayoutItem {
    return { key, start, end: start + 180, gaps: [{ start: start + 120, end: start + 180 }] };
  }

  it('nests a booking that starts in a tail gap and runs on past the host, keeping one lane', () => {
    const layouts = layoutOverlapClusters([
      balayage('colour', t(13, 30)),
      { key: 'cut', start: t(16), end: t(17) },
    ]);
    expect(layouts.get('cut')).toEqual({ laneIndex: 0, laneCount: 1, nestedInKey: 'colour' });
    expect(layouts.get('colour')).toEqual({
      laneIndex: 0,
      laneCount: 1,
      nestedRanges: [{ start: t(16), end: t(17) }],
    });
  });

  it('does not nest a booking that starts at the very end of a tail gap', () => {
    const layouts = layoutOverlapClusters([
      balayage('colour', t(13, 30)),
      { key: 'cut', start: t(16, 30), end: t(17, 30) },
    ]);
    // They do not overlap at all, so both keep the full column.
    expect(layouts.get('cut')).toEqual({ laneIndex: 0, laneCount: 1 });
  });

  it("keeps the host's lane taken until the bar nested in its tail gap ends", () => {
    const layouts = layoutOverlapClusters([
      balayage('colour', t(13, 30)),
      { key: 'cut', start: t(16), end: t(17) },
      { key: 'next', start: t(16, 30), end: t(17, 30) },
    ]);
    expect(layouts.get('cut')?.nestedInKey).toBe('colour');
    expect(layouts.get('next')?.nestedInKey).toBeUndefined();
    expect(layouts.get('next')?.laneIndex).toBe(1);
    expect(layouts.get('colour')?.laneCount).toBe(2);
    expect(layouts.get('cut')?.laneIndex).toBe(layouts.get('colour')?.laneIndex);
  });

  it('lets a booking longer than its host ride out of a tail gap', () => {
    const layouts = layoutOverlapClusters([
      { key: 'gloss', start: t(15), end: t(16), gaps: [{ start: t(15, 30), end: t(16) }] },
      { key: 'long', start: t(15, 30), end: t(18) },
    ]);
    expect(layouts.get('long')?.nestedInKey).toBe('gloss');
    expect(layouts.get('long')?.laneCount).toBe(1);
  });

  it('re-lanes live when a resize grows the nested booking past the gap', () => {
    const before = layoutOverlapClusters([tint('tint', t(11)), { key: 'cut', start: t(11, 30), end: t(12) }]);
    const after = layoutOverlapClusters([tint('tint', t(11)), { key: 'cut', start: t(11, 30), end: t(12, 5) }]);
    expect(before.get('cut')?.nestedInKey).toBe('tint');
    expect(after.get('cut')?.nestedInKey).toBeUndefined();
    expect(after.get('cut')?.laneCount).toBe(2);
  });
});

describe('clusterLayoutHorizontalStyle', () => {
  it('gives a nested bar its host lane minus the left inset, above the host', () => {
    const host = clusterLayoutHorizontalStyle({ laneIndex: 0, laneCount: 1 });
    const nested = clusterLayoutHorizontalStyle({ laneIndex: 0, laneCount: 1, nestedInKey: 'h' });
    expect(host.left).toBe('calc(0% + 0.25rem)');
    expect(host.width).toBe('calc(100% - 0.5rem)');
    expect(nested.left).toBe(`calc(0% + 0.25rem + ${NESTED_BOOKING_INSET_PX}px)`);
    expect(nested.width).toBe(`calc(100% - 0.5rem - ${NESTED_BOOKING_INSET_PX}px)`);
    expect(nested.zIndex).toBeGreaterThan(host.zIndex);
  });

  it('splits lanes evenly', () => {
    const second = clusterLayoutHorizontalStyle({ laneIndex: 1, laneCount: 2 });
    expect(second.left).toBe('calc(50% + 0.25rem)');
    expect(second.width).toBe('calc(50% - 0.5rem)');
    expect(second.zIndex).toBe(21);
  });
});

describe('hostRegionsAroundNested', () => {
  const host = { start: t(11), end: t(12, 30) };

  it('returns null when nothing is nested', () => {
    expect(hostRegionsAroundNested(host, [], 15)).toBeNull();
  });

  it('keeps text above a mid-bar nested booking and the tray in the free strip below it', () => {
    const r = hostRegionsAroundNested(host, [{ start: t(11, 30), end: t(12) }], 15)!;
    expect(r.textStart).toBe(t(11));
    expect(r.textEnd).toBe(t(11, 30));
    expect(r.trayStart).toBe(t(12));
    expect(r.trayEnd).toBe(t(12, 30));
    expect(r.traySharesText).toBe(false);
  });

  /**
   * The case flagged after the first pass: a tail processing gap means the
   * nested booking covers the host's bottom edge, where the buttons live.
   */
  it('moves the tray up into the text span when a nested booking covers the bottom edge', () => {
    const r = hostRegionsAroundNested(host, [{ start: t(12), end: t(12, 30) }], 15)!;
    expect(r.textEnd).toBe(t(12));
    expect(r.trayStart).toBe(t(11));
    expect(r.trayEnd).toBe(t(12));
    expect(r.traySharesText).toBe(true);
  });

  it('moves the tray up when the free strip below is too short for a button', () => {
    const r = hostRegionsAroundNested(host, [{ start: t(11, 30), end: t(12, 25) }], 15)!;
    expect(r.traySharesText).toBe(true);
    expect(r.trayEnd).toBe(t(11, 30));
  });

  it('starts the text below a nested booking that begins at the top edge', () => {
    const r = hostRegionsAroundNested(host, [{ start: t(11), end: t(11, 20) }], 15)!;
    expect(r.textStart).toBe(t(11, 20));
    expect(r.textEnd).toBe(t(12, 30));
    expect(r.trayStart).toBe(t(11, 20));
    expect(r.traySharesText).toBe(false);
  });

  it('treats two nested bookings as separate bands', () => {
    const r = hostRegionsAroundNested(
      host,
      [{ start: t(11, 20), end: t(11, 40) }, { start: t(11, 50), end: t(12, 10) }],
      15,
    )!;
    expect(r.textEnd).toBe(t(11, 20));
    expect(r.trayStart).toBe(t(12, 10));
    expect(r.traySharesText).toBe(false);
  });
});
