/**
 * One currency per collective (plan §6 graft 4; UX spec `bm.currency.blocked`; BM-04). The page
 * shows the host's currency, so a venue trading in another would have its prices relabelled rather
 * than converted.
 */
import { collectiveCopy } from '@/lib/linked-accounts/collective-copy';

/** A venue's currency as compared: `venues.currency` defaults to GBP. */
export const normalCurrency = (c: string | null | undefined): string => (c?.trim() || 'GBP').toUpperCase();

/** Words for a venue whose currency is not the collective's. */
export function currencyMismatchWords(
  venueName: string,
  currency: string | null | undefined,
  hostCurrency: string | null | undefined,
): string {
  return collectiveCopy('bm.currency.blocked', {
    venue: venueName,
    currency: normalCurrency(currency),
    hostCurrency: normalCurrency(hostCurrency),
  });
}
