import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: 'staff-accounts',
  title: 'Staff accounts, roles and permissions',
  description: 'The Staff tab: your own password, invites, Admin vs Staff, calendar assignments, the auto-logout timer and plan caps.',
  tags: ['staff', 'roles', 'permissions', 'invites', 'session timeout'],
  verified: '2026-09-12',
  content: `
# Staff accounts, roles and permissions

**Settings → Staff** is where you give people their own sign-in, decide what they can reach, and keep the account secure. It has three cards: **My account**, **Staff members** and **Security settings**.

Only an admin can open this tab. For the step by step version of setting your team up, see [Add and manage your team](/help/getting-started/staff).

> **The one big idea:** a login is a person's sign-in to your dashboard. A calendar is a bookable column that clients book. They are separate things, and your plan limits each of them.

## My account

Your own password, at the top of the tab.

1. Click **Change Password**.
2. Enter a **New Password** and **Confirm Password**, at least 8 characters.
3. Click **Update Password**. A **Saved** pill confirms it.

## Staff members

### Inviting someone

1. Click **Add User** at the top right of the card. An **Invite user** form opens.
2. Enter their **Email**. This one is required.
3. Enter their **Name**, if you want one.
4. Choose a **Role**. It starts on **Staff**; the other choice is **Admin**.
5. For the Staff role, tick the calendars they look after under **Calendars they can manage (optional)**. **All** ticks every one and **Clear** unticks them. Admins are not shown this box, because they reach every calendar anyway.
6. Click **Send invitation**.

You will see **Invitation sent to** their address. They get an email with a link, which takes them to **Create your password** and then straight into your dashboard. You never choose a password for them.

If that email address already has a ResNeo login, the message instead says they were added and may already have an account. No new email may arrive; they can sign in as usual or use **Forgot password?** on the login page.

Only **active bookable calendars** appear in the list, and resource calendars never do. With none set up, the form says **Add an active bookable calendar under Calendar availability first**.

### Admin or Staff

| | Admin | Staff |
| --- | --- | --- |
| Bookings and the diary | Everything | Yes |
| Client details in **Contacts** | Yes | Yes |
| Hours, breaks and closures under **Calendar Availability** | Any calendar | Only the calendars assigned to them. The rest are view only |
| **Settings** tabs | Yes | No. They get **Account settings**: **Your profile** and **Password** |
| **Reports** | Yes | No |
| Inviting people, changing roles, resetting passwords, the **Auto-Logout Timer** | Yes | No |

The **Role Permissions** box at the bottom of the card sums this up on screen: **Admin** has full access to all settings, staff management, reports and bookings, while **Staff** work in the dashboard for day to day operations, schedule, bookings and guest details for the calendars you assign.

> **You cannot change your own role or remove your own login.** ResNeo answers **You cannot change your own role** and **You cannot remove yourself**. To step back from Admin, make someone else an Admin first and ask them to change you.

### Which calendars each person manages

Every **Staff** row has its own **Calendars they manage** list. Tick or untick a calendar and it saves as you go, with **All** and **None** to move quickly. Admin rows have no list.

If a calendar someone manages is later switched off, an amber note appears on their row: **Inactive calendars still listed for this account**, followed by the names. Switch the calendar back on under **Calendar Availability**, or change their assignments here.

### Managing people later

Each row ends in four small icon buttons. Hover to see the name:

- **Change role** (the shield): swaps someone between **Staff** and **Admin**, straight away.
- **Reset password** (the key): opens a **Reset Password** dialog with one **New Password** box of at least 8 characters, then **Reset Password**. Use it only when someone is locked out and cannot use **Forgot password?**. Tell them the new password in person or by text, not by email, and ask them to change it.
- **Resend invitation email** (the envelope): sends a fresh sign-in link and confirms **A new sign-in link was emailed to them.**
- **Remove user** (the bin): opens a **Remove Staff Member** dialog, then **Remove**. Their login stops working immediately. Their calendar, their past and future bookings and their client history all stay exactly where they are, and it frees a login on your plan.

## How many logins your plan includes

Your tier caps the number of active logins, and you count as one:

| Plan | Team logins | Bookable calendars |
| --- | --- | --- |
| Appointments Light | 1 | 1 |
| Appointments Plus | 5 | 5 |
| Appointments Pro | Unlimited | Unlimited |

Once every login is used, the **Add User** button disappears and an amber notice takes its place: your plan **allows up to** that many team logins, with a link to **Settings → Plan**. On Appointments Light you are the one login, so there is nobody left to invite. That is the plan, not a fault.

The same limits work in reverse when you downgrade. Moving to a smaller plan is refused while you have more logins than it allows, with **Remove extra team members so only one login remains before downgrading to Light** or **Appointments Plus includes up to 5 team logins. Remove extra team members before downgrading.**

## Security settings

1. Find **Security settings** at the bottom of the tab.
2. Choose an **Auto-Logout Timer**: **30 minutes**, **1 hour**, **2 hours**, **4 hours**, **8 hours**, **12 hours**, **24 hours** or **7 days**. This is how long someone can be inactive before ResNeo signs them out.
3. Click **Save**. A **Saved** pill appears and the card shows **Current setting** with the time you chose.

New accounts start at 7 days, which is also the longest allowed. It is convenient but loose. A shared front-desk tablet is much safer at 30 minutes or an hour.

The timer applies to everyone at the venue, including you.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| There is no **Add User** button | Every login your plan includes is in use | Check the table above, then change plan under **Settings → Plan** |
| No calendars appear when I invite someone | You have no active bookable calendars yet | Add one under **Calendar Availability**, on the **Calendars** tab, with **Active (bookable)** ticked |
| A calendar will not assign | It is switched off, or it is a resource calendar | Switch it back on first. Resource calendars cannot be assigned to a person |
| The invitation never arrived | It went to spam, the address was mistyped, or they already had a ResNeo login | Check the address, use **Resend invitation email**, or ask them to try **Forgot password?** on the login page |
| I cannot change my own role | ResNeo will not let anyone change or remove their own login | Ask another admin to do it |
| A team member cannot edit their hours | Their login is not assigned to that calendar | Tick that calendar on their row |
| A team member can see other people's bookings | This is expected. They can browse every calendar, but only change the ones assigned to them | Review their calendars on this tab |
| Everyone keeps getting signed out | The **Auto-Logout Timer** is short | Raise it under **Security settings**, then **Save** |

## Next steps

- [Add and manage your team](/help/getting-started/staff)
- [Settings overview](/help/settings/overview)
- [Login, staff access and permissions](/help/troubleshooting/access-issues)
`.trim(),
  markdownRestaurant: `
# Staff accounts (Restaurant and Founding Partner)

## Roles

- **Admins** get the full **Settings** tab strip plus **Reports** and **Dining Availability** in the sidebar.
- **Staff** use \`/dashboard/settings\` as **Account settings** only: personal details and password. They work covers in **Bookings**, **Day Sheet**, **Table Grid**, or other links your venue enables, but cannot open venue wide **Settings** tabs.

## Invites

**Settings → Staff → Add user** sends the same password setup email as on Appointments plans. Pick **Admin** only for people who should manage money, communications, imports, and floor plans.

## Calendar assignment

If the venue enables unified scheduling or practitioner calendars alongside tables, staff rows still show **calendar** checkboxes. Assign calendars for anyone who runs schedule bookings; pure table venues may leave those lists empty.

## Session timeout

Configure under **Staff** so shared iPads in the dining room sign out automatically.

## Plan limits

Restaurant and Founding tiers use the unlimited staff cap in code, so you will not see the Appointments style “upgrade for more seats” banner from staff limits.

## Good practice

Remove or downgrade ex employees promptly, and keep the admin roster small.
`.trim(),
};
