import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { recordBookingWriteAudit, recordCollectiveBookingAudit } from './audit';

/**
 * §6.5 "Staff authority": a member's staff booking at another member's venue through the collective
 * is audited, stamping the acting venue. `account_link_audit_log` takes either authority since
 * 20270215120000, so no pairwise link is invented for it (D41).
 */
function admin() {
  const insert = vi.fn((_row: Record<string, unknown>) => Promise.resolve({ error: null }));
  const from = vi.fn(() => ({ insert }));
  return { client: { from } as unknown as SupabaseClient, from, insert };
}

describe('collective booking audit', () => {
  it('writes one row per booking, under the collective and never a link', async () => {
    const a = admin();
    await recordCollectiveBookingAudit({
      admin: a.client,
      collectiveId: 'c1',
      actingVenueId: 'acting',
      actingUserId: 'user-1',
      owningVenueId: 'owner',
      bookingIds: ['b1', 'b2'],
    });
    expect(a.insert).toHaveBeenCalledTimes(2);
    expect(a.insert.mock.calls[0]![0]).toMatchObject({
      link_id: null,
      collective_id: 'c1',
      acting_venue_id: 'acting',
      acting_user_id: 'user-1',
      owning_venue_id: 'owner',
      action_type: 'created_booking',
      resource_type: 'booking',
      resource_id: 'b1',
    });
  });

  it('writes nothing for a booking at the acting venue itself, or with no bookings', async () => {
    const a = admin();
    await recordCollectiveBookingAudit({
      admin: a.client, collectiveId: 'c1', actingVenueId: 'same', actingUserId: null, owningVenueId: 'same', bookingIds: ['b1'],
    });
    await recordCollectiveBookingAudit({
      admin: a.client, collectiveId: 'c1', actingVenueId: 'acting', actingUserId: null, owningVenueId: 'owner', bookingIds: [],
    });
    expect(a.insert).not.toHaveBeenCalled();
  });

  it('refuses a write with neither authority rather than inserting a row the CHECK would reject', async () => {
    const a = admin();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await recordBookingWriteAudit({
      admin: a.client, actingVenueId: 'acting', actingUserId: null, owningVenueId: 'owner',
      actionType: 'created_booking', bookingId: 'b1',
    });
    expect(a.insert).not.toHaveBeenCalled();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });

  it('still audits an account-link booking under its link', async () => {
    const a = admin();
    await recordBookingWriteAudit({
      admin: a.client, linkId: 'l1', actingVenueId: 'acting', actingUserId: null, owningVenueId: 'owner',
      actionType: 'edited_booking', bookingId: 'b9',
    });
    expect(a.insert.mock.calls[0]![0]).toMatchObject({ link_id: 'l1', collective_id: null, action_type: 'edited_booking' });
  });
});

describe('the collective create paths audit their cross-venue bookings', () => {
  it.each(['src/app/api/booking/create-group/route.ts', 'src/app/api/booking/create-multi-service/route.ts'])(
    '%s records the audit after the bookings are written',
    (rel) => {
      const src = readFileSync(join(process.cwd(), rel), 'utf8');
      expect(src).toContain('recordCollectiveBookingAudit');
      expect(src).toMatch(/staffActor\?\.via === 'collective'/);
      // After the response, like the other cross-venue notifications.
      expect(src).toMatch(/after\(async \(\) => \{\s*await recordCollectiveBookingAudit/);
    },
  );
});
