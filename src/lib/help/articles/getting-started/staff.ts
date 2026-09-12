import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: "staff",
  helpSection: "gs-set-up",
  title: "Add and manage your team",
  description: "Invite your team by email, give each person the right role, and choose which calendars they look after.",
  tags: ["staff","team","roles","admin","permissions","invites","session timeout","calendars"],
  verified: '2026-09-12',
  content: `# Add and manage your team

Give the people you work with their own sign-in, decide what they can reach, and keep the account secure.

> **The one big idea:** a calendar is a bookable column that clients book. A login is a person's sign-in to your dashboard. They are separate things, and your plan limits each of them.

A person who takes bookings but never signs in needs a calendar only. A receptionist who runs the diary but is never booked needs a login only. Most people need both. Calendars are added under **Calendar Availability**, logins under **Settings**, then the **Staff** tab.

## Before you start

- Sign in as an admin. Only admins can invite people, change roles, assign calendars, reset passwords and set the auto-logout timer. A team member's sidebar shows **Account** where yours shows **Settings**, and it opens an **Account settings** page with just **Your profile** (name, email, phone) and **Password**.
- Check how many logins your plan includes. This is a hard limit, and you count as one:

| Plan | Team logins | Bookable calendars |
| --- | --- | --- |
| Appointments Light | 1 | 1 |
| Appointments Plus | 5 | 5 |
| Appointments Pro | Unlimited | Unlimited |

Once every login is used, the **Add User** button disappears and a notice on the **Staff members** card says how many team logins your plan allows, with a link to **Settings**, then **Plan**. On Appointments Light you are the one login, so there is nobody left to invite. That is your plan, not a fault. A two-chair shop where both people sign in needs Appointments Plus.

## Step 1: Invite someone

:::help-figure staff-list

1. Open **Settings** from the sidebar, then the **Staff** tab.
2. In the **Staff members** card, click **Add User**. An **Invite user** form opens.
3. Enter their **Email**.
4. Enter their **Name**. This is optional.
5. Choose a **Role**. It starts on **Staff**; the other choice is **Admin**.
6. For the Staff role, tick any calendars under **Calendars they can manage (optional)**. **All** ticks every calendar and **Clear** unticks them. This box is not shown for an Admin, who reaches every calendar anyway.
7. Click **Send invitation**.

You will see **Invitation sent to** their address. They get an email with a sign-in link. Opening it takes them to **Create your password**, then straight into your dashboard.

> **Good to know:** you do not choose a password for them. If that email address already has a ResNeo login, the form says they were added and may already have an account. No new email may arrive; they can sign in as usual, or use **Forgot password?** on the login page.

> **Only active calendars can be assigned.** A calendar that is switched off is not in the list, and resource calendars never are. If you have no active bookable calendars yet, the form says **Add an active bookable calendar under Calendar availability first**: create one under **Calendar Availability**, **Calendars** tab, with **Active (bookable)** ticked.

## Step 2: Choose the right role

:::help-figure staff-roles

| | Admin | Staff |
| --- | --- | --- |
| Bookings and the diary | Everything | Yes. With one assigned calendar, the diary and the bookings list open filtered to it |
| Client details in **Contacts** | Yes | Yes |
| Hours, breaks and closures under **Calendar Availability** | Any calendar | Only calendars assigned to them. Other calendars are view only |
| **Services** | Create, edit and reorder everything | See the list, add services for their own calendars, choose which services their calendars offer, and adjust their own price or duration where a service allows it |
| **Settings** (profile, business hours, booking page, plan, payments, communications) | Yes | No |
| **Reports** | Yes | No |
| Inviting people, changing roles, the **Auto-Logout Timer** | Yes | No |

The **Role Permissions** box at the bottom of the **Staff members** card summarises this on screen.

> **You cannot change your own role or remove your own login.** ResNeo refuses both. To step back from Admin, make someone else an Admin first and ask them to change you.

## Step 3: Assign calendars

Team members only manage the calendars you give them.

1. On the **Staff** tab, find the person's row. Every Staff-role row has a **Calendars they manage** list.
2. Tick one or more calendars. Use **All** or **None** to move quickly.
3. It saves as you go.

Admins have no list, because they reach everything already.

If a calendar someone manages is later switched off, an amber note on their row lists it under **Inactive calendars still listed for this account**. Activate it again under **Calendar Availability**, or change their assignments.

## Managing people later

Each row has four small icon buttons. Hover to see the name:

- **Change role** (the shield): a dropdown to move someone between **Staff** and **Admin**. It takes effect straight away.
- **Reset password** (the key): opens a **Reset Password** dialog with one **New Password** box of at least 8 characters, then **Reset Password**. Use it only when someone is locked out and cannot use **Forgot password?**. Tell them the new password by text or in person, not by email, and ask them to change it.
- **Resend invitation email** (the envelope): sends a fresh sign-in link and confirms **A new sign-in link was emailed to them.**
- **Remove user** (the bin): opens a **Remove Staff Member** dialog, then **Remove**. Their login goes immediately. Their calendar, their past and future bookings, and their client history all stay exactly where they are, and it frees a login on your plan.

## Change your own password

At the top of the **Staff** tab, the **My account** card has **Change Password**. Enter a **New Password** and **Confirm Password** of at least 8 characters, then click **Update Password**.

## Keep the account secure

1. On the **Staff** tab, find **Security settings**.
2. Choose an **Auto-Logout Timer**: **30 minutes**, **1 hour**, **2 hours**, **4 hours**, **8 hours**, **12 hours**, **24 hours** or **7 days**. New accounts start at 7 days, which is also the longest allowed and is convenient but loose. A shared front-desk tablet is much safer at 30 minutes or an hour.
3. Click **Save**. A **Saved** pill appears and the card shows **Current setting** with the time you chose.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| There is no **Add User** button | You have used every login your plan includes | Check the table above, then change plan under **Settings**, then **Plan** |
| No calendars appear when I invite someone | You have no active bookable calendars yet | Add one under **Calendar Availability**, **Calendars** tab |
| A calendar will not assign | It is switched off, or it is a resource calendar | Tick **Active (bookable)** for that calendar first. Resource calendars cannot be assigned |
| **This email is already a staff member at this venue** | They are already on your list | Find their row and use **Resend invitation email** instead |
| The invitation never arrived | It went to spam, the address was mistyped, or they already had a ResNeo login | Check the address, use **Resend invitation email**, or ask them to try **Forgot password?** on the login page |
| I cannot change my own role | You cannot change your own role or remove yourself | Ask another admin to do it |
| A team member cannot edit their hours | Their account is not assigned to that calendar | Assign the calendar to them on the **Staff** tab |
| A team member can see other people's bookings | This is expected. They can browse every calendar, but only change the ones assigned to them | Review their calendars on the **Staff** tab |

## Next steps

- [Business & calendar hours](/help/getting-started/business-and-calendar-hours)
- [Set up your services](/help/getting-started/services)
- [A tour of your dashboard](/help/getting-started/dashboard-overview)`,
};
