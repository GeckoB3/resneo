import type { SupabaseClient } from '@supabase/supabase-js';
import {
  computeAppointmentAvailability,
  fetchAppointmentInput,
  validateAppointmentCustomInterval,
  validateExactAppointmentStart,
  type AppointmentEngineInput,
} from '@/lib/availability/appointment-engine';

/**
 * C3 (interim) — re-check the slot immediately before the insert.
 *
 * Every appointment write validates availability and then inserts, with real
 * work in between: add-on resolution, compliance, deposit intent creation and,
 * on the public paths, round trips to Stripe. On `create/route.ts` the gap is
 * roughly 650 lines and includes network calls, so two guests choosing the same
 * slot within a few hundred milliseconds both pass the check and both rows land.
 * There is no database-level guard: no `EXCLUDE USING`, no `btree_gist`, no
 * advisory lock on any appointment path, and `enforce_cde_capacity` explicitly
 * does not govern appointment rows.
 *
 * **THIS DOES NOT CLOSE THE RACE, AND MUST NOT BE DESCRIBED AS DOING SO.** It
 * shrinks the window from hundreds of milliseconds to the single-digit
 * milliseconds between this call and the insert on the next line. Two writes
 * that interleave inside that window still both succeed. Closing it properly
 * needs the engine's occupancy semantics in the database, which is a scoped
 * project: see C3's "If a real guard is pursued later".
 *
 * WHY IT REFRESHES ONLY `existingBookings`. The engine input is not a simple
 * fetch result by the time it reaches the insert. Callers mutate it: add-on
 * duration is folded into the chosen service's `duration_minutes`, the venue
 * clock and opening hours are attached, `skipPastSlotFilter` is set for
 * waitlist offers. Rebuilding it here would mean duplicating all of that at
 * every call site and letting the two copies drift, which is the same mistake
 * that produced most of the findings this fix belongs to. Instead the caller
 * hands over the input it actually validated, and only the volatile part — the
 * bookings other requests may have inserted since — is replaced.
 *
 * Phantom bookings are deliberately preserved from the captured input: they are
 * in-request constructs with no rows, so a re-fetch cannot see them and
 * dropping them would make a multi-segment visit collide with itself.
 */
export interface AppointmentSlotRecheck {
  /** Re-runs the engine against freshly loaded bookings. */
  stillAvailable: () => Promise<boolean>;
}

export function createAppointmentSlotRecheck(params: {
  supabase: SupabaseClient;
  venueId: string;
  date: string;
  /** The practitioner or unified-calendar id the slot belongs to. */
  practitionerId: string;
  serviceId: string;
  /** Slot start as HH:mm, matching `slot.start_time`. */
  timeHm: string;
  /** The exact input that was validated, mutations and all. */
  input: AppointmentEngineInput;
  /**
   * Which validator the caller used, so the re-check asks the same question.
   * `grid` re-runs `computeAppointmentAvailability` and looks for the slot in
   * the offered set; `exact` re-runs `validateExactAppointmentStart`;
   * `interval` re-runs `validateAppointmentCustomInterval` and needs `endHm`.
   * A visit books off-grid starts and a staff duration override books an
   * arbitrary interval, so asking the grid about either would refuse a booking
   * the original check correctly allowed.
   */
  mode?: 'grid' | 'exact' | 'interval';
  /** Required for `interval`: the core end time as HH:mm. */
  endHm?: string;
}): AppointmentSlotRecheck {
  const { supabase, venueId, date, practitionerId, serviceId, timeHm, input, endHm } = params;
  const mode = params.mode ?? 'grid';

  return {
    async stillAvailable() {
      let fresh: AppointmentEngineInput;
      try {
        fresh = await fetchAppointmentInput({
          supabase,
          venueId,
          date,
          practitionerId,
          serviceId,
        });
      } catch (err) {
        // A failed re-check must not fail the booking. This is a narrowing of an
        // existing race, not a new gate: behaving as though the slot were taken
        // would turn a transient read error into a refused booking that the
        // original validation had already allowed.
        console.error('[revalidate-appointment-slot] reload failed; allowing the write', err, {
          venueId,
          date,
          practitionerId,
        });
        return true;
      }

      const recheckInput: AppointmentEngineInput = {
        ...input,
        existingBookings: fresh.existingBookings,
      };
      if (mode === 'exact') {
        return validateExactAppointmentStart(recheckInput, practitionerId, serviceId, timeHm).ok;
      }
      if (mode === 'interval') {
        if (!endHm) {
          console.error('[revalidate-appointment-slot] interval mode needs endHm; allowing the write');
          return true;
        }
        return validateAppointmentCustomInterval(
          recheckInput,
          practitionerId,
          serviceId,
          timeHm,
          endHm,
        ).ok;
      }
      const result = computeAppointmentAvailability(recheckInput);
      const prac = result.practitioners.find((p) => p.id === practitionerId);
      return Boolean(
        prac?.slots.some((s) => s.start_time === timeHm && s.service_id === serviceId),
      );
    },
  };
}

/** The response body every caller returns when the re-check fails. */
export const SLOT_TAKEN_RESPONSE = {
  error: 'That appointment slot was just taken. Please choose another time.',
  code: 'SLOT_NO_LONGER_AVAILABLE',
} as const;
