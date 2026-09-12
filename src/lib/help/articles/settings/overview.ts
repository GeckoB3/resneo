import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: 'overview',
  title: 'Settings overview',
  description: 'Every Settings tab and what it holds, what your team sees instead, the ?tab= links, and where the related work lives.',
  tags: ['settings', 'admin', 'staff', 'tabs'],
  verified: '2026-09-12',
  content: `
# Settings overview

**Settings** is where you set up your venue: your business details, your hours, your public booking page, your plan, your payments, your messages, your team and your reports. Day to day work with bookings and clients happens elsewhere in the sidebar.

Open **Settings** from the sidebar, or go to \`/dashboard/settings\`.

> **The one big idea:** **Settings** holds the rules. **Calendar Availability**, **Services**, **Bookings** and **Contacts** hold the day to day work.

## Who can open it

Only an **admin** sees the tabs below.

If your role is **Staff**, your sidebar shows **Account** where an admin's shows **Settings**, and it opens a much shorter page called **Account settings** with two cards: **Your profile** (your name, sign-in email and phone) and **Password**. Everything else is managed by an administrator.

## How saving works

Most fields save on their own. A strip under the tabs reads **Saving changes…** and then **Saved** when a change has gone through, or shows **Error** with what went wrong. A few screens need you to press a button on purpose: **Save opening hours**, staff invites, and anything that hands you over to Stripe.

## Your tabs, one by one

### Profile

Your account and business contact details.

- **Personal details & security**: your own display name, sign-in email, phone and password. These apply to your login only.
- **Venue profile & contact details**: **Name**, **Building / venue name**, **Street**, **Town / city**, **Postcode**, **Phone**, **Email**, **Business website**, **No-show grace period (minutes)** (10 to 60) and **Timezone**. Your timezone decides when reminders go out and how closures line up with your wall clock, so set it before you rely on either.
- **Data import**: an **Open Data Import** button that takes you to the import wizard.

### Business hours

**Weekly opening hours** for the whole venue, then **Closures & special days** for one-off dates. See [Business hours and closures](/help/settings/business-hours).

### Booking Settings

- **Models on your public page**: tick which booking types are live (appointments, classes, events, resources). The card inside is headed **Booking models**.
- **Require ResNeo sign-in to book**: make guests sign in before they can book online.
- **Taking payment in person**: **Take card payments at your venue** for settling a balance on the day.
- **Optional Booking features**: **Any available practitioner**, **Staff-first booking**, **Guest self-reschedule**, **Appointment waitlist**, and **Class packs, courses & memberships**.

### Booking Page

- **URL & branding**: your public web address, logo, cover photo, colours and the tabs guests see. **Open booking page in a new tab** shows you the live page.
- **Website widget & QR code**: **Embed code** with a **Copy code** button for your own website, and **QR code** with **Download QR code** for your reception desk.

### Plan

Your ResNeo subscription: your tier and status, your free trial, SMS usage, calendar usage, **Manage Billing**, **Change Appointments plan**, and the **Danger zone** where you can **Delete this venue**. See [Managing your plan and billing](/help/settings/plan-billing).

### Payments

**Stripe payments**: connect a Stripe account so guests can pay your venue. This is money from guests to you, and is nothing to do with the **Plan** tab. See [Connect Stripe to take payments](/help/getting-started/stripe-payments).

### Communications

**Guest communications**: every automatic email and text, when each one goes out, and your business notifications. See [Guest communications (email and SMS)](/help/getting-started/communications).

### Compliance

Patch tests, consent forms and intake questionnaires: **Templates and types** and **General settings**, where **Enable compliance records for this venue** turns the whole feature on. This tab only appears for admins on an Appointments plan.

### Staff

Your team's logins: **My account**, **Staff members** and **Security settings**. See [Staff accounts, roles and permissions](/help/settings/staff-accounts).

### Reports

Your figures and your CSV exports, on three tabs: **Overview**, **Revenue** (the value of everything on the diary, by day and by calendar) and your client directory. Reports live here now: an old \`/dashboard/reports\` bookmark sends you straight to this tab. See [Exporting your data](/help/settings/data-export).

### Refer & Earn

**Refer a venue, get a free month**: your referral code, your shareable link and **Your referrals**. It only appears when the referral programme is available on your account.

### Linked Accounts

Link up with other ResNeo venues to share calendar visibility and booking access, and build a combined booking page. Admins only.

## Deep links

Every tab has its own web address, so you can bookmark one or send it to a colleague:

- \`/dashboard/settings?tab=profile\` (the one you land on)
- \`?tab=business-hours\`, \`?tab=booking-settings\`, \`?tab=booking-page\`, \`?tab=plan\`, \`?tab=payments\`, \`?tab=comms\`, \`?tab=compliance\`, \`?tab=staff\`, \`?tab=reports\`, \`?tab=refer-earn\`, \`?tab=linked-accounts\`

Two links jump to a section rather than a tab: \`#additional-booking-types\` opens **Booking Settings** at **Models on your public page**, and \`#booking-widget\` opens **Booking Page** at **Website widget & QR code**.

An address you cannot open, because your plan or your role does not have it, quietly lands on **Profile** instead. So does \`?tab=data-import\`, because data import is a card on **Profile** and not a tab of its own.

## Where the related work lives

- **Calendar Availability** (\`/dashboard/calendar-availability\`): your bookable calendars, each one's working hours, breaks, closures and planned hours.
- **Services** (\`/dashboard/appointment-services\`): what you offer, how long it takes and what it costs.
- **Contacts** (\`/dashboard/contacts\`): your client records. Your team can open this too.
- **Compliance** (\`/dashboard/compliance\`): the day to day view of forms due and expiring, once compliance is switched on.
- **Data Import** (\`/dashboard/import\`): bring clients and bookings across from an old system.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| A team member cannot find **Settings** | Their sidebar shows **Account** instead | That is correct. Only admins get venue settings. Change their role on the **Staff** tab if they should have it |
| There is no **Compliance** tab | It only shows for admins on an Appointments plan | Check your plan under **Settings → Plan** |
| There is no **Refer & Earn** tab | The referral programme is not available on your account | Nothing to fix here. Contact support if you were expecting it |
| There is no **Linked Accounts** tab | It is admin only | Sign in on an admin login |
| A \`?tab=\` link keeps landing on **Profile** | That tab is not available to you, or the key is misspelt | Check the list of keys above. \`?tab=data-import\` always lands on **Profile**, where the **Open Data Import** button lives |
| \`/dashboard/reports\` redirects me | Reports moved into **Settings** | Use **Settings → Reports**, or update the bookmark to \`/dashboard/settings?tab=reports\` |
| I changed a field and nothing said **Saved** | Some screens save only when you press the button | Look for **Save opening hours** or **Send invitation** at the bottom of the card |

## Next steps

- [Business hours and closures](/help/settings/business-hours)
- [Staff accounts, roles and permissions](/help/settings/staff-accounts)
- [Managing your plan and billing](/help/settings/plan-billing)
- [A tour of your dashboard](/help/getting-started/dashboard-overview)
`.trim(),
  markdownRestaurant: `
# Settings overview (Restaurant and Founding Partner)

Your venue is on a **Restaurant** or **Founding Partner** subscription. **Settings** at \`/dashboard/settings\` is the admin console for venue identity, hours, subscription billing, Stripe Connect, communications, staff, and imports.

## Tabs you have as an admin

- **Profile**
  - **Personal profile** for your own display name and sign in details on this admin login (this block is the non Appointments product layout).
  - **Venue profile & contact details**: name, address, contact channels, **timezone**, enabled **booking models**, optional **require account login** for online booking.
  - **Dining** card (when your tier is a table product and the venue is not on an Appointments SKU): short explanation with a link to **Dining Availability → Table Management** at \`/dashboard/availability?tab=table\` for floor plan, combinations, and related table configuration that sits outside this tabs list.
- **Booking Page**: public **slug**, logo, cover photo, **booking widget & QR code** (iframe, \`/embed/resize.js\`, deep links).
- **Business hours**: weekly hours plus closures. Restaurant tiers unlock an extra closure type, **Reduced capacity**, tied to table bookings (see Business hours article).
- **Plan**: shows **Restaurant** or **Founding Partner**, subscription status, SMS usage where applicable, calendar usage (no practical cap on this tier), **Manage Billing** for Stripe Customer Portal, **Resubscribe** if the subscription has fully lapsed, and past due handling. Tier changes for this product go through Stripe checkout or portal flows, not the Appointments “change plan” cards.
- **Payments**: **Stripe Connect** for guest card charges into the venue account.
- **Communications**: templates for dining and any enabled add on models (for example classes on a hybrid venue).
- **Staff**: invites, roles, calendar links where schedule models exist, session timeout.
- **Data import**: link to \`/dashboard/import\`.

## Staff on Restaurant plans

Staff visiting \`/dashboard/settings\` get **Account settings** only (personal details and password). They use **Dining Availability**, **Bookings**, **Table Grid**, and other operational links as your venue enables them, but not **Reports** or admin **Settings** tabs.

## Deep links

Same query pattern as other plans: \`?tab=profile\`, \`booking-page\`, \`business-hours\`, \`plan\`, \`payments\`, \`comms\`, \`staff\`, \`data-import\`, plus hashes \`#additional-booking-types\` (Profile) and \`#booking-widget\` (Booking Page).

## Related routes outside Settings

- **Dining Availability** (\`/dashboard/availability\`) for service periods, table management, and anything the Profile dining card points to.
- **Calendar Availability** appears when unified or practitioner style calendars need their own weekly rules.
- **Reports** (\`/dashboard/reports\`) remains admin only for analytics and CSV tools.
`.trim(),
};
