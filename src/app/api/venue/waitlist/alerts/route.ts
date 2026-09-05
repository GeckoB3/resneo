import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff } from '@/lib/venue-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import {
  parseVenueFeatureFlags,
  resolveAppointmentsFeatureFlag,
} from '@/lib/feature-flags';
import { parseWaitlistConfig } from '@/lib/booking/waitlist-config';
import { loadWaitlistVenueCapabilities } from '@/lib/booking/load-waitlist-venue-capabilities';
import {
  dismissWaitlistSlotOpportunity,
  enrichWaitlistSlotOpportunities,
  markWaitlistOpportunitiesFilledForSlot,
  offerWaitlistFromOpportunity,
  opportunityToFreedSlot,
  type WaitlistSlotOpportunityRow,
} from '@/lib/booking/waitlist-slot-opportunity-service';
import { isWaitlistFreedSlotStillUnbooked } from '@/lib/booking/is-waitlist-freed-slot-unbooked';
import { formatIsoDateInTimeZone } from '@/lib/date/format-iso-date-in-timezone';

/** GET /api/venue/waitlist/alerts — open staff waitlist availability alerts */
export async function GET(request: Request) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const admin = getSupabaseAdminClient();
    const capabilities = await loadWaitlistVenueCapabilities(admin, staff.venue_id);
    if (!capabilities?.showAppointmentWaitlist) {
      return NextResponse.json({ alerts: [] });
    }

    const { data: venueRow } = await admin
      .from('venues')
      .select('feature_flags, timezone')
      .eq('id', staff.venue_id)
      .maybeSingle();
    const flags = parseVenueFeatureFlags(
      (venueRow as { feature_flags?: unknown } | null)?.feature_flags,
    );
    if (
      !resolveAppointmentsFeatureFlag('waitlist_v2', flags) ||
      parseWaitlistConfig(flags).mode !== 'staff_choose'
    ) {
      return NextResponse.json({ alerts: [] });
    }

    // Opportunity discovery runs on cancel hooks and /api/cron/expire-waitlist-offers (every 5 min).

    // A slot that has already passed cannot be offered, so it is not an alert.
    const venueToday = formatIsoDateInTimeZone(
      new Date(),
      ((venueRow as { timezone?: string | null } | null)?.timezone as string | null) || 'Europe/London',
    );
    const { data, error } = await admin
      .from('waitlist_slot_opportunities')
      .select('*')
      .eq('venue_id', staff.venue_id)
      .eq('status', 'open')
      .gte('slot_date', venueToday)
      .order('created_at', { ascending: true });

    if (error) {
      console.error('GET /api/venue/waitlist/alerts failed:', error);
      return NextResponse.json({ error: 'Failed to fetch alerts' }, { status: 500 });
    }

    const rows = (data ?? []) as WaitlistSlotOpportunityRow[];
    const openRows: WaitlistSlotOpportunityRow[] = [];

    // One check per row, side by side. Checked one after another, a venue with a
    // dozen open alerts waited several seconds for this banner on every
    // dashboard page; the marking of filled slots stays in order.
    const checks = await Promise.all(
      rows.map(async (row) => {
        const slot = opportunityToFreedSlot(row);
        return { row, slot, stillUnbooked: await isWaitlistFreedSlotStillUnbooked(admin, slot) };
      }),
    );
    for (const check of checks) {
      if (check.stillUnbooked) {
        openRows.push(check.row);
        continue;
      }
      await markWaitlistOpportunitiesFilledForSlot(admin, check.slot);
    }

    const alerts = (await enrichWaitlistSlotOpportunities(admin, openRows)).filter(
      (alert) => alert.matching_waitlist_count > 0,
    );

    return NextResponse.json({ alerts });
  } catch (err) {
    console.error('GET /api/venue/waitlist/alerts failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** POST /api/venue/waitlist/alerts — offer or dismiss a staff alert */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const body = await request.json();
    const { id, action } = body as { id?: string; action?: string };
    if (!id || !action) {
      return NextResponse.json({ error: 'Missing id or action' }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();

    if (action === 'dismiss') {
      const dismissed = await dismissWaitlistSlotOpportunity(admin, staff.venue_id, id);
      if (!dismissed) {
        return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
      }
      return NextResponse.json({ success: true });
    }

    if (action === 'offer') {
      const result = await offerWaitlistFromOpportunity(admin, staff.venue_id, id);
      if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status });
      }
      return NextResponse.json({
        success: true,
        waitlist_entry_id: result.waitlistEntryId,
        guest_name: result.guestName,
        email_sent: result.emailSent,
        sms_sent: result.smsSent,
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (err) {
    console.error('POST /api/venue/waitlist/alerts failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
