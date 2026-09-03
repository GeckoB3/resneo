import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseAdminClient } from '@/lib/supabase';
import {
  publicBookingRequirements,
  type BookingRequirementsResult,
} from '@/lib/compliance/public-forms-service';
import { clientIpFromHeaders, rateLimit } from '@/lib/compliance/rate-limit';
import { isCollectiveId } from '@/lib/linked-accounts/collective-booking-bridge';
import { loadCollectiveAppointmentCatalog } from '@/lib/linked-accounts/collective-venue';
import { ANY_AVAILABLE_PRACTITIONER_ID } from '@/lib/availability/appointment-any-practitioner';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PER_IP_PER_MIN = 30;

const bodySchema = z.object({
  venue_id: z.string().regex(UUID_RE),
  service_ids: z.array(z.string().regex(UUID_RE)).min(1).max(20),
  /**
   * The chosen calendar. Only needed on a combined booking page, where `venue_id`
   * is a collective and each offering must be resolved to the owning venue of the
   * calendar it will be booked on.
   */
  practitioner_id: z.string().max(80).optional().nullable(),
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
/**
 * Requirements for offerings on a combined page. With a concrete calendar the
 * offering resolves to exactly one owning venue and source service. With "any
 * available" the calendar is not yet known, so every provider venue's
 * requirements are merged (worst state wins per type) and the forms are drawn
 * against the first venue that has any, which is also where the pre-booking
 * uploads go. `venue_id` in the answer is that venue, for the upload endpoint.
 */
async function resolveCollectiveRequirements(
  admin: ReturnType<typeof getSupabaseAdminClient>,
  params: {
    collectiveId: string;
    offeringIds: string[];
    practitionerId: string | null;
    email: string | null;
    bookingDate: string | null;
    bookingTime: string | null;
  },
): Promise<BookingRequirementsResult & { venue_id: string }> {
  const { practitioners } = await loadCollectiveAppointmentCatalog(admin, params.collectiveId);
  const concrete =
    params.practitionerId && params.practitionerId !== ANY_AVAILABLE_PRACTITIONER_ID
      ? params.practitionerId
      : null;
  const calendars = concrete ? practitioners.filter((p) => p.id === concrete) : practitioners;

  // owning venue → the source service ids the chosen offerings map to on it.
  const sourceIdsByVenue = new Map<string, Set<string>>();
  for (const calendar of calendars) {
    for (const offeringId of params.offeringIds) {
      const service = calendar.services.find((s) => s.id === offeringId);
      if (!service) continue;
      const set = sourceIdsByVenue.get(calendar.owning_venue_id) ?? new Set<string>();
      set.add(service.source_service_id);
      sourceIdsByVenue.set(calendar.owning_venue_id, set);
    }
  }

  const email = (params.email ?? '').trim();
  const identityKnown = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  let out: BookingRequirementsResult & { venue_id: string } = {
    identity_known: identityKnown,
    requirements: [],
    venue_id: params.collectiveId,
  };
  let formsVenue: string | null = null;
  for (const [venueId, sourceIds] of sourceIdsByVenue) {
    const result = await publicBookingRequirements(admin, {
      venueId,
      serviceIds: [...sourceIds],
      email: params.email,
      bookingDate: params.bookingDate,
      bookingTime: params.bookingTime,
    });
    if (result.requirements.length === 0) continue;
    if (!formsVenue) formsVenue = venueId;
    const keepForms = venueId === formsVenue;
    for (const req of result.requirements) {
      const existing = out.requirements.find((r) => r.compliance_type_id === req.compliance_type_id);
      const candidate = keepForms ? req : { ...req, form: null };
      if (!existing) {
        out.requirements.push(candidate);
        continue;
      }
      // Worst state wins when two venues require the same type.
      const rank = (s: string | null) =>
        s === 'LOCK_PASSED' ? 3 : s === 'MISSING' ? 2 : s === 'EXPIRED' ? 1 : 0;
      if (rank(candidate.state) > rank(existing.state)) {
        out.requirements = out.requirements.map((r) =>
          r.compliance_type_id === req.compliance_type_id ? { ...candidate, form: existing.form ?? candidate.form } : r,
        );
      }
    }
  }
  out = { ...out, venue_id: formsVenue ?? params.collectiveId };
  return out;
}

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

    // Combined booking page: the flow only knows the collective id and offering
    // ids, but requirements are defined by the OWNING venue on its real source
    // service (and enforced there at create). Resolve through the merged catalogue
    // so the guest sees, and can complete, the forms the booking will be checked
    // against. Without this the lookup found no venue, showed nothing, and the
    // booking was refused at the last step with no way to fix it.
    if (await isCollectiveId(admin, parsed.data.venue_id)) {
      const resolved = await resolveCollectiveRequirements(admin, {
        collectiveId: parsed.data.venue_id,
        offeringIds: parsed.data.service_ids,
        practitionerId: parsed.data.practitioner_id ?? null,
        email: parsed.data.email ?? null,
        bookingDate: parsed.data.booking_date ?? null,
        bookingTime: parsed.data.booking_time ?? null,
      });
      return NextResponse.json(resolved);
    }

    const result = await publicBookingRequirements(admin, {
      venueId: parsed.data.venue_id,
      serviceIds: parsed.data.service_ids,
      email: parsed.data.email ?? null,
      bookingDate: parsed.data.booking_date ?? null,
      bookingTime: parsed.data.booking_time ?? null,
    });
    return NextResponse.json({ ...result, venue_id: parsed.data.venue_id });
  } catch (err) {
    console.error('POST /api/public/compliance/booking-requirements failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
