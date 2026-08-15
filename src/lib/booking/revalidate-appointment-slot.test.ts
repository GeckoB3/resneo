import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const computeAppointmentAvailability = vi.fn();
const fetchAppointmentInput = vi.fn();
const validateExactAppointmentStart = vi.fn();
const validateAppointmentCustomInterval = vi.fn();

vi.mock('@/lib/availability/appointment-engine', () => ({
  computeAppointmentAvailability: (...a: unknown[]) => computeAppointmentAvailability(...a),
  fetchAppointmentInput: (...a: unknown[]) => fetchAppointmentInput(...a),
  validateExactAppointmentStart: (...a: unknown[]) => validateExactAppointmentStart(...a),
  validateAppointmentCustomInterval: (...a: unknown[]) => validateAppointmentCustomInterval(...a),
}));

const { createAppointmentSlotRecheck, SLOT_TAKEN_RESPONSE } = await import(
  './revalidate-appointment-slot'
);

const db = {} as SupabaseClient;

/** The input the caller validated, complete with the mutations it applied. */
const capturedInput = {
  date: '2026-09-01',
  services: [{ id: 's1', duration_minutes: 75 }],
  existingBookings: [{ id: 'stale' }],
  phantomBookings: [{ id: 'phantom' }],
  skipPastSlotFilter: true,
} as never;

const base = {
  supabase: db,
  venueId: 'v1',
  date: '2026-09-01',
  practitionerId: 'p1',
  serviceId: 's1',
  timeHm: '10:00',
  input: capturedInput,
};

const withSlot = () => ({
  practitioners: [{ id: 'p1', slots: [{ start_time: '10:00', service_id: 's1' }] }],
});
const withoutSlot = () => ({ practitioners: [{ id: 'p1', slots: [] }] });

beforeEach(() => {
  vi.clearAllMocks();
  fetchAppointmentInput.mockResolvedValue({ existingBookings: [{ id: 'fresh' }] });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('createAppointmentSlotRecheck (C3 interim)', () => {
  it('passes when the slot is still offered', async () => {
    computeAppointmentAvailability.mockReturnValue(withSlot());
    expect(await createAppointmentSlotRecheck(base).stillAvailable()).toBe(true);
  });

  it('fails when the slot was taken between validation and insert', async () => {
    computeAppointmentAvailability.mockReturnValue(withoutSlot());
    expect(await createAppointmentSlotRecheck(base).stillAvailable()).toBe(false);
  });

  it('re-checks against FRESH bookings but the caller-mutated input', async () => {
    // The whole point: the engine input carries mutations the caller applied
    // (add-on duration folded into the service, venue clock, skipPastSlotFilter),
    // and rebuilding it here would duplicate that and let the copies drift. Only
    // the volatile part may be replaced.
    computeAppointmentAvailability.mockReturnValue(withSlot());
    await createAppointmentSlotRecheck(base).stillAvailable();

    const passed = computeAppointmentAvailability.mock.calls[0]![0] as Record<string, unknown>;
    expect(passed.existingBookings).toEqual([{ id: 'fresh' }]);
    expect(passed.services).toEqual([{ id: 's1', duration_minutes: 75 }]);
    expect(passed.skipPastSlotFilter).toBe(true);
    // Phantom bookings are in-request constructs with no rows, so a re-fetch
    // cannot see them; dropping them would make a visit collide with itself.
    expect(passed.phantomBookings).toEqual([{ id: 'phantom' }]);
  });

  it('does not mutate the captured input', async () => {
    computeAppointmentAvailability.mockReturnValue(withSlot());
    await createAppointmentSlotRecheck(base).stillAvailable();
    expect((capturedInput as unknown as { existingBookings: unknown }).existingBookings).toEqual([
      { id: 'stale' },
    ]);
  });

  it('allows the write when the reload fails, rather than refusing a valid booking', async () => {
    // This narrows an existing race; it is not a new gate. A transient read
    // error must not turn into a refused booking the first check had allowed.
    fetchAppointmentInput.mockRejectedValue(new Error('connection reset'));
    expect(await createAppointmentSlotRecheck(base).stillAvailable()).toBe(true);
    expect(computeAppointmentAvailability).not.toHaveBeenCalled();
  });

  it('uses the exact-start validator in exact mode, not the grid', async () => {
    // A visit books off-grid starts, so the grid would refuse starts this route
    // legitimately allows.
    validateExactAppointmentStart.mockReturnValue({ ok: true });
    const r = await createAppointmentSlotRecheck({ ...base, mode: 'exact' }).stillAvailable();
    expect(r).toBe(true);
    expect(validateExactAppointmentStart).toHaveBeenCalledTimes(1);
    expect(computeAppointmentAvailability).not.toHaveBeenCalled();
  });

  it('uses the interval validator in interval mode', async () => {
    validateAppointmentCustomInterval.mockReturnValue({ ok: false });
    const r = await createAppointmentSlotRecheck({
      ...base,
      mode: 'interval',
      endHm: '11:15',
    }).stillAvailable();
    expect(r).toBe(false);
    expect(validateAppointmentCustomInterval).toHaveBeenCalledWith(
      expect.anything(), 'p1', 's1', '10:00', '11:15',
    );
  });

  it('allows the write in interval mode when endHm is missing', async () => {
    const r = await createAppointmentSlotRecheck({ ...base, mode: 'interval' }).stillAvailable();
    expect(r).toBe(true);
    expect(validateAppointmentCustomInterval).not.toHaveBeenCalled();
  });

  it('exposes a stable refusal shape for every call site', () => {
    expect(SLOT_TAKEN_RESPONSE.code).toBe('SLOT_NO_LONGER_AVAILABLE');
  });
});
