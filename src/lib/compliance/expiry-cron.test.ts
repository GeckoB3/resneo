import { describe, expect, it, vi } from 'vitest';
import { FakeSupabase } from '@/lib/compliance/test-utils/fake-supabase';
import { runComplianceExpiry, type ExpiryReminderTarget } from '@/lib/compliance/expiry-cron';

const NOW = new Date('2026-06-01T02:00:00Z');
const iso = (d: Date) => d.toISOString();
const daysFromNow = (n: number) => iso(new Date(NOW.getTime() + n * 86_400_000));

function venueRow(id: string, enabled: boolean, cadence = 7) {
  return {
    id,
    pricing_tier: enabled ? 'appointments' : 'restaurant',
    feature_flags: enabled
      ? { compliance_records_enabled: true, compliance: { reminder_cadence_days: cadence } }
      : {},
  };
}

describe('runComplianceExpiry — expiry pass', () => {
  it('flips completed records past expiry to expired', async () => {
    const fake = new FakeSupabase({
      compliance_records: [
        { id: 'r1', venue_id: 'v1', status: 'completed', expires_at: daysFromNow(-1) }, // expired
        { id: 'r2', venue_id: 'v1', status: 'completed', expires_at: daysFromNow(10) }, // future
        { id: 'r3', venue_id: 'v1', status: 'completed', expires_at: null }, // lifetime
        { id: 'r4', venue_id: 'v1', status: 'voided', expires_at: daysFromNow(-5) }, // already non-completed
      ],
      venues: [venueRow('v1', true)],
    });
    const res = await runComplianceExpiry(fake.asClient(), { now: NOW, sendReminder: async () => true });
    expect(res.expired).toBe(1);
    expect((fake.tables.compliance_records ?? []).find((r) => r.id === 'r1')!.status).toBe('expired');
    expect((fake.tables.compliance_records ?? []).find((r) => r.id === 'r2')!.status).toBe('completed');
  });
});

describe('runComplianceExpiry — reminder pass', () => {
  function setup(opts: { cadence?: number; enabled?: boolean; expiresInDays?: number; reminded?: boolean }) {
    return new FakeSupabase({
      compliance_records: [
        {
          id: 'rec',
          venue_id: 'v1',
          guest_id: 'g1',
          compliance_type_id: 't1',
          status: 'completed',
          expires_at: daysFromNow(opts.expiresInDays ?? 5),
          reminder_sent_at: opts.reminded ? daysFromNow(-1) : null,
        },
      ],
      venues: [venueRow('v1', opts.enabled ?? true, opts.cadence ?? 7)],
    });
  }

  it('reminds a record within the cadence window and marks reminder_sent_at', async () => {
    const fake = setup({ cadence: 7, expiresInDays: 5 });
    const sendReminder = vi.fn(async (_t: ExpiryReminderTarget) => true);
    const res = await runComplianceExpiry(fake.asClient(), { now: NOW, sendReminder });
    expect(sendReminder).toHaveBeenCalledTimes(1);
    expect(res.remindersSent).toBe(1);
    expect((fake.tables.compliance_records ?? [])[0]!.reminder_sent_at).toBeTruthy();
  });

  it('does not remind a record outside the cadence window', async () => {
    const fake = setup({ cadence: 7, expiresInDays: 20 });
    const sendReminder = vi.fn(async () => true);
    const res = await runComplianceExpiry(fake.asClient(), { now: NOW, sendReminder });
    expect(sendReminder).not.toHaveBeenCalled();
    expect(res.remindersAttempted).toBe(0);
  });

  it('skips reminders when compliance is disabled for the venue', async () => {
    const fake = setup({ enabled: false, expiresInDays: 3 });
    const sendReminder = vi.fn(async () => true);
    await runComplianceExpiry(fake.asClient(), { now: NOW, sendReminder });
    expect(sendReminder).not.toHaveBeenCalled();
  });

  it('skips reminders when cadence is 0 (disabled)', async () => {
    const fake = setup({ cadence: 0, expiresInDays: 3 });
    const sendReminder = vi.fn(async () => true);
    await runComplianceExpiry(fake.asClient(), { now: NOW, sendReminder });
    expect(sendReminder).not.toHaveBeenCalled();
  });

  it('does not re-select already-reminded records', async () => {
    const fake = setup({ cadence: 7, expiresInDays: 3, reminded: true });
    const sendReminder = vi.fn(async () => true);
    const res = await runComplianceExpiry(fake.asClient(), { now: NOW, sendReminder });
    expect(sendReminder).not.toHaveBeenCalled();
    expect(res.remindersAttempted).toBe(0);
  });

  it('does NOT mark reminder_sent_at when the send fails, so the next run retries', async () => {
    const fake = setup({ cadence: 7, expiresInDays: 3 });
    const sendReminder = vi.fn(async () => false);
    const res = await runComplianceExpiry(fake.asClient(), { now: NOW, sendReminder });
    expect(res.remindersAttempted).toBe(1);
    expect(res.remindersSent).toBe(0);
    // Left null on failure → a transient channel error doesn't permanently suppress
    // the only expiry reminder the guest would get; the next nightly run re-attempts.
    expect((fake.tables.compliance_records ?? [])[0]!.reminder_sent_at ?? null).toBeNull();
  });

  it('marks reminder_sent_at on a successful send so it is not sent again', async () => {
    const fake = setup({ cadence: 7, expiresInDays: 3 });
    const sendReminder = vi.fn(async () => true);
    const res = await runComplianceExpiry(fake.asClient(), { now: NOW, sendReminder });
    expect(res.remindersSent).toBe(1);
    expect((fake.tables.compliance_records ?? [])[0]!.reminder_sent_at).toBeTruthy();
  });
});
