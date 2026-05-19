/**
 * Guest self-reschedule policy for appointment bookings (manage link / confirm modify).
 */

export interface GuestAppointmentModifyPolicyInput {
  bookingDate: string;
  bookingTime: string;
  venueTimezone: string;
  /** Hours before appointment start after which self-modify is blocked. */
  modifyNoticeHours: number;
  now?: Date;
}

function parseWallClockToUtcMs(dateYmd: string, timeHm: string, tz: string): number | null {
  const hm = timeHm.length >= 5 ? timeHm.slice(0, 5) : timeHm;
  const [y, mo, d] = dateYmd.split('-').map(Number);
  const [hh, mm] = hm.split(':').map(Number);
  if (!y || !mo || !d || Number.isNaN(hh) || Number.isNaN(mm)) return null;
  const probe = new Date(Date.UTC(y, mo - 1, d, hh, mm, 0));
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(probe).map((p) => [p.type, p.value]),
  );
  const localY = Number(parts.year);
  const localMo = Number(parts.month);
  const localD = Number(parts.day);
  const localH = Number(parts.hour);
  const localM = Number(parts.minute);
  if ([localY, localMo, localD, localH, localM].some((n) => Number.isNaN(n))) return null;
  const offsetMs = probe.getTime() - Date.UTC(localY, localMo - 1, localD, localH, localM, 0);
  return Date.UTC(y, mo - 1, d, hh, mm, 0) - offsetMs;
}

/**
 * Returns a user-facing error when the guest may no longer self-modify, or null if allowed.
 */
export function guestAppointmentModifyBlockedReason(
  input: GuestAppointmentModifyPolicyInput,
): string | null {
  const { bookingDate, bookingTime, venueTimezone, modifyNoticeHours } = input;
  const noticeHours = Math.max(0, modifyNoticeHours);
  if (noticeHours === 0) return null;

  const startMs = parseWallClockToUtcMs(bookingDate, bookingTime, venueTimezone);
  if (startMs == null) return null;

  const nowMs = (input.now ?? new Date()).getTime();
  const cutoffMs = startMs - noticeHours * 60 * 60 * 1000;
  if (nowMs >= cutoffMs) {
    const label =
      noticeHours === 1
        ? '1 hour'
        : `${noticeHours} hours`;
    return `Online changes are not available within ${label} of your appointment. Please contact the venue.`;
  }
  return null;
}
