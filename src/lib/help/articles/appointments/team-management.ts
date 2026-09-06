import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: 'team-management',
  helpSection: 'setup',
  title: 'Team access, roles, and calendar links',
  description: 'Invite admins and staff, assign calendars, respect plan staff caps, reset passwords, and set the auto-logout timer for shared devices.',
  tags: ['staff', 'roles', 'security', 'invites', 'calendars', 'auto-logout'],
  verified: '2026-09-06',
  content: `
# Build a safe team workspace

Every person who signs in to your dashboard has a login. Admins manage logins under **Settings**, then the **Staff** tab. This article goes deeper than [Add and manage your team](/help/getting-started/staff): it covers what happens behind each button, what a calendar-scoped team member really can and cannot reach, and how to keep a shared front-desk device secure.

> **A login is not a calendar.** A calendar is a bookable column clients book into. A login is a person's sign-in. Your plan limits each of them separately, and one person can have either, both, or neither.

## Invite flow

:::help-figure team-access

1. Open **Settings**, then the **Staff** tab.
2. In the **Staff members** card, click **Add User**. The **Invite user** form opens.
3. Enter their **Email**. This is the only required field besides the role.
4. Enter their **Name**. This is optional.
5. Choose a **Role**. The form starts on **Staff**; the other choice is **Admin**.
6. For the Staff role, tick calendars under **Calendars they can manage (optional)**. **All** ticks every calendar, **Clear** unticks them. The box is hidden for an Admin, who reaches every calendar anyway.
7. Click **Send invitation**.

The green message reads **Invitation sent to** their address. They get an email from ResNeo with a single sign-in link. Opening it lands them on **Create your password**, and from there straight into your dashboard.

You never choose a password for them, and the link is single use. If it is lost, expired, or went to spam, use **Resend invitation email** rather than creating a second login.

### When the invite does not send an email

If that address already has a ResNeo login, ResNeo still adds them to your team but no new email goes out. The message says they were added and may already have an account, and that they can sign in as usual or use **Forgot password?** on the login page. That is expected, not a fault.

### Things the form will refuse

| Message | What it means |
| --- | --- |
| **This email is already a staff member for this venue** | They are on your list already. Find their row and use **Resend invitation email** |
| **Inactive calendars cannot be assigned to staff. Activate the calendar first or choose another.** | The calendar you picked is switched off |
| **Add an active bookable calendar under Calendar availability first.** | You have no active bookable calendars yet |
| A message naming your plan and how many team logins it allows | You have used every login your plan includes |

## Plan caps

Team logins are capped by your plan, and you count as one:

| Plan | Team logins | Bookable calendars |
| --- | --- | --- |
| Appointments Light | 1 | 1 |
| Appointments Plus | 5 | 5 |
| Appointments Pro | Unlimited | Unlimited |

When the cap is reached the **Add User** button disappears from the **Staff members** card and an amber notice takes its place, naming your plan, the number of logins it allows, and linking to **Settings**, then **Plan**. The limit is enforced on the server too, so it cannot be worked around.

On Appointments Light you are the single login, so there is nobody left to invite. A two-person shop where both sign in needs Appointments Plus.

Removing someone frees their login immediately, so a leaver makes room for a joiner without a plan change.

## Calendar assignment: what it actually controls

Admins have no calendar assignments, because they reach everything. Assignments only apply to the **Staff** role, and they are the whole of that person's edit permission.

- **Diary and bookings.** When exactly one calendar is assigned, the appointment calendar and the bookings list open filtered to it. With two or more assigned, both open on **All**. Either way they can still switch the filter and look at other people's columns. Seeing is not the same as changing.
- **Hours, breaks and closures.** They can edit these only for calendars assigned to them. Anything else is view only.
- **Services.** They see the whole service list and can add services on their own calendars, use **Offer on your calendars** to choose which of their calendars offer a service, and use **Edit your settings** to adjust their own price or duration where a service allows it. They cannot create, rename, reorder or delete services for the venue.
- **Classes, events and resources.** Only the ones on calendars assigned to them.

Two messages tell you the scoping is doing its job. **No calendars are assigned to your account. Ask an admin to assign at least one calendar.** means the person has no assignments at all, so nothing is editable. **You can only manage calendars assigned to your account.** means they tried to change a column that is not theirs.

To change assignments later, find the person's row on the **Staff** tab and tick or untick calendars under **Calendars they manage**. **All** and **None** move quickly, and it saves as you go, with no Save button.

If a calendar someone manages is later switched off, an amber note appears on their row listing it under **Inactive calendars still listed for this account**. Activate it again under **Calendar Availability**, or update their assignments.

## Day-two operations

Each row on the **Staff** tab has four small icon buttons. Hover to see the name.

- **Change role** (the shield): a small dropdown between **Staff** and **Admin**. It takes effect straight away. You cannot change your own role, so to step back from Admin, make someone else an Admin first and ask them to change you.
- **Reset password** (the key): opens a **Reset Password** dialog with a single **New Password** box of at least 8 characters, then **Reset Password**. There is no confirm box, so type carefully. Use it only when someone is locked out and cannot use **Forgot password?**, tell them the new password in person or by text rather than email, and ask them to change it.
- **Resend invitation email** (the envelope): sends a fresh sign-in link and confirms **A new sign-in link was emailed to them.**
- **Remove user** (the bin): opens **Remove Staff Member**, then **Remove**. Their sign-in stops at once. Their calendar, their past and future bookings and their client history all stay exactly where they are.

To change your own password, use **Change Password** in the **My account** card at the top of the tab. That form has both **New Password** and **Confirm Password**, then **Update Password**.

## Session timeout

1. On the **Staff** tab, scroll to **Security settings**.
2. Choose an **Auto-Logout Timer**: **30 minutes**, **1 hour**, **2 hours**, **4 hours**, **8 hours**, **12 hours**, **24 hours** or **7 days**. This is inactivity, not total time signed in.
3. Click **Save**. A **Saved** pill appears and the card shows **Current setting** with the period you chose.

New venues start at 7 days, which is also the longest allowed. It is convenient on a device only you use, and far too loose on a tablet at reception. A shared front-desk device is much safer at 30 minutes or an hour. The setting applies to every login at the venue, not just your own, and only an admin can change it.

## What staff cannot see

A team member without admin rights has **Account** in the sidebar where an admin has **Settings**, and it opens an **Account settings** page with only **Your profile** (name, email, phone) and **Password**. No venue settings, no plan or billing, no payments, no communications, no booking page.

**Reports** and **Data import** are admin only too. Opening either page as a team member sends them back to the dashboard rather than showing an error.

If someone needs billing or reporting access, the only way to give it is to make them an Admin, which gives them everything including the ability to change your role. Promote thoughtfully.

## Support

Everyone, whatever their role, has **Support** in the sidebar footer. It opens a form with a **Category** (**General question**, **Billing & payments**, **Technical issue** or **Feature request**), your contact email and phone, a **Subject** and a **Message**, then **Send Message**. The same page links to this help centre.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| There is no **Add User** button | Every login your plan includes is in use | Remove a leaver, or change plan under **Settings**, then **Plan** |
| No calendars appear on the invite form | You have no active bookable calendars yet | Add one under **Calendar Availability**, **Calendars** tab, with **Active (bookable)** ticked |
| A calendar will not tick | It is switched off, or it is a resource calendar | Activate the calendar first. Resource calendars are never staff-assignable |
| The invitation never arrived | Spam, a mistyped address, or they already had a ResNeo login | Check the address, use **Resend invitation email**, or ask them to try **Forgot password?** on the login page |
| A team member cannot edit their hours | They have no calendars assigned, or not that one | Tick the calendar on their row under **Calendars they manage** |
| A team member can see other people's bookings | Expected. Assignments control what they can change, not what they can look at | Review their calendars on the **Staff** tab |
| Someone is signed out too often, or not often enough | The **Auto-Logout Timer** applies to the whole venue | Change it once under **Security settings** on the **Staff** tab |
| A team member cannot open Reports | Reports are admin only | Run the report yourself, or change their role |

## Next steps

- [Add and manage your team](/help/getting-started/staff)
- [Set up your calendars](/help/appointments/calendar-setup)
- [Working hours and availability](/help/appointments/working-hours)
- [Staff accounts and roles](/help/settings/staff-accounts)
`.trim(),
};
