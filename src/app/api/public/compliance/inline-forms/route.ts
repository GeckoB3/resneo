import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { publicInlineFormsForService } from '@/lib/compliance/public-forms-service';
import { clientIpFromHeaders, rateLimit } from '@/lib/compliance/rate-limit';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PER_IP_PER_MIN = 60;

/**
 * GET /api/public/compliance/inline-forms?venue_id=&service_id= — the client-completable
 * requirements of a service that are set to be completed inline during booking, each with
 * its current-version form schema (staff_only stripped) so the booking flow can render them
 * (spec §9.3, Phase 2b). No identity needed; rate-limited per IP.
 */
export async function GET(request: NextRequest) {
  try {
    const limit = rateLimit(`compliance-inline-forms:${clientIpFromHeaders(request.headers)}`, PER_IP_PER_MIN, 60 * 1000);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please slow down.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
      );
    }

    const sp = request.nextUrl.searchParams;
    const venueId = sp.get('venue_id') ?? '';
    const serviceId = sp.get('service_id') ?? '';
    if (!UUID_RE.test(venueId) || !UUID_RE.test(serviceId)) {
      return NextResponse.json({ error: 'venue_id and service_id are required.' }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();
    const forms = await publicInlineFormsForService(admin, venueId, serviceId);
    return NextResponse.json({ forms });
  } catch (err) {
    console.error('GET /api/public/compliance/inline-forms failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
