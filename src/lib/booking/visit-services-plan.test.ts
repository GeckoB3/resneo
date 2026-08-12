import { describe, expect, it } from 'vitest';
import {
  planVisitServices,
  type CatalogueServiceForVisit,
  type VisitServiceRowState,
} from './visit-services-plan';

/** The reference visit: Cut 60, Olaplex 24, Toner 52, running 10:27 to 12:43. */
const ROWS: VisitServiceRowState[] = [
  { id: 'a', serviceId: 'cut', variantId: null, name: 'Cut & Blow Dry', startHm: '10:27', durationMinutes: 60 },
  { id: 'b', serviceId: 'olaplex', variantId: null, name: 'Olaplex Treatment', startHm: '11:27', durationMinutes: 24 },
  { id: 'c', serviceId: 'toner', variantId: null, name: 'Toner / Gloss', startHm: '11:51', durationMinutes: 52 },
];

const CATALOGUE = new Map<string, CatalogueServiceForVisit>([
  ['cut', { id: 'cut', name: 'Cut & Blow Dry', durationMinutes: 60, bufferMinutes: 0 }],
  ['olaplex', { id: 'olaplex', name: 'Olaplex Treatment', durationMinutes: 30, bufferMinutes: 0 }],
  ['toner', { id: 'toner', name: 'Toner / Gloss', durationMinutes: 45, bufferMinutes: 0 }],
  ['beard', { id: 'beard', name: 'Beard Trim', durationMinutes: 20, bufferMinutes: 10 }],
  [
    'colour',
    {
      id: 'colour',
      name: 'Colour',
      durationMinutes: 90,
      bufferMinutes: 0,
      variants: [
        { id: 'short', durationMinutes: 75, isActive: true },
        { id: 'long', durationMinutes: 120, isActive: true },
        { id: 'retired', durationMinutes: 60, isActive: false },
      ],
    },
  ],
]);

function plan(requested: Parameters<typeof planVisitServices>[0]['requested']) {
  const result = planVisitServices({ rows: ROWS, requested, catalogue: CATALOGUE });
  if (!result.ok) throw new Error(`expected a plan, got: ${result.reason}`);
  return result.plan;
}

const keepAll = [
  { bookingId: 'a', serviceId: 'cut' },
  { bookingId: 'b', serviceId: 'olaplex' },
  { bookingId: 'c', serviceId: 'toner' },
];

describe('planVisitServices', () => {
  it('keeps the visit exactly as it is when nothing is asked for', () => {
    const p = plan(keepAll);
    expect(p.entries.map((e) => [e.kind, e.startHm, e.endHm])).toEqual([
      ['keep', '10:27', '11:27'],
      ['keep', '11:27', '11:51'],
      ['keep', '11:51', '12:43'],
    ]);
    expect(p.changed).toBe(false);
    expect(p.removedRowIds).toEqual([]);
  });

  it('a kept service holds the duration it has, not the catalogue’s', () => {
    // Olaplex is 30 in the catalogue and 24 on the booking. Re-listing the
    // services is not an instruction to reset what staff set by hand.
    const p = plan(keepAll);
    expect(p.entries[1]!.durationMinutes).toBe(24);
  });

  it('appends an added service to the end and extends the visit', () => {
    const p = plan([...keepAll, { serviceId: 'beard' }]);
    expect(p.entries).toHaveLength(4);
    expect(p.entries[3]).toMatchObject({
      kind: 'add',
      bookingId: null,
      serviceId: 'beard',
      startHm: '12:43',
      endHm: '13:03',
    });
    expect(p.totalMinutes).toBe(156);
  });

  it('shrinks and re-sequences when a service is removed', () => {
    const p = plan([
      { bookingId: 'a', serviceId: 'cut' },
      { bookingId: 'c', serviceId: 'toner' },
    ]);
    expect(p.removedRowIds).toEqual(['b']);
    expect(p.entries.map((e) => [e.startHm, e.endHm])).toEqual([
      ['10:27', '11:27'],
      // Toner moves up into the removed service's place rather than leaving a hole.
      ['11:27', '12:19'],
    ]);
    expect(p.totalMinutes).toBe(112);
  });

  it('a swap takes the new service’s duration and moves what follows', () => {
    const p = plan([
      { bookingId: 'a', serviceId: 'cut' },
      { bookingId: 'b', serviceId: 'beard' },
      { bookingId: 'c', serviceId: 'toner' },
    ]);
    expect(p.entries[1]).toMatchObject({
      kind: 'swap',
      bookingId: 'b',
      serviceId: 'beard',
      durationMinutes: 20,
      startHm: '11:27',
      endHm: '11:47',
    });
    // Beard Trim's 10 minute buffer is a gap it is entitled to, so Toner starts
    // after it rather than at 11:47.
    expect(p.entries[2]!.startHm).toBe('11:57');
    expect(p.entries[1]!.previous).toEqual({
      startHm: '11:27',
      endHm: '11:51',
      durationMinutes: 24,
      serviceId: 'olaplex',
    });
  });

  it('takes the chosen option’s length when a service has options', () => {
    const p = plan([
      { bookingId: 'a', serviceId: 'cut' },
      { bookingId: 'b', serviceId: 'colour', variantId: 'long' },
      { bookingId: 'c', serviceId: 'toner' },
    ]);
    expect(p.entries[1]!.durationMinutes).toBe(120);
    expect(p.entries[2]!.startHm).toBe('13:27');
  });

  it('refuses an option that is not on that service, or is retired', () => {
    const retired = planVisitServices({
      rows: ROWS,
      requested: [{ bookingId: 'a', serviceId: 'colour', variantId: 'retired' }],
      catalogue: CATALOGUE,
    });
    expect(retired.ok).toBe(false);
    if (!retired.ok) expect(retired.reason).toContain('Colour');

    const foreign = planVisitServices({
      rows: ROWS,
      requested: [{ bookingId: 'a', serviceId: 'cut', variantId: 'long' }],
      catalogue: CATALOGUE,
    });
    expect(foreign.ok).toBe(false);
  });

  it('refuses to empty the visit, pointing at cancellation instead', () => {
    const result = planVisitServices({ rows: ROWS, requested: [], catalogue: CATALOGUE });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('cancel it instead');
  });

  it('allows the visit down to a single service', () => {
    const p = plan([{ bookingId: 'b', serviceId: 'olaplex' }]);
    expect(p.entries).toHaveLength(1);
    expect(p.removedRowIds).toEqual(['a', 'c']);
    // The one kept service starts the visit, wherever it sat before.
    expect(p.entries[0]!.startHm).toBe('10:27');
  });

  it('refuses a service that is not in this visit, and one listed twice', () => {
    const foreign = planVisitServices({
      rows: ROWS,
      requested: [{ bookingId: 'zzz', serviceId: 'cut' }],
      catalogue: CATALOGUE,
    });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.reason).toContain('not part of this visit');

    const twice = planVisitServices({
      rows: ROWS,
      requested: [
        { bookingId: 'a', serviceId: 'cut' },
        { bookingId: 'a', serviceId: 'olaplex' },
      ],
      catalogue: CATALOGUE,
    });
    expect(twice.ok).toBe(false);
    if (!twice.ok) expect(twice.reason).toContain('twice');
  });

  it('refuses a service the catalogue does not have', () => {
    const result = planVisitServices({
      rows: ROWS,
      requested: [{ bookingId: 'a', serviceId: 'gone' }],
      catalogue: CATALOGUE,
    });
    expect(result.ok).toBe(false);
  });

  it('reorders the visit when the services are listed in another order', () => {
    const p = plan([
      { bookingId: 'c', serviceId: 'toner' },
      { bookingId: 'a', serviceId: 'cut' },
      { bookingId: 'b', serviceId: 'olaplex' },
    ]);
    expect(p.entries.map((e) => [e.bookingId, e.startHm])).toEqual([
      ['c', '10:27'],
      ['a', '11:19'],
      ['b', '12:19'],
    ]);
    expect(p.changed).toBe(true);
  });

  it('lays the visit out from a new start when one is given', () => {
    const result = planVisitServices({
      rows: ROWS,
      requested: keepAll,
      catalogue: CATALOGUE,
      startHm: '09:00',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.entries.map((e) => e.startHm)).toEqual(['09:00', '10:00', '10:24']);
  });
});
