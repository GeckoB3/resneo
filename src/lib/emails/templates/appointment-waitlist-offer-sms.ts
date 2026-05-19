import type { RenderedSms } from '../types';

/**
 * Waitlist offer SMS — booking link only (no venue phone).
 */
export function renderAppointmentWaitlistOfferSms(bookingPageUrl: string): RenderedSms {
  return { body: bookingPageUrl.trim() };
}
