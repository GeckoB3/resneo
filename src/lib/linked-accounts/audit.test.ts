import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordBookingWriteAudit } from './audit';

/** Minimal admin-client stub capturing the insert into account_link_audit_log. */
function makeAdmin(insertResult: { error: unknown } = { error: null }) {
  const insert = vi.fn().mockResolvedValue(insertResult);
  const from = vi.fn((table: string) => {
    expect(table).toBe('account_link_audit_log');
    return { insert };
  });
  return { admin: { from } as unknown as SupabaseClient, from, insert };
}

const base = {
  linkId: 'link-1',
  actingVenueId: 'venue-b',
  actingUserId: 'user-1',
  owningVenueId: 'venue-a',
  bookingId: 'booking-1',
} as const;

describe('recordBookingWriteAudit', () => {
  it('inserts one audit row with the cross-venue fields', async () => {
    const { admin, insert } = makeAdmin();
    await recordBookingWriteAudit({
      admin,
      ...base,
      actionType: 'cancelled_booking',
      beforeState: { booking_date: '2026-06-01', booking_time: '10:00' },
      afterState: null,
    });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith({
      link_id: 'link-1',
      acting_venue_id: 'venue-b',
      acting_user_id: 'user-1',
      owning_venue_id: 'venue-a',
      action_type: 'cancelled_booking',
      resource_type: 'booking',
      resource_id: 'booking-1',
      before_state: { booking_date: '2026-06-01', booking_time: '10:00' },
      after_state: null,
    });
  });

  it('defaults before/after state to null when omitted', async () => {
    const { admin, insert } = makeAdmin();
    await recordBookingWriteAudit({ admin, ...base, actionType: 'edited_booking' });
    const payload = insert.mock.calls[0][0];
    expect(payload.before_state).toBeNull();
    expect(payload.after_state).toBeNull();
    expect(payload.action_type).toBe('edited_booking');
  });

  it('never throws when the insert returns an error (best-effort)', async () => {
    const { admin } = makeAdmin({ error: { message: 'boom' } });
    await expect(
      recordBookingWriteAudit({ admin, ...base, actionType: 'edited_booking' }),
    ).resolves.toBeUndefined();
  });

  it('never throws when the client itself rejects', async () => {
    const admin = {
      from: () => ({ insert: () => Promise.reject(new Error('network')) }),
    } as unknown as SupabaseClient;
    await expect(
      recordBookingWriteAudit({ admin, ...base, actionType: 'cancelled_booking' }),
    ).resolves.toBeUndefined();
  });
});
