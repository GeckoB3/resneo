import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { uploadComplianceFile } from '@/lib/compliance/files';
import { clientIpFromHeaders, rateLimit } from '@/lib/compliance/rate-limit';
import { isAppointmentPlanTier } from '@/lib/tier-enforcement';
import { parseVenueFeatureFlags, resolveAppointmentsFeatureFlag } from '@/lib/feature-flags/resolve';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/public/compliance/booking-upload?venue_id=&draft_id= — upload a `file`-field
 * document while completing a compliance form DURING online booking, before the booking
 * exists (spec §9.3, Phase 2b). Keyed by a client-generated draft id (UUID); the file is
 * stored under `venues/{venueId}/uploads/booking-draft/{draftId}/`. The booking-create
 * route validates each submitted file path against that prefix before capturing the record,
 * so a submitter cannot point a record at an arbitrary storage object.
 *
 * Unauthenticated (public booking), so it is bounded by: a per-IP rate limit, a strict
 * draft-id/venue-id format, and a check that the venue actually has compliance enabled.
 */
export async function POST(request: NextRequest) {
  try {
    const ip = clientIpFromHeaders(request.headers);
    const limit = rateLimit(`compliance-booking-upload:${ip}`, 20, 60 * 1000);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many uploads. Please slow down.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
      );
    }

    const sp = request.nextUrl.searchParams;
    const venueId = sp.get('venue_id') ?? '';
    const draftId = sp.get('draft_id') ?? '';
    if (!UUID_RE.test(venueId) || !UUID_RE.test(draftId)) {
      return NextResponse.json({ error: 'venue_id and draft_id are required.' }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();
    // Only accept uploads for venues that actually have compliance enabled, so this is not
    // an open upload sink for arbitrary venue ids.
    const { data: venue } = await admin
      .from('venues')
      .select('pricing_tier, feature_flags')
      .eq('id', venueId)
      .maybeSingle();
    const tier = (venue as { pricing_tier?: string | null } | null)?.pricing_tier ?? null;
    const flags = parseVenueFeatureFlags((venue as { feature_flags?: unknown } | null)?.feature_flags);
    if (!venue || !isAppointmentPlanTier(tier) || !resolveAppointmentsFeatureFlag('compliance_records_enabled', flags)) {
      return NextResponse.json({ error: 'Uploads are not available for this venue.' }, { status: 403 });
    }

    const form = await request.formData().catch(() => null);
    const file = form?.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file provided.' }, { status: 400 });
    }

    const uploaded = await uploadComplianceFile(admin, {
      storagePrefix: `venues/${venueId}/uploads/booking-draft/${draftId}`,
      file,
    });
    if (!uploaded.ok) return NextResponse.json({ error: uploaded.error }, { status: uploaded.status });
    return NextResponse.json(uploaded.value);
  } catch (err) {
    console.error('POST /api/public/compliance/booking-upload failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
