export interface BookingModificationNotifyResult {
  emailSent: boolean;
  smsSent: boolean;
  skipped: boolean;
  skippedReason?: string;
}

export function formatBookingModificationNotifyToast(
  result: BookingModificationNotifyResult,
): string {
  if (result.skipped) {
    return result.skippedReason ?? 'Guest was not notified (reschedule notifications are off).';
  }
  if (result.emailSent && result.smsSent) return 'Update sent by email and SMS.';
  if (result.emailSent) return 'Update sent by email.';
  if (result.smsSent) return 'Update sent by SMS.';
  return 'Guest has no email or phone on file — update was not sent.';
}
