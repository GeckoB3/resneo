import { describe, it, expect } from 'vitest';
import {
  bookingImportCommsFields,
  isScheduledReminderWindowPassedAtImport,
  parseSendImportRemindersFromSession,
  SEND_IMPORT_REMINDERS_SESSION_KEY,
} from '@/lib/import/booking-import-comms';
import { CRON_COMMS_TOLERANCE_MS } from '@/lib/cron/comms-timing';

describe('parseSendImportRemindersFromSession', () => {
  it('defaults to true when unset', () => {
    expect(parseSendImportRemindersFromSession({})).toBe(true);
    expect(parseSendImportRemindersFromSession(null)).toBe(true);
  });

  it('returns false only when explicitly false', () => {
    expect(
      parseSendImportRemindersFromSession({ [SEND_IMPORT_REMINDERS_SESSION_KEY]: false }),
    ).toBe(false);
  });
});

describe('bookingImportCommsFields', () => {
  const futureDate = () => {
    const d = new Date(Date.now() + 48 * 3_600_000);
    return d.toISOString().slice(0, 10);
  };

  it('suppresses all comms when opt-out', () => {
    expect(
      bookingImportCommsFields({
        bookingDateYmd: futureDate(),
        timeForDb: '10:00:00',
        sendImportReminders: false,
      }),
    ).toEqual({ suppress_import_comms: true });
  });

  it('allows cron when reminders enabled and appointment is in the future', () => {
    expect(
      bookingImportCommsFields({
        bookingDateYmd: futureDate(),
        timeForDb: '10:00:00',
        sendImportReminders: true,
      }),
    ).toEqual({ suppress_import_comms: false });
  });

  it('suppresses when appointment start is in the past', () => {
    const past = new Date(Date.now() - 3_600_000).toISOString().slice(0, 10);
    expect(
      bookingImportCommsFields({
        bookingDateYmd: past,
        timeForDb: '00:00:00',
        sendImportReminders: true,
      }),
    ).toEqual({ suppress_import_comms: true });
  });
});

describe('isScheduledReminderWindowPassedAtImport', () => {
  const tolerance = CRON_COMMS_TOLERANCE_MS;
  const dayMs = 24 * 60 * 60 * 1000;

  it('is not passed at 36h before a 24h reminder', () => {
    expect(isScheduledReminderWindowPassedAtImport(36 * 3_600_000, 24, tolerance)).toBe(false);
  });

  it('is passed at 20h before a 24h reminder', () => {
    expect(isScheduledReminderWindowPassedAtImport(20 * 3_600_000, 24, tolerance)).toBe(true);
  });

  it('is passed at 1h before a 2h reminder', () => {
    expect(isScheduledReminderWindowPassedAtImport(1 * 3_600_000, 2, tolerance)).toBe(true);
  });

  it('is not passed at 3h before a 2h reminder', () => {
    expect(isScheduledReminderWindowPassedAtImport(3 * 3_600_000, 2, tolerance)).toBe(false);
  });

  it('uses hoursBefore in ms', () => {
    const msUntil = 30 * 3_600_000;
    expect(isScheduledReminderWindowPassedAtImport(msUntil, 48, tolerance)).toBe(true);
    expect(isScheduledReminderWindowPassedAtImport(msUntil, 24, tolerance)).toBe(false);
  });
});
