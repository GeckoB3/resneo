import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: 'access-issues',
  title: 'Login, staff access and permissions',
  description: 'Sign-in links that will not work, password resets, what a team member cannot reach, auto-logout, and billing locks.',
  tags: ['login', 'access', 'auth'],
  verified: '2026-09-12',
  content: `
# Login, staff access and permissions

What someone can reach comes down to three things: whether they are signed in, whether their login is an **Admin** or a **Staff** member, and whether the venue's subscription is healthy.

## A sign-in link will not work

Links in ResNeo emails are single use, and you will see one of these on the login page:

- **This sign-in link was already used or has expired. Please request a new link.** Ask for a fresh one, or sign in with a password instead.
- **We could not complete sign-in from that link.** Open the newest link in the inbox, on the device you want to use, or sign in with a password.
- **Your session has expired due to inactivity. Please sign in again.** The venue's auto-logout timer ran out. Just sign in again.

## A password reset never arrives

On the login page click **Forgot password?**, enter the email, and click **Send Reset Link**. You should see **Check your inbox for a link to reset your password.** If nothing arrives, check spam and check the address matches the one on their staff record.

An admin can set a password directly instead: **Settings → Staff**, the key icon on that person's row, then **Reset Password**. Tell them the new password by text or in person, not by email, and ask them to change it.

## Someone cannot see Settings, Reports or Data import

They are on the **Staff** role, and this is working as designed. Their sidebar shows **Account** where an admin's shows **Settings**, and it opens **Account settings** with only their name, email, phone and password. **Reports** and **Data import** are admin only.

To change it, an admin opens **Settings → Staff** and uses the shield icon on their row to switch them to **Admin**. Nobody can change their own role or remove their own login, so ask another admin.

## A team member cannot edit a calendar

Team members can look at every calendar but only change the ones assigned to them. An admin ticks the calendar under **Calendars they manage** on that person's row in **Settings → Staff**.

## Everyone is being logged out too often

Open **Settings → Staff** and find **Security settings**. Set the **Auto-Logout Timer** to anything from **30 minutes** to **7 days**, then click **Save**. It counts inactivity and applies to the whole team, so the front desk tablet and your own laptop share one setting.

## Buttons error even though I am an admin

That is billing, not permissions. A past due subscription blocks saving on every plan, answering with **Billing is past due. Add or update your payment method under Settings → Plan to continue editing.** A subscription that has ended says **Your subscription has ended. Resubscribe under Settings → Plan to continue editing.** and pauses your public booking page as well. Fix it under **Settings → Plan** with **Update payment method**, **Manage Billing** or **Resubscribe**.

## The dashboard keeps sending me back to setup

Your venue is not marked as set up, so every dashboard page bounces back to the setup wizard. Work through it to **Review & Go Live** and click **Go to Dashboard**, which is the step that marks it finished.

## Next steps

- [Add and manage your team](/help/getting-started/staff)
- [Staff accounts and permissions](/help/settings/staff-accounts)
- [Plan and billing](/help/settings/plan-billing)
`.trim(),
  markdownRestaurant: `
# Access issues (Restaurant and Founding Partner)

## Roles

**Admins** manage **Dining Availability**, **Reports**, imports, communications, and Connect. **Staff** take bookings and use **Account** settings only on \`/dashboard/settings\`.

## Password reset

Same **login** page flow as other plans.

## Session timeout

Use **Settings → Staff** to tune logout behaviour for shared hardware on the floor.

## Past due

**Past due** still blocks **venue mutation APIs** for Restaurant tiers until Stripe billing is healthy. Unlike **Appointments Light**, **past_due** alone does not trigger the **public** booking pause helper, but you should still treat it as blocking because staff cannot save fixes.

## Fully expired subscription

When access ends, public booking pauses and admins must **Resubscribe** from **Settings → Plan**.

## Floor plan access

Table layout tools live under **Dining Availability**, not under staff **Account** pages.

## Support

Use \`/dashboard/support\` with screenshots of any unexpected **403** responses from dashboard saves.
`.trim(),
};
