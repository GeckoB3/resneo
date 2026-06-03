import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseAdminClient } from '@/lib/supabase';
import {
  publicPreCheckForGuest,
  publicServiceRequirements,
} from '@/lib/compliance/public-forms-service';
import { clientIpFromHeaders, rateLimit } from '@/lib/compliance/rate-limit';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRECHECK_PER_IP_PER_MIN = 30;

/** GET /api/public/compliance/pre-check?venue_id=&service_id= — requirements + enforcement (no identity). */
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const venueId = sp.get('venue_id') ?? '';
    const serviceId = sp.get('service_id') ?? '';
    if (!UUID_RE.test(venueId) || !UUID_RE.test(serviceId)) {
      return NextResponse.json({ error: 'venue_id and service_id are required.' }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();
    const requirements = await publicServiceRequirements(admin, venueId, serviceId);
    return NextResponse.json({ requirements });
  } catch (err) {
    console.error('GET /api/public/compliance/pre-check failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

const postSchema = z.object({
  venue_id: z.string().regex(UUID_RE),
  service_id: z.string().regex(UUID_RE),
  email: z.string().email().max(320),
});

/** POST /api/public/compliance/pre-check — resolve a guest's records by email (rate limited per IP). */
export async function POST(request: NextRequest) {
  try {
    const ip = clientIpFromHeaders(request.headers);
    const limit = rateLimit(`compliance-precheck:${ip}`, PRECHECK_PER_IP_PER_MIN, 60 * 1000);
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please slow down.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
      );
    }

    const body = await request.json().catch(() => null);
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'venue_id, service_id and a valid email are required.' }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();
    const requirements = await publicPreCheckForGuest(admin, {
      venueId: parsed.data.venue_id,
      serviceId: parsed.data.service_id,
      email: parsed.data.email,
    });
    return NextResponse.json({ requirements });
  } catch (err) {
    console.error('POST /api/public/compliance/pre-check failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
