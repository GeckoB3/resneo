import type { AccountLinkView } from './types';

/**
 * The links a venue may build a collective on: accepted, with full calendar
 * detail and create/edit/cancel rights in both directions (plan §7.2).
 */
export function fullMutualLinks(links: AccountLinkView[]): AccountLinkView[] {
  return links.filter(
    (l) =>
      l.status === 'accepted' &&
      l.iCan.calendar === 'full_details' &&
      l.theyCan.calendar === 'full_details' &&
      l.iCan.act === 'create_edit_cancel' &&
      l.theyCan.act === 'create_edit_cancel',
  );
}
