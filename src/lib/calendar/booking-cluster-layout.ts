/**
 * Horizontal layout for calendar bars that overlap in time on one column.
 *
 * Two mechanisms, in order of preference:
 *
 * 1. NESTING. A booking that starts inside another booking's processing gap
 *    (the client is under the colour and the chair is free) and keeps to that
 *    gap for as long as the host lasts is drawn INSIDE the host bar, indented
 *    from the left, so only the left edge of the host's processing band stays
 *    visible. It may run on past the host's end when the gap reaches the end
 *    too. Staff see at a glance that the slot was used, and neither bar loses
 *    half the column. Nesting chains: a bar nested in a gap can host a third
 *    bar in a gap of its own (a trim booked into the processing time of a cut
 *    that was itself booked into a colour's), each level indented a little
 *    further, so consecutive processing periods read as one line of bookings.
 *
 * 2. LANES. Anything that still overlaps is split into side-by-side lanes, the
 *    same interval-colouring the grid always did.
 *
 * Pure and shape-agnostic so the native grid, the read-only linked column and
 * the tests all run the same arithmetic.
 */

export interface MinuteRange {
  start: number;
  end: number;
}

export interface ClusterLayoutItem extends MinuteRange {
  key: string;
  /**
   * Wall-clock minute ranges inside this item during which its column is free
   * (processing time). Another item that starts inside one of these, and stays
   * inside it until this item ends, can nest in this one.
   */
  gaps?: MinuteRange[];
}

export interface BookingClusterLayout {
  laneIndex: number;
  laneCount: number;
  /** Key of the host this item is drawn inside, when it nests in a processing gap. */
  nestedInKey?: string;
  /**
   * How many hosts this item sits inside: 1 when nested directly in a lane's
   * bar, 2 when nested in a bar that is itself nested, and so on. Each level
   * is indented by {@link NESTED_BOOKING_INSET_PX} more than its host.
   */
  nestDepth?: number;
  /**
   * Wall-clock ranges of the items nested inside this one, when it hosts any,
   * including items nested deeper down the chain (they cover this bar too).
   * The host lays its text and buttons out around these.
   */
  nestedRanges?: MinuteRange[];
}

/**
 * How far a nested bar is indented from its host's left edge: a thin strip of
 * the host (its status stripe and a sliver of the hatched processing band), so
 * the nested booking keeps almost the full column width.
 */
export const NESTED_BOOKING_INSET_PX = 5;

/**
 * Where a host bar keeps its text and its action buttons once nested bars
 * cover parts of it. All values are wall-clock minutes inside the host.
 */
export interface HostRegions {
  /** The text runs from here... */
  textStart: number;
  /** ...to here: the first nested band below the text, or the host's end. */
  textEnd: number;
  /** The action tray sits at the bottom of this span. */
  trayStart: number;
  trayEnd: number;
  /**
   * True when the tray had to move up into the text's span because a nested
   * bar covers the host's bottom edge. The text then clears the tray the way it
   * does on an ordinary bar. False when the tray keeps a free strip of its own
   * below the lowest nested bar.
   */
  traySharesText: boolean;
}

/**
 * Lays a host's text and tray out around the bars nested in it.
 *
 * A nested bar covers everything under it except the left inset, so the host's
 * text keeps to the span above the first nested bar (or below a band that
 * starts at the very top). The tray prefers the free strip under the lowest
 * nested bar; when that strip is shorter than `minTraySpan` (or a nested bar
 * runs to the host's end, as a tail processing gap does) it moves up into the
 * text's span instead, where the ordinary clearance rules keep them apart.
 *
 * Returns null when nothing is nested, so callers can keep their plain layout.
 */
export function hostRegionsAroundNested(
  host: MinuteRange,
  nested: MinuteRange[],
  minTraySpan: number,
): HostRegions | null {
  const bands = nested
    .map((r) => ({ start: Math.max(host.start, r.start), end: Math.min(host.end, r.end) }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start);
  if (bands.length === 0) return null;

  // Text starts below any band that begins at the host's top edge (bands there
  // are contiguous only if the next one starts where the last ended).
  let textStart = host.start;
  for (const band of bands) {
    if (band.start > textStart) break;
    textStart = Math.max(textStart, band.end);
  }
  const nextBand = bands.find((band) => band.start > textStart);
  const textEnd = nextBand ? nextBand.start : host.end;

  const lowest = bands.reduce((a, b) => (b.end > a.end ? b : a));
  const freeBelow = host.end - lowest.end;
  if (freeBelow >= minTraySpan) {
    return { textStart, textEnd, trayStart: lowest.end, trayEnd: host.end, traySharesText: false };
  }
  return { textStart, textEnd, trayStart: textStart, trayEnd: textEnd, traySharesText: true };
}

export function rangesOverlap(a: MinuteRange, b: MinuteRange): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Can `item` ride inside `host`? It must start inside one of the host's gaps
 * and stay inside that gap for as long as the host lasts. It may run on past
 * the host's end when the gap reaches the end too: a cut booked into the tail
 * of a colour's processing time is a proper nesting even though the cut
 * finishes after the colour does. It may not run into a part of the host where
 * the chair is busy again.
 */
function startsInGapAndStaysFree(host: ClusterLayoutItem, item: MinuteRange): boolean {
  const overlapEnd = Math.min(item.end, host.end);
  return (host.gaps ?? []).some(
    (gap) => gap.start <= item.start && item.start < gap.end && overlapEnd <= gap.end,
  );
}

/** The chain of hosts above an item, nearest first; empty for a lane's own bar. */
function hostChain(nestedIn: Map<string, string>, key: string): string[] {
  const chain: string[] = [];
  let cur = nestedIn.get(key);
  while (cur !== undefined && !chain.includes(cur)) {
    chain.push(cur);
    cur = nestedIn.get(cur);
  }
  return chain;
}

/**
 * Chooses, for every item, the host it nests in (if any).
 *
 * Longer items are considered as hosts first, so a booking prefers the longest
 * host it could ride in. A host may itself be nested, so chains form: a third
 * booking rides in the gap of the second, which rides in the gap of the first.
 * Items are placed in start order, so a bar is always settled before anything
 * that could nest in it is considered. Two items may share a host's gap only if
 * they do not overlap each other; an item that would overlap them tries the
 * next host and otherwise falls back to a lane.
 */
function assignNesting(items: ClusterLayoutItem[]): Map<string, string> {
  const nestedIn = new Map<string, string>();
  const hosted = new Map<string, MinuteRange[]>();
  const hostCandidates = [...items].sort(
    (a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start,
  );
  const byStart = [...items].sort((a, b) => a.start - b.start || a.end - b.end);

  for (const item of byStart) {
    if (hosted.has(item.key)) continue;
    for (const host of hostCandidates) {
      if (host.key === item.key) continue;
      // Never nest in something that sits inside this item.
      if (hostChain(nestedIn, host.key).includes(item.key)) continue;
      if (!startsInGapAndStaysFree(host, item)) continue;
      const already = hosted.get(host.key) ?? [];
      if (already.some((r) => rangesOverlap(r, item))) continue;
      nestedIn.set(item.key, host.key);
      hosted.set(host.key, [...already, { start: item.start, end: item.end }]);
      break;
    }
  }
  return nestedIn;
}

/**
 * Lays out one column's items. Items are grouped into runs of transitive
 * overlap; within a run, nested items take their host's lane and the rest are
 * assigned lanes greedily by start time.
 */
export function layoutOverlapClusters(items: ClusterLayoutItem[]): Map<string, BookingClusterLayout> {
  const layouts = new Map<string, BookingClusterLayout>();
  const sorted = [...items].sort((a, b) => a.start - b.start || a.end - b.end);

  let run: ClusterLayoutItem[] = [];
  let runEnd = -Infinity;

  const flush = () => {
    if (run.length === 0) return;
    const nestedIn = assignNesting(run);
    // The lane's own bar is the top of each item's host chain.
    const laneOwnerOf = (key: string): string => {
      const chain = hostChain(nestedIn, key);
      return chain.length > 0 ? chain[chain.length - 1]! : key;
    };
    // A lane stays taken until the last bar nested anywhere in its chain ends,
    // which is after the host itself when a nested bar runs out of a tail gap.
    const laneReach = new Map<string, number>();
    for (const item of run) laneReach.set(item.key, item.end);
    for (const item of run) {
      if (!nestedIn.has(item.key)) continue;
      const owner = laneOwnerOf(item.key);
      laneReach.set(owner, Math.max(laneReach.get(owner) ?? item.end, item.end));
    }
    const laneEnds: number[] = [];
    const laneOf = new Map<string, number>();
    for (const item of run) {
      if (nestedIn.has(item.key)) continue;
      const reach = laneReach.get(item.key) ?? item.end;
      let laneIndex = laneEnds.findIndex((laneEnd) => laneEnd <= item.start);
      if (laneIndex === -1) {
        laneEnds.push(reach);
        laneIndex = laneEnds.length - 1;
      } else {
        laneEnds[laneIndex] = reach;
      }
      laneOf.set(item.key, laneIndex);
    }
    const laneCount = Math.max(1, laneEnds.length);
    // Every host up the chain is covered by the nested bar, so each gets the range.
    const rangesByHost = new Map<string, MinuteRange[]>();
    for (const item of run) {
      for (const hostKey of hostChain(nestedIn, item.key)) {
        const list = rangesByHost.get(hostKey) ?? [];
        list.push({ start: item.start, end: item.end });
        rangesByHost.set(hostKey, list);
      }
    }
    for (const item of run) {
      const hostKey = nestedIn.get(item.key);
      if (hostKey !== undefined) {
        const nestedRanges = rangesByHost.get(item.key);
        layouts.set(item.key, {
          laneIndex: laneOf.get(laneOwnerOf(item.key)) ?? 0,
          laneCount,
          nestedInKey: hostKey,
          nestDepth: hostChain(nestedIn, item.key).length,
          ...(nestedRanges ? { nestedRanges } : {}),
        });
      } else {
        const nestedRanges = rangesByHost.get(item.key);
        layouts.set(item.key, {
          laneIndex: laneOf.get(item.key) ?? 0,
          laneCount,
          ...(nestedRanges ? { nestedRanges } : {}),
        });
      }
    }
    run = [];
    runEnd = -Infinity;
  };

  for (const item of sorted) {
    if (run.length > 0 && item.start >= runEnd) flush();
    run.push(item);
    runEnd = Math.max(runEnd, item.end);
  }
  flush();
  return layouts;
}

/**
 * Inline position for a bar in its column, from its layout. Lanes share the
 * column width; a nested bar takes its host's lane minus the left inset, and
 * sits above the host so it covers the processing band it was booked into.
 */
export function clusterLayoutHorizontalStyle(
  layout: BookingClusterLayout,
  opts: { gutterRem?: number; baseZIndex?: number } = {},
): { left: string; width: string; zIndex: number } {
  const gutter = opts.gutterRem ?? 0.25;
  const baseZ = opts.baseZIndex ?? 20;
  const widthPct = 100 / Math.max(1, layout.laneCount);
  const laneLeft = `${layout.laneIndex * widthPct}% + ${gutter}rem`;
  const laneWidth = `${widthPct}% - ${gutter * 2}rem`;
  if (layout.nestedInKey) {
    const depth = Math.max(1, layout.nestDepth ?? 1);
    const inset = NESTED_BOOKING_INSET_PX * depth;
    return {
      left: `calc(${laneLeft} + ${inset}px)`,
      width: `calc(${laneWidth} - ${inset}px)`,
      // Above every lane's host (hosts sit at baseZ + laneIndex, lanes are few),
      // and each deeper level above the one it rides in. Kept under baseZ + 10
      // whatever the depth: the dashboard's mobile top bar and sidebar drawer
      // sit at z-30 and z-40, and a bar at that height showed through them.
      zIndex: Math.min(baseZ + 9, baseZ + 4 + 2 * depth + layout.laneIndex),
    };
  }
  return {
    left: `calc(${laneLeft})`,
    width: `calc(${laneWidth})`,
    zIndex: baseZ + layout.laneIndex,
  };
}
