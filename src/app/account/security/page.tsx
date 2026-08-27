import { AccountSecurityClient } from './AccountSecurityClient';

/**
 * WCAG 2.4.2 (Level A): every page needs a title that describes it. Next
 * otherwise falls back to the root layout's title, so all thirteen portal
 * routes announced the same thing and a screen-reader user could not tell from
 * the tab or the announcement which one they were on.
 *
 * This route needed splitting to get one. The whole page was a client
 * component, and a `'use client'` module may not export `metadata`: Next fails
 * the build outright, while `next dev` renders a document with no <html lang>
 * and no <title> at all. The axe spec caught that before the build did.
 */
export const metadata = {
  title: 'Security and data',
  description: 'Password, active sessions and account deletion.',
};

export default function AccountSecurityPage() {
  return <AccountSecurityClient />;
}
