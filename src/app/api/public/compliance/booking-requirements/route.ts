import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { publicBookingRequirements } from '@/lib/compliance/public-forms-service';
import { clientIpFromHeaders, rateLimit } from '@/lib/compliance/rate-limit';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PER_IP_PER_MIN = 30;

const bodySchema = z.object({
  venue_id: z.string().regex(UUID_RE),
  service_ids: z.array(z.string().regex(UUID_RE)).min(1).max(20),
  /** The email as typed on the details step; identity is resolved only when it is well-formed. */
  email: z.string().max(320).optional().nullable(),
  booking_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .nullable(),
  booking_time: z
    .string()
    .regex(/^\d{2}:\d{2}(:\d{2})?$/)
    .optional()
    .nullable(),
});

/**
 * POST /api/public/compliance/booking-requirements
 *
 * The one call the public booking flow makes on the details step. For the chosen
 * service(s) and slot it returns every compliance requirement, and, once the guest's
 * email is known, whether each is already satisfied and the inline form for the ones
 * that are not (`Docs/compliance-booking-flow-plan.md` §3). Replaces the old
 * `pre-check` and `inline-forms` endpoints. Rate limited per IP: with an email it
 * reveals whether that address has a record on file, the same exposure the old
 * POST pre-check had.
 */
export async function POST(request: NextRequest) {
  try {
    const limit = rateLimit(
      `compliance-booking-requirements:${clientIpFromHeaders(request.headers)}`,
      PER_IP_PER_MIN,
      60 * 1000,
    );
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please slow down.' },
        { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
      );
    }

    const body = await request.json().catch(() => null);
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'venue_id and service_ids are required.' }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();
    const result = await publicBookingRequirements(admin, {
      venueId: parsed.data.venue_id,
      serviceIds: parsed.data.service_ids,
      email: parsed.data.email ?? null,
      bookingDate: parsed.data.booking_date ?? null,
      bookingTime: parsed.data.booking_time ?? null,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error('POST /api/public/compliance/booking-requirements failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
