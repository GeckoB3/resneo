/**
 * UX spec `guest.bookedThrough`: a booking made on a collective page names that page on the
 * guest's manage page. Any other booking's payload is unchanged (no key at all).
 */
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { makeRecordingDb } from '@/lib/testing/recording-supabase';
import { buildBookingDetailDto } from './booking-detail-dto';

const booking = (collectiveId: string | null) => ({
  id: 'b-1',
  venue_id: 'v-1',
  booking_date: '2026-10-12',
  booking_time: '10:00:00',
  booking_end_time: '10:30:00',
  party_size: 1,
  status: 'Booked',
  collective_id: collectiveId,
});

const db = () =>
  makeRecordingDb((call) => {
    if (call.table === 'venues') return { data: { id: 'v-1', name: 'Zen Studio', address: '1 High Street', timezone: 'Europe/London' } };
    if (call.table === 'venue_collectives') return { data: { name: 'Northside' } };
    return undefined;
  }).db as unknown as SupabaseClient;

describe('buildBookingDetailDto booked_through', () => {
  it('names the collective page the booking came through', async () => {
    const dto = await buildBookingDetailDto(db(), booking('c-1'), { includeManageUrl: false });
    expect(dto.booked_through).toBe('Northside');
  });

  it('adds nothing for a booking made on the venue page', async () => {
    const dto = await buildBookingDetailDto(db(), booking(null), { includeManageUrl: false });
    expect('booked_through' in dto).toBe(false);
  });
});
