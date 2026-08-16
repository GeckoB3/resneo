import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAX_APPOINTMENT_CORE_DURATION_MINUTES,
  MIN_APPOINTMENT_CORE_DURATION_MINUTES,
  minutesBetweenStartAndEndHM,
  resolveAppointmentModifyEndCoreHHmm,
} from '@/lib/booking/validate-appointment-modification';

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

  it('is sent by the diary on a move, a visit move and a resize', () => {
    const view = read('src/app/dashboard/practitioner-calendar/PractitionerCalendarView.tsx');
    // The diary has to know a break was crossed to say so; the closure helper
    // cannot answer this, because the server treats the two permissions apart.
    expect(view).toContain('windowCrossesBreakBlock(');
    const sent = view.match(/allow_during_breaks: opts\?\.allowDuringBreaks === true/g) ?? [];
    // The move PATCH, the resize PATCH, and the visit dry run.
    expect(sent).toHaveLength(3);
  });
});
