import { describe, expect, it } from 'vitest';
import { groupTodaysCheckIns, type CheckInMissingRow } from '@/lib/compliance/check-in';

const TODAY = '2026-06-02';

function row(over: Partial<CheckInMissingRow>): CheckInMissingRow {
  return {
    booking_id: 'b1',
    guest_id: 'g1',
    guest_name: 'Jane Doe',
    booking_date: TODAY,
    booking_time: '14:00:00',
    compliance_type_id: 't1',
    compliance_type_name: 'Patch Test',
    enforcement: 'block_online',
    state: 'missing',
    ...over,
  };
}

describe('groupTodaysCheckIns', () => {
  it('keeps only today’s bookings', () => {
    const groups = groupTodaysCheckIns(
      [row({ booking_id: 'b1' }), row({ booking_id: 'b2', booking_date: '2026-06-05' })],
      TODAY,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.booking_id).toBe('b1');
  });

  it('groups multiple outstanding forms under one booking', () => {
    const groups = groupTodaysCheckIns(
      [
        row({ compliance_type_id: 't1', compliance_type_name: 'Patch Test' }),
        row({ compliance_type_id: 't2', compliance_type_name: 'Consent Form', enforcement: 'warn_client' }),
      ],
      TODAY,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.items).toHaveLength(2);
  });

  it('shows a client once at their arrival time when their forms come from different services', () => {
    // A multi-service visit: the colour needs a patch test, the cut after it needs photo consent.
    const groups = groupTodaysCheckIns(
      [
        row({ booking_id: 'cut', booking_time: '11:00:00', compliance_type_id: 'photo', compliance_type_name: 'Photo Consent' }),
        row({ booking_id: 'colour', booking_time: '10:00:00', compliance_type_id: 'patch', compliance_type_name: 'Patch Test' }),
      ],
      TODAY,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0]!.booking_time).toBe('10:00:00');
    expect(groups[0]!.booking_id).toBe('colour');
    // Each form still belongs to the booking that needs it, so a capture or link is filed there.
    expect(Object.fromEntries(groups[0]!.items.map((i) => [i.compliance_type_id, i.booking_id]))).toEqual({
      patch: 'colour',
      photo: 'cut',
    });
  });

  it('keeps different clients apart, and a booking with no client on its own card', () => {
    const groups = groupTodaysCheckIns(
      [
        row({ booking_id: 'b1', guest_id: 'g1' }),
        row({ booking_id: 'b2', guest_id: 'g2', guest_name: 'Sam Smith' }),
        row({ booking_id: 'b3', guest_id: null, guest_name: 'Guest' }),
        row({ booking_id: 'b4', guest_id: null, guest_name: 'Guest' }),
      ],
      TODAY,
    );
    expect(groups.map((g) => g.key).sort()).toEqual(['booking:b3', 'booking:b4', 'g1', 'g2']);
  });

  it('sorts items blocking-first then alphabetically', () => {
    const groups = groupTodaysCheckIns(
      [
        row({ compliance_type_id: 'a', compliance_type_name: 'Aaa Consent', enforcement: 'warn_client' }),
        row({ compliance_type_id: 'b', compliance_type_name: 'Zzz Patch', enforcement: 'block_all' }),
      ],
      TODAY,
    );
    expect(groups[0]!.items.map((i) => i.compliance_type_id)).toEqual(['b', 'a']);
  });

  it('de-duplicates a type required twice, keeping the harder enforcement', () => {
    const groups = groupTodaysCheckIns(
      [
        row({ compliance_type_id: 't1', enforcement: 'warn_client' }),
        row({ compliance_type_id: 't1', enforcement: 'block_all' }),
      ],
      TODAY,
    );
    expect(groups[0]!.items).toHaveLength(1);
    expect(groups[0]!.items[0]!.enforcement).toBe('block_all');
  });

  it('orders groups by booking time, untimed last', () => {
    const groups = groupTodaysCheckIns(
      [
        row({ booking_id: 'late', guest_id: 'g-late', booking_time: '16:30:00' }),
        row({ booking_id: 'early', guest_id: 'g-early', booking_time: '09:15:00' }),
        row({ booking_id: 'untimed', guest_id: 'g-untimed', booking_time: null }),
      ],
      TODAY,
    );
    expect(groups.map((g) => g.booking_id)).toEqual(['early', 'late', 'untimed']);
  });

  it('returns an empty list when nothing is due today', () => {
    expect(groupTodaysCheckIns([row({ booking_date: '2026-07-01' })], TODAY)).toEqual([]);
  });
});
