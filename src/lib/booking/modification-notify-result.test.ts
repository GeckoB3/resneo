import { describe, expect, it } from 'vitest';
import { formatBookingModificationNotifyToast } from '@/lib/booking/modification-notify-result';

describe('formatBookingModificationNotifyToast', () => {
  it('describes email and SMS when both sent', () => {
    expect(
      formatBookingModificationNotifyToast({ emailSent: true, smsSent: true, skipped: false }),
    ).toMatch(/email and SMS/i);
  });

  it('returns skipped reason when notifications disabled', () => {
    expect(
      formatBookingModificationNotifyToast({
        emailSent: false,
        smsSent: false,
        skipped: true,
        skippedReason: 'Reschedule notifications are turned off',
      }),
    ).toContain('turned off');
  });
});
