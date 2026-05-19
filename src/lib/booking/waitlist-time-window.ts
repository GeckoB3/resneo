/**
 * Appointment waitlist preferred time windows (all day vs time range).
 */

export type WaitlistTimeWindow =
  | { kind: 'all_day' }
  | { kind: 'exact'; timeHm: string }
  | { kind: 'range'; startHm: string; endHm: string };

export interface WaitlistTimeFields {
  desired_time: string | null;
  desired_time_end?: string | null;
}

function sliceHm(raw: string | null | undefined): string | null {
  if (raw == null || String(raw).trim() === '') return null;
  return String(raw).slice(0, 5);
}

/** Derives guest preference from stored columns. */
export function parseWaitlistTimeWindow(fields: WaitlistTimeFields): WaitlistTimeWindow {
  const start = sliceHm(fields.desired_time);
  const end = sliceHm(fields.desired_time_end);
  if (!start && !end) return { kind: 'all_day' };
  if (start && end) return { kind: 'range', startHm: start, endHm: end };
  if (start) return { kind: 'exact', timeHm: start };
  return { kind: 'all_day' };
}

export function formatWaitlistTimeWindowLabel(fields: WaitlistTimeFields): string {
  const window = parseWaitlistTimeWindow(fields);
  switch (window.kind) {
    case 'all_day':
      return 'All day';
    case 'exact':
      return window.timeHm;
    case 'range':
      return `${window.startHm} – ${window.endHm}`;
  }
}

function timeToMinutes(hm: string): number {
  const [h, m] = hm.slice(0, 5).split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** True when an appointment slot start falls inside the guest's requested window. */
export function slotStartMatchesWaitlistWindow(
  slotStartHm: string,
  fields: WaitlistTimeFields,
): boolean {
  const window = parseWaitlistTimeWindow(fields);
  const slotMin = timeToMinutes(slotStartHm);
  switch (window.kind) {
    case 'all_day':
      return true;
    case 'exact':
      return slotMin === timeToMinutes(window.timeHm);
    case 'range': {
      const start = timeToMinutes(window.startHm);
      const end = timeToMinutes(window.endHm);
      return slotMin >= start && slotMin < end;
    }
  }
}

/** True when a freed slot time matches the guest waitlist preference (cancel auto-offer). */
export function waitlistTimeMatchesFreedSlot(
  fields: WaitlistTimeFields,
  freedTimeHm: string,
): boolean {
  return slotStartMatchesWaitlistWindow(freedTimeHm, fields);
}

export function validateGuestWaitlistTimeInput(input: {
  preferred_window: 'all_day' | 'time_range';
  desired_time?: string;
  desired_time_end?: string;
}):
  | { ok: true; desired_time: null; desired_time_end: null }
  | { ok: true; desired_time: string; desired_time_end: string }
  | { ok: false; error: string } {
  if (input.preferred_window === 'all_day') {
    if (input.desired_time || input.desired_time_end) {
      return { ok: false, error: 'Do not send times when preferred_window is all_day.' };
    }
    return { ok: true, desired_time: null, desired_time_end: null };
  }

  const start = input.desired_time?.trim().slice(0, 5);
  const end = input.desired_time_end?.trim().slice(0, 5);
  if (!start || !end) {
    return { ok: false, error: 'Start and end times are required for a time range.' };
  }
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
    return { ok: false, error: 'Times must be in HH:mm format.' };
  }
  if (timeToMinutes(start) >= timeToMinutes(end)) {
    return { ok: false, error: 'End time must be after start time.' };
  }
  return { ok: true, desired_time: start, desired_time_end: end };
}
