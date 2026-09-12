import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AppointmentEngineInput } from '@/lib/availability/appointment-engine';
import { fetchAppointmentInput } from '@/lib/availability/appointment-engine';
import { getDayOfWeek } from '@/lib/availability/engine';
import type { AppointmentService, Practitioner } from '@/types/booking-models';
import {
  MAX_APPOINTMENT_CORE_DURATION_MINUTES,
  MIN_APPOINTMENT_CORE_DURATION_MINUTES,
  minutesBetweenStartAndEndHM,
  resolveAppointmentModifyEndCoreHHmm,
  validateAppointmentModificationInterval,
} from '@/lib/booking/validate-appointment-modification';

// The validator is DB-backed only through `fetchAppointmentInput`; the engine
// itself is pure. Swap the fetch for a fixture and everything else runs real.
vi.mock('@/lib/availability/appointment-engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/availability/appointment-engine')>();
  return { ...actual, fetchAppointmentInput: vi.fn() };
});

describe('resolveAppointmentModifyEndCoreHHmm', () => {
  it('prefers duration_minutes over booking_end_time', () => {
    const r = resolveAppointmentModifyEndCoreHHmm({
      startHHmm: '10:00',
      durationMinutes: 45,
      bookingEndTime: '11:00',
      defaultDurationMinutes: 30,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.endCoreHHmm).toBe('10:45');
  });

  it('uses booking_end_time when duration omitted', () => {
    const r = resolveAppointmentModifyEndCoreHHmm({
      startHHmm: '09:15',
      durationMinutes: undefined,
      bookingEndTime: '10:30:00',
      defaultDurationMinutes: 20,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.endCoreHHmm).toBe('10:30');
  });

  it('rejects duration under the shared minimum', () => {
    const r = resolveAppointmentModifyEndCoreHHmm({
      startHHmm: '10:00',
      durationMinutes: MIN_APPOINTMENT_CORE_DURATION_MINUTES - 1,
      bookingEndTime: null,
      defaultDurationMinutes: 30,
    });
    expect(r.ok).toBe(false);
  });

  /**
   * This floor was a hard-coded 15 while the engine, the API schemas and the
   * calendar drag all allowed 5, so a short appointment could be created and
   * dragged but not saved from the modify form.
   */
  it('accepts a 10 minute appointment', () => {
    const r = resolveAppointmentModifyEndCoreHHmm({
      startHHmm: '10:00',
      durationMinutes: 10,
      bookingEndTime: null,
      defaultDurationMinutes: 30,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.endCoreHHmm).toBe('10:10');
  });

  it('rejects duration above max', () => {
    const r = resolveAppointmentModifyEndCoreHHmm({
      startHHmm: '10:00',
      durationMinutes: MAX_APPOINTMENT_CORE_DURATION_MINUTES + 1,
      bookingEndTime: null,
      defaultDurationMinutes: 30,
    });
    expect(r.ok).toBe(false);
  });
});

describe('minutesBetweenStartAndEndHM', () => {
  it('counts across midnight', () => {
    expect(minutesBetweenStartAndEndHM('23:30', '00:45')).toBe(75);
  });
});

/**
 * The break override has to survive four hand-offs, and dropping it at any one
 * of them looks identical from the diary: the drag is permitted, the amber note
 * appears, and the save comes back 409 "Conflicts with a break".
 *
 * `allowOutsideHours` is deliberately not enough. The engine keeps the hours
 * gate and the break gate separate ({@link appointment-engine.ts}), so making
 * `break` a non-occupying block on the diary unlocked the gesture and nothing
 * else: only the walk-in create path had ever sent `allowDuringBreaks`, and the
 * move, the resize and the visit dry run all had to learn to send it (SA-H5).
 *
 * A wiring guard, not a behaviour test. `validateAppointmentModificationInterval`
 * is DB-backed and the engine's own break behaviour is already covered in
 * `appointment-engine.test.ts`; what was missing was proof the flag arrives.
 */
describe('the break override reaches the engine (SA-H5)', () => {
  function read(rel: string): string {
    return readFileSync(path.join(process.cwd(), rel), 'utf8');
  }

  it('is forwarded to the interval options rather than folded into allowOutsideHours', () => {
    const source = read('src/lib/booking/validate-appointment-modification.ts');
    expect(source).toContain('allowDuringBreaks: allowDuringBreaks === true');
  });

  it('is accepted by the PATCH and by the visit dry run', () => {
    expect(read('src/app/api/venue/bookings/[id]/route.ts')).toContain(
      'allowDuringBreaks: allowDuringBreaksCalendar',
    );
    const dryRun = read(
      'src/app/api/venue/bookings/[id]/validate-appointment-modification/route.ts',
    );
    expect(dryRun).toContain('allow_during_breaks: z.boolean().optional()');
    expect(dryRun).toContain("allowDuringBreaks: parsed.data.allow_during_breaks === true");
  });

  it('is sent by the diary on a move and a resize', () => {
    const view = read('src/app/dashboard/practitioner-calendar/PractitionerCalendarView.tsx');
    // The diary has to know a break was crossed to say so; the closure helper
    // cannot answer this, because the server treats the two permissions apart.
    expect(view).toContain('windowCrossesBreakBlock(');
    const sent = view.match(/allow_during_breaks: opts\?\.allowDuringBreaks === true/g) ?? [];
    // The move PATCH and the resize PATCH. The diary no longer moves a visit as
    // one (each service is its own bar; Docs/visit-services-independent-plan.md),
    // so the visit dry run it used to send is gone with it.
    expect(sent).toHaveLength(2);
  });

  /**
   * The visit save routes, missed by the original SA-H5 pass and found by the
   * mobile app's delta audit (R17-4).
   *
   * These two are the ONLY way a visit is moved or re-serviced from the app and
   * from the web modify form; the diary drag does not touch them. So a staff
   * member could drag a single appointment over a break and not a visit, with
   * nothing explaining the difference.
   *
   * Neither schema is `.strict()`, so the app's `allow_during_breaks` was being
   * silently stripped rather than rejected — which is why this failed as a
   * refusal at the engine and not as a 400 at the schema, and why nothing
   * pointed at the missing field.
   */
  it.each([
    'src/app/api/venue/visits/[groupBookingId]/schedule/route.ts',
    'src/app/api/venue/visits/[groupBookingId]/services/route.ts',
  ])('%s accepts and forwards allow_during_breaks', (route) => {
    const source = read(route);
    expect(source).toMatch(/allow_during_breaks:\s*z\.boolean\(\)\.optional\(\)/);
    expect(source).toMatch(/allowDuringBreaks:\s*body\.allow_during_breaks === true/);
  });

  /**
   * Accepting the flag is not enough on its own: it has to sit alongside the
   * hours flag on the SAME validator call, or a route could accept the key and
   * forward it from a different branch that never runs.
   */
  it.each([
    'src/app/api/venue/visits/[groupBookingId]/schedule/route.ts',
    'src/app/api/venue/visits/[groupBookingId]/services/route.ts',
  ])('%s forwards it on the same call as allowOutsideHours', (route) => {
    const source = read(route);
    expect(source).toMatch(
      /allowOutsideHours: body\.allow_outside_hours === true,\s*\n\s*allowDuringBreaks: body\.allow_during_breaks === true,/,
    );
  });

  /**
   * THE FIFTH CALLER IS DELIBERATELY EXCLUDED. Recorded here because an
   * enumeration finds "four of five callers pass the flag" and the obvious
   * conclusion is wrong.
   *
   * `api/venue/linked-calendar/booking` is a partner venue CREATING a booking
   * on a shared calendar, and it passes none of the three staff overrides:
   * not overlap, not outside-hours, not breaks. Its schema accepts none of
   * them either.
   *
   * That is the `linked_venue_closed` rule from SA-H5 seen from another angle.
   * Choosing to work past your own closing time is a decision about your own
   * business; placing an appointment inside a PARTNER's break is not the same
   * act, and the partner has not agreed to it. If linked venues are ever to
   * get overrides, that is a grant-ladder decision in the linked-accounts
   * spec, not a missing argument here.
   */
  it('does not quietly hand staff overrides to a linked partner venue', () => {
    const source = read('src/app/api/venue/linked-calendar/booking/route.ts');
    expect(source).toContain('validateAppointmentModificationInterval(');
    expect(source).not.toContain('allowDuringBreaks');
    expect(source).not.toContain('allowOutsideHours');
    expect(source).not.toContain('allowManualOverlap');
  });
});

/**
 * Staff edits are always allowed outside hours.
 *
 * The diary used to send the hours override only when its own reading of the
 * closed stripes said the drop was outside hours. That reading cannot see
 * everything the server counts as hours (a buffer or processing tail past
 * close, a service's own availability window, a stripe off the drawn grid), so
 * a booking already sitting outside hours could not be resized at all: 409
 * "Outside working hours". The undo paths never sent the flag. Now every diary
 * move, resize and undo, and every modify-form check and save, send it on
 * every edit; the stripes only decide whether to say so, and the dry runs
 * report it so the form can say so too.
 *
 * Wiring guards, like the block above. The behaviour of the reported flag is
 * covered in `reports when the hours override was what let an edit through`.
 */
describe('staff edits are always allowed outside hours', () => {
  function read(rel: string): string {
    return readFileSync(path.join(process.cwd(), rel), 'utf8');
  }

  it('is sent by the diary on every move, resize and undo, never conditionally', () => {
    const view = read('src/app/dashboard/practitioner-calendar/PractitionerCalendarView.tsx');
    expect(view).not.toContain('allow_outside_hours: opts?.allowOutsideHours');
    expect(view).not.toContain('allowOutsideHours?: boolean');
    const sent = view.match(/allow_outside_hours: true,/g) ?? [];
    // Move, resize, undo of a resize, undo of a move. The visit-level paths
    // (visit dry run, visit resize, visit undo) went with the merged bar.
    expect(sent).toHaveLength(4);
  });

  it('is sent by the modify form on its check, its save, its undo and both visit endpoints', () => {
    const form = read('src/components/booking/StaffAppointmentModifyForm.tsx');
    const sent = form.match(/allow_outside_hours: true,/g) ?? [];
    // buildPatchPayload (save and undo), the single dry run, the visit's
    // per-service body and its shift body (each used by the dry run and the
    // save), the visit undo, the services body.
    expect(sent).toHaveLength(6);
  });

  it('is reported back by every dry run so the form can say so', () => {
    expect(read('src/lib/booking/validate-appointment-modification.ts')).toContain(
      'return { ok: true, outsideHours }',
    );
    expect(
      read('src/app/api/venue/bookings/[id]/validate-appointment-modification/route.ts'),
    ).toContain('outside_hours: result.outsideHours');
    for (const route of [
      'src/app/api/venue/visits/[groupBookingId]/schedule/route.ts',
      'src/app/api/venue/visits/[groupBookingId]/services/route.ts',
    ]) {
      expect(read(route)).toContain('outside_hours: outsideHours');
    }
  });
});

/**
 * The diary and the modify form always send the hours override, so a refusal
 * is never how staff learn a time is outside hours. The validator says it
 * instead: it re-runs the same pure check without the override, and the hours
 * gate is the only thing that can fail on that run once the relaxed run passed.
 */
/**
 * A calendar that stops offering a service keeps the bookings already in the diary,
 * and the dialog promises they "go ahead as normal". They did not: every drag, resize
 * and modify save runs this validator, and the offered-services check refused all of
 * them, so a left-behind booking could never be rescheduled again (R35, from the app).
 */
describe('a booking carrying the service it already has', () => {
  const date = '2030-06-03';
  const dk = String(getDayOfWeek(date));
  const VENUE_ROW = {
    timezone: 'Europe/London',
    booking_rules: null,
    opening_hours: null,
    venue_opening_exceptions: null,
  };

  /** The calendar offers nothing: the link is gone, so the loaders leave the service out. */
  function unlinkedInput(): AppointmentEngineInput {
    return {
      date,
      practitioners: [
        {
          id: 'p1',
          name: 'Alex',
          is_active: true,
          working_hours: { [dk]: [{ start: '09:00', end: '17:00' }] },
          break_times: [],
          days_off: [],
        } as unknown as Practitioner,
      ],
      services: [],
      practitionerServices: [],
      existingBookings: [],
    };
  }

  /** Parked as well as unlinked, to prove neither is read as "cannot be carried". */
  const SERVICE_ROW = {
    id: 's1',
    venue_id: 'v1',
    name: 'Cut',
    duration_minutes: 30,
    buffer_minutes: 15,
    price_pence: 2500,
    is_active: false,
  };

  function adminStub(opts: { booking?: Record<string, unknown> | null }) {
    const tables: string[] = [];
    const admin = {
      from(table: string) {
        tables.push(table);
        const chain: Record<string, unknown> = {
          select: () => chain,
          eq: () => chain,
          single: async () => ({ data: table === 'venues' ? VENUE_ROW : null }),
          maybeSingle: async () => ({
            data:
              table === 'bookings'
                ? (opts.booking ?? null)
                : table === 'service_items'
                  ? SERVICE_ROW
                  : null,
          }),
        };
        return chain;
      },
    } as unknown as SupabaseClient;
    return { admin, tables };
  }

  async function check(booking: Record<string, unknown> | null, svcId = 's1', practId = 'p1') {
    vi.mocked(fetchAppointmentInput).mockResolvedValue(unlinkedInput());
    const { admin, tables } = adminStub({ booking });
    const result = await validateAppointmentModificationInterval({
      admin,
      venueId: 'v1',
      bookingId: 'b1',
      newDate: date,
      timeStr: '10:00',
      practId,
      svcId,
      durationMinutes: 30,
      allowOutsideHours: true,
    });
    return { result, tables };
  }

  it('may still be moved on the column it already sits on', async () => {
    const { result } = await check({ calendar_id: 'p1', practitioner_id: null, service_item_id: 's1' });
    expect(result).toEqual({ ok: true, outsideHours: false });
  });

  it('is read from `practitioner_id` when the row has no `calendar_id`', async () => {
    const { result } = await check({ calendar_id: null, practitioner_id: 'p1', service_item_id: 's1' });
    expect(result).toEqual({ ok: true, outsideHours: false });
  });

  it('is still refused when the edit changes the service', async () => {
    const { result } = await check({ calendar_id: 'p1', service_item_id: 's-other' });
    expect(result).toEqual({ ok: false, reason: 'Service not available with this staff member' });
  });

  it('is still refused when the edit moves it to a column that does not offer the service', async () => {
    const { result } = await check({ calendar_id: 'p-other', service_item_id: 's1' });
    expect(result).toEqual({ ok: false, reason: 'Service not available with this staff member' });
  });

  it('is refused when the booking cannot be read at all', async () => {
    const { result } = await check(null);
    expect(result).toEqual({ ok: false, reason: 'Service not available with this staff member' });
  });

  it('costs no extra read when the calendar does offer the service', async () => {
    vi.mocked(fetchAppointmentInput).mockResolvedValue({
      ...unlinkedInput(),
      services: [
        { id: 's1', name: 'Cut', duration_minutes: 30, buffer_minutes: 0, is_active: true } as AppointmentService,
      ],
      practitionerServices: [
        { id: 'ps1', practitioner_id: 'p1', service_id: 's1', custom_duration_minutes: null, custom_price_pence: null },
      ],
    });
    const { admin, tables } = adminStub({ booking: null });
    const result = await validateAppointmentModificationInterval({
      admin,
      venueId: 'v1',
      bookingId: 'b1',
      newDate: date,
      timeStr: '10:00',
      practId: 'p1',
      svcId: 's1',
      durationMinutes: 30,
      allowOutsideHours: true,
    });
    expect(result).toEqual({ ok: true, outsideHours: false });
    expect(tables).not.toContain('bookings');
    expect(tables).not.toContain('service_items');
  });
});

describe('reports when the hours override was what let an edit through', () => {
  const date = '2030-06-03';
  const dk = String(getDayOfWeek(date));

  function engineInput(): AppointmentEngineInput {
    return {
      date,
      practitioners: [
        {
          id: 'p1',
          name: 'Alex',
          is_active: true,
          working_hours: { [dk]: [{ start: '09:00', end: '17:00' }] },
          break_times: [],
          days_off: [],
        } as unknown as Practitioner,
      ],
      services: [
        { id: 's1', name: 'Cut', duration_minutes: 30, buffer_minutes: 0, is_active: true } as AppointmentService,
      ],
      practitionerServices: [
        { id: 'ps1', practitioner_id: 'p1', service_id: 's1', custom_duration_minutes: null, custom_price_pence: null },
      ],
      existingBookings: [],
    };
  }

  const admin = {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: { timezone: 'Europe/London', booking_rules: null, opening_hours: null, venue_opening_exceptions: null },
          }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;

  async function check(timeStr: string, allowOutsideHours: boolean) {
    vi.mocked(fetchAppointmentInput).mockResolvedValue(engineInput());
    return validateAppointmentModificationInterval({
      admin,
      venueId: 'v1',
      bookingId: 'b1',
      newDate: date,
      timeStr,
      practId: 'p1',
      svcId: 's1',
      durationMinutes: 30,
      allowOutsideHours,
    });
  }

  it('still refuses a time after close when the override is not sent', async () => {
    expect(await check('18:00', false)).toEqual({ ok: false, reason: 'Outside working hours' });
  });

  it('allows a time after close with the override, and says the override was needed', async () => {
    expect(await check('18:00', true)).toEqual({ ok: true, outsideHours: true });
  });

  it('allows a time before open with the override, and says so', async () => {
    expect(await check('08:00', true)).toEqual({ ok: true, outsideHours: true });
  });

  it('says nothing about hours for a time inside them', async () => {
    expect(await check('10:00', true)).toEqual({ ok: true, outsideHours: false });
    expect(await check('10:00', false)).toEqual({ ok: true, outsideHours: false });
  });
});
