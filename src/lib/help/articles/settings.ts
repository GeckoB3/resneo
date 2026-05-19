import type { HelpCategory } from '../types';

export const settingsCategory: HelpCategory = {
  slug: 'settings',
  title: 'Settings & account',
  description:
    'Venue Settings for admins, Account for staff, hours, plan, Stripe, comms, team, imports, and how they relate to Contacts and Reports.',
  plan: 'all',
  articles: [
    {
      slug: 'overview',
      title: 'Settings overview',
      description: 'Admin tabs, staff account mode, deep links, and where embeds and dining tools live.',
      tags: ['settings', 'admin', 'staff'],
      content: `
# Settings overview

ReserveNI splits **venue configuration** from **personal login details**. What you see depends on whether you are a **venue admin** or **staff**, and on whether the venue is on an **Appointments** (Light, Plus, or Pro) plan or a **Restaurant / Founding Partner** plan.

## Venue admins

Admins open **Settings** at \`/dashboard/settings\`. Tabs run along the top:

- **Profile**: personal block (varies slightly by product), **venue profile** (name, address, contacts, **timezone**), which **booking models** are enabled, and optional **require account login** for online booking.
- **Booking Page**: public **slug**, logo, cover photo, and **booking widget & QR code** (iframe snippet, deep link query params, \`/embed/resize.js\`, printable QR).
- **Business hours**: weekly **opening hours** (explicit **Save opening hours**) and **Closures & special days** (availability blocks).
- **Plan**: subscription tier and status, SMS and calendar usage summaries, Stripe **Manage Billing**, and (on Appointments SKUs) in app moves between Light, Plus, and Pro when billing allows.
- **Payments**: **Stripe Connect** onboarding for guest card payments to the venue connected account.
- **Communications**: email and SMS templates, timing, and policies (what the venue sends automatically).
- **Staff**: invites, roles, calendar access for schedule calendars, password reset help, **session timeout** for shared devices.
- **Data import**: shortcut card that links to \`/dashboard/import\` (CSV import with validation and undo window).

Simple profile fields tend to save as you work; **opening hours**, **staff** actions, and **Stripe** steps use explicit saves or buttons, as the page subtitle explains.

## Staff (non admin)

Staff still use the route \`/dashboard/settings\`, but the server renders **Account settings** only: name, email, phone, and password. They do **not** get the tabbed venue console. The sidebar label is **Account** instead of **Settings**.

If a staff member tries a deep link such as \`?tab=staff\` or \`?tab=data-import\`, the app sends them back to the account style view.

## Restaurant only surfaces

On **Restaurant** or **Founding Partner** tiers, **Profile** can include a **Dining** card that links to **Dining Availability → Table Management** (\`/dashboard/availability?tab=table\`) for floor plan, combinations, and related table controls. Appointments tier venues do not use that card.

## Anonymous takeaway

Use **Settings** for anything that should apply to the whole venue. Use **Contacts** (\`/dashboard/contacts\`) for guest records, and **Reports** (\`/dashboard/reports\`, admins) for analytics plus full CSV export actions.
`.trim(),
      markdownAppointments: `
# Settings overview (Appointments plans)

Your venue runs on an **Appointments** subscription (Light, Plus, or Pro). **Settings** at \`/dashboard/settings\` is the admin console for everything guests see and for billing, except day to day booking lists (those live under **Bookings**, **Appointment Calendar**, **Contacts**, and similar).

## Tabs you have as an admin

- **Profile**
  - **Personal details & security** for your own login (name, email, phone, password).
  - **Venue profile & contact details**: trading name, address, phone, email, website, and **timezone** (IANA style value). Timezone drives reminders and exception logic with your wall clock.
  - **Models on your public page**: which experiences are active (for example services, classes, events, resources) and whether guests must use a **ReserveNI account** before booking online.
- **Booking Page**
  - **URL & branding**: public **slug**, logo, cover photo, and a link to preview \`/book/[slug]\`.
  - **Website widget & QR code**: copy the **iframe** snippet, optional tab deep links (\`?tab=appointments\`, \`events\`, \`classes\`, \`resources\` as your venue exposes), the **resize.js** script from \`/embed/resize.js\`, and a QR that opens your public page.
- **Business hours**: weekly grid with a dedicated **Save opening hours** strip, then **Closures & special days** for venue wide blocks (see the Business hours help article).
- **Plan**: tier name, subscription state, period dates, **SMS segments** (included bundle vs pay as you go on Light), **calendar usage** against your tier cap, **Manage Billing** (Stripe Customer Portal for card, invoices, cancellation), and **Change Appointments plan** when Stripe shows an active subscription that is not stuck in a blocked state. After checkout or portal return you may see banners or \`?upgraded=\`, \`?downgraded=\`, \`?resubscribed=\`, \`?card_updated=\`, or \`?plan_changed=\` style query params; read them before navigating away. Returning from the portal may also sync via \`portal_return=1\`.
- **Payments**: **Stripe Connect** onboarding so **guests** pay the **venue**; ReserveNI does not hold deposits (see Payments help).
- **Communications**: templates and policies for automated guest email and SMS, respecting your tier SMS rules.
- **Staff**: invite **admin** or **staff** users, assign **staff** to bookable **calendar columns** so **Appointment Calendar** and **Mine** views line up, resend invites, reset passwords, and set optional **session timeout** for shared tablets.
- **Data import**: opens the guided importer at \`/dashboard/import\`.

There is **no** “dining floor plan” card inside Appointments **Profile**; table geometry is not part of this plan.

## Staff on Appointments plans

Same URL, different page: **Account settings** with only personal fields. They still see **Contacts** in the sidebar for guest work, but not **Reports** or full **Settings** tabs.

## Useful deep links

- \`/dashboard/settings?tab=profile\` (default)
- \`/dashboard/settings?tab=booking-page\`, \`business-hours\`, \`plan\`, \`payments\`, \`comms\`, \`staff\`, \`data-import\`
- Hashes: Profile \`#additional-booking-types\`; Booking Page \`#booking-widget\` (scroll to widget & QR)

## Where related work lives

- **Calendar Availability** at \`/dashboard/calendar-availability\` when your venue uses schedule style calendars (not the same screen as **Business hours**, but both affect what guests can book).
- **Appointment services** (and other model tools) live on their own routes; **Settings** controls identity, billing, comms, and team wide rules.
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
    },
    {
      slug: 'business-hours',
      title: 'Business hours and special closures',
      description: 'Weekly hours save strip, closures calendar, and how blocks differ by plan.',
      tags: ['hours', 'closures', 'exceptions'],
      content: `
# Business hours & closures

## Weekly opening hours

**Settings → Business hours** opens the weekly grid. Choose periods per weekday, mark days closed, and use **Save opening hours** when you are happy. The strip stays visible while editing so you can review the full week before committing.

## Closures & special days

The lower card (**Closures & special days**) edits **venue availability blocks**: pick a date range on the calendar, choose a block type, then save.

- Every venue gets **Closure** and **Amended hours** (venue wide).
- **Restaurant** and **Founding Partner** tiers also get **Reduced capacity**, which applies to **table** bookings. Optional **yield** style numeric overrides appear for those restaurant blocks when the form exposes them.

## Timezone

Set the venue **timezone** under **Settings → Profile** in the venue profile card so weekly hours, exceptions, and guest reminders align with your local clock.

## After changes

Smoke test the **public booking page** around today and the next bank holiday you edited. If you use schedule calendars, also glance at **Calendar Availability** when that route is enabled for your venue.
`.trim(),
      markdownAppointments: `
# Business hours & closures (Appointments plans)

## Weekly opening hours

Open **Settings → Business hours**. The first card is **Weekly opening hours**.

Use the grid to mark each weekday open or closed and to add one or more open periods. Changes are not silently pushed: scroll to the bottom and press **Save opening hours** once the week looks correct. If saving fails, the card shows an error string from the API.

These hours are venue wide defaults used with availability and guest messaging, so they should match real operating times.

## Closures & special days

The second card, **Closures & special days**, drives the **availability blocks** API.

For Appointments SKUs the block type picker includes:

- **Closure**: treat the range as closed for venue wide availability.
- **Amended hours**: supply replacement open windows for those dates.

You do **not** get the **Reduced capacity** block type that Restaurant tiers use for table only capacity trims.

Pick dates on the month grid (click to start a range, click again to finish), complete the form, then save. Past blocks stay listed for audit; future blocks drive what guests can book.

## Timezone

The venue **timezone** field lives in **Settings → Profile** (venue profile card). Set it before you rely on closures for late night edges.

## Calendar Availability vs this screen

**Business hours** here is the venue level week and exceptions list. If your venue also uses **Calendar Availability** at \`/dashboard/calendar-availability\`, that screen configures per calendar weekly hours, breaks, and similar. Both can apply depending on model; when unsure, change one at a time and verify on the public page.

## Checklist after edits

1. Save weekly hours if you changed them.
2. Save each closure or amended hours block.
3. Open your public booking link and confirm a known busy day and a closure day behave as expected.
`.trim(),
      markdownRestaurant: `
# Business hours & closures (Restaurant and Founding Partner)

## Weekly opening hours

**Settings → Business hours → Weekly opening hours** is the same explicit save flow for every plan: edit the week, then press **Save opening hours**.

## Closures & special days

**Closures & special days** uses the shared calendar picker. Restaurant tier venues load extra controls:

- **Closure** and **Amended hours** apply to **all** booking types (copy on screen: closures and amended hours apply venue wide; reduced capacity is table bookings only).
- **Reduced capacity**: caps covers for table service across the selected range. When the editor shows **yield** style numeric fields, they map to optional per block overrides stored with the block.

Service scoped fields appear when the venue loads **venue services** for restaurant availability (the UI fetches \`/api/venue/services\` on those tiers).

## Timezone

Configure under **Settings → Profile** with the rest of the public venue identity.

## Table management link

Floor plan geometry and combinations remain under **Dining Availability → Table Management** (\`/dashboard/availability?tab=table\`), not inside the closures card.

## Practical checks

After closures, verify **table** online booking, and any hybrid schedule tabs, on the affected dates.
`.trim(),
    },
    {
      slug: 'staff-accounts',
      title: 'Staff accounts, roles and permissions',
      description: 'Invites, admin vs staff, calendar access, session timeout, and plan caps.',
      tags: ['staff', 'roles', 'permissions'],
      content: `
# Staff accounts

## Roles

- **Admin**: full **Settings** tabs, **Reports**, **Dining Availability** when present, imports, billing, communications, and staff invites.
- **Staff**: operational dashboard routes their role allows. Visiting \`/dashboard/settings\` shows **Account** fields only (personal details, password). They cannot change venue wide configuration.

## Invites

Admins invite from **Settings → Staff → Add user**. The invite email contains a secure link so the recipient sets their own password (you never type a password for them). You can **resend** invites and trigger password resets from the same table when supported.

## Calendar assignment

For schedule style venues, link **staff** users to the **bookable calendar columns** they should appear on. That powers **Appointment Calendar** columns and **Mine** filters.

## Session timeout

Still on **Settings → Staff**: configure optional inactivity timeout for shared front of house tablets.

## Plan caps

**Appointments Light** allows **1** team login, **Plus** up to **5**, **Pro** unlimited (see \`planStaffLimit\` behaviour). **Restaurant** and **Founding** tiers use the unlimited path in code, so the “upgrade to Pro” banner only appears when a capped tier hits its limit.

## Security hygiene

Reset access when someone leaves. Use the session timeout on shared hardware.
`.trim(),
      markdownAppointments: `
# Staff accounts (Appointments plans)

## Who can do what

- **Admins** see every **Settings** tab described in the overview: Profile, Business hours, Plan, Payments, Communications, Staff, Data import.
- **Staff** open \`/dashboard/settings\` but only get **Account settings** (personal name, email, phone, password). They keep **Contacts** and operational calendar links; they do **not** get **Reports** or venue wide tabs.

## Inviting people

Go to **Settings → Staff** and use **Add user**.

1. Enter email (required) and display name.
2. Pick **Staff** or **Admin**. New **staff** invites should pick at least one **bookable calendar** when your venue runs unified scheduling so their appointments appear on the right columns.
3. Submit. ReserveNI emails a link to set a password.

Use **Resend** if the inbox missed the first mail. Password reset helpers live in the same staff table when you need to force a rotation.

## Calendar access

Staff rows list which **calendar columns** a user can manage. This controls **Appointment Calendar** visibility and **Mine** style filters. Admins should revisit assignments whenever you add a new calendar column on **Calendar Availability**.

## Session timeout

The **Staff** tab includes **Session security**: optional inactivity timeout (minutes or hours) applied to dashboard sessions for your team.

## Plan limits on team size

Your tier caps how many active staff logins you may have:

- **Appointments Light**: 1 login (you plus upgrades only if you move tier).
- **Appointments Plus**: up to 5.
- **Appointments Pro**: unlimited in product logic (\`Infinity\` cap).

When you are at the cap, the UI shows an amber banner that tells you to upgrade via **Settings → Plan**.

## Operational note

If a staff member says a menu entry is missing, check role first. The UI hides controls they cannot complete rather than showing broken actions.
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
    },
    {
      slug: 'plan-billing',
      title: 'Managing your plan and billing',
      description: 'Plan tab, Stripe portal, Appointments tier switches, SMS windows, and checkout return params.',
      tags: ['billing', 'subscription', 'sms'],
      content: `
# Plan & billing

Open **Settings → Plan**.

## What the card shows

- Named **tier** (Appointments Light / Plus / Pro, Restaurant, Founding Partner, or complimentary copy when \`billing_access_source\` marks free access).
- **Subscription status** pills such as active, trialing, past due, cancelling, or cancelled, derived from \`plan_status\` and Stripe.
- **Next billing** or **Access until** copy when a cancel is mid period.
- **SMS usage**: segment counts. **Light** lists pay as you go segments with the Light meter rate (currently £0.08 per segment in product constants). Bundled tiers show used vs included, plus metered overage text (currently £0.06 per segment beyond the bundle when billing is not free access).
- **Calendar usage** for tiers that cap calendars (Light 1, Plus 5, otherwise unlimited in UI).

## Actions

- **Manage Billing**: opens **Stripe Customer Portal** in a new tab for cards, invoices, receipts, and cancellation handled by Stripe.
- **Appointments** tiers with a healthy subscription also render **Change Appointments plan** with upgrade/downgrade confirmations and proration estimates from \`/api/venue/appointments-plan/preview\`.
- **Resubscribe** / **Keep my plan** style buttons appear when subscription state requires them (see live banners).

## Return URLs

Checkout and plan flows can append \`?upgraded=true\`, \`?downgraded=true\`, \`?resubscribed=true\`, \`?card_updated=1\`, or \`?plan_changed=1\` to \`/dashboard/settings\`. Read the banner. Portal returns may use \`portal_return=1\` with \`tab=plan\`.

## Not guest payments

This tab is **ReserveNI subscription billing**. Guest card charges remain under **Settings → Payments** (Stripe Connect).
`.trim(),
      markdownAppointments: `
# Plan & billing (Appointments plans)

Open **Settings → Plan**. Everything here is about your **ReserveNI subscription** and SMS entitlements. Guest card payments are configured under **Settings → Payments**.

## Header copy

- Complimentary venues see explanatory text that billing is waived but limits still apply.
- Paid venues see guidance that plan moves happen in ReserveNI while card and invoice administration sits in Stripe’s portal.

## What you can read

- **Tier pill** and **status pill** (active, trialing, past due, cancelling, cancelled).
- **Current plan** and **Next billing** cards, including estimated next invoice text when Stripe sends a billing quote.
- **SMS usage**:
  - **Light**: shows segments used this period, notes pay as you go billing at **£0.08** per segment (see \`SMS_LIGHT_GBP_PER_MESSAGE\`), and may note that the usage window follows the Stripe billing period when that mode applies.
  - **Plus** and **Pro**: show used vs included counts (300 and 800 segments respectively at the time of writing), a progress bar, and overage text at **£0.06** per segment (\`SMS_OVERAGE_GBP_PER_MESSAGE\`) unless you are on complimentary access (then sends stop at the cap).
- **Calendar usage**: counts active bookable columns vs tier caps (**1** on Light, **5** on Plus, **Unlimited** on Pro).

## Actions you may see

- **Manage Billing**: opens Stripe Customer Portal (new tab) for payment methods, invoices, and cancellation.
- **Change Appointments plan**: only when Stripe shows an eligible subscription. Pick **Upgrade** or **Downgrade** between Light, Plus, and Pro, review proration text, then confirm. Downgrades refuse if active calendars or staff exceed the target limits.
- **Resubscribe** when access has fully lapsed, **Keep my plan** when you previously cancelled but are still inside the paid period, and **Update payment method** when Stripe reports past due.

## After checkout or portal visits

Query params such as \`?upgraded=true\` or \`?card_updated=1\` raise banners while webhooks catch up. Returning customers may hit \`portal_return=1\`; the Plan tab refreshes billing status automatically on focus.

## Distinction

Do not confuse this page with **Stripe Connect** onboarding. Connect is about money from guests; this tab is about your subscription to ReserveNI.
`.trim(),
      markdownRestaurant: `
# Plan & billing (Restaurant and Founding Partner)

Open **Settings → Plan** for subscription status, SMS summaries, and Stripe portal access. Guest payments are still under **Settings → Payments** (Connect).

## What you will see

- **Tier** shows **Restaurant** or **Founding Partner** with the published **£79** monthly base in standard copy (coupons may alter invoices).
- **Status** covers active, trialing, past due, cancelling, cancelled, same component as other tiers.
- **SMS** mirrors bundled plus metered behaviour: included allowance with optional overage at **£0.06** per segment when not on complimentary access.
- **Calendar usage** reads **Unlimited** because restaurant tiers do not apply the Appointments calendar caps.

## Actions

- **Manage Billing** opens Stripe Customer Portal for cards, invoices, receipts, address, and subscription cancellation according to Stripe’s flows.
- There is **no** in app **Change Appointments plan** rail here; that UI only appears for Appointments SKUs.

## Lifecycle banners

Expect the same checkout banners (\`?upgraded=true\`, etc.) when Stripe returns to the dashboard, plus cancellation notices with **Manage plan** shortcuts.

## Founding Partner note

Founding Partner is the same monthly table product tier with programme positioning; billing mechanics still run through Stripe like Restaurant.

## Reminder

**Plan** is not where you connect Stripe for guest charges. Use **Payments** for Connect onboarding and account health.
`.trim(),
    },
    {
      slug: 'guest-management',
      title: 'Your guest database and client records',
      description: 'Contacts list, Reports second tab (?tab=clients), tags, notes, and terminology.',
      tags: ['guests', 'crm', 'tags'],
      content: `
# Guest / client management

## Primary list: Contacts

**Contacts** at \`/dashboard/contacts\` is the CRM style list for every venue role that has it in the sidebar. Search, sort, filter, and open a guest to edit details, **tags**, documents where enabled, and timeline history. Old bookmarks to \`/dashboard/guests\` redirect here.

## Reports (admins)

**Reports** at \`/dashboard/reports\` adds a second tab (URL \`?tab=clients\`) whose **label pluralises your venue client word** (often **Clients** or **Guests**). That tab shows summary tiles and shortcuts back to **Contacts** for deep work. **Reports** itself is **admin only**.

## From a booking

Operational sheets still let you adjust **tags** and **internal notes** without leaving the booking flow where the UI exposes those cards.

## Terminology

Venues can rename guest facing words (**client** vs **guest**, **booking** labels) via **terminology** settings; ReserveNI uses those labels in charts and exports when present.

## Compliance

You are responsible for lawful marketing and consent. ReserveNI provides tooling, not legal advice.
`.trim(),
      markdownAppointments: `
# Guest and client records (Appointments plans)

## Contacts is home base

Open **Contacts** (\`/dashboard/contacts\`) from the sidebar. Everyone with that link (admin or staff) gets the searchable guest list, tag filters, and pagination.

Pick someone to open the **contact** drawer: edit phone and email where permitted, maintain **tags**, upload **documents** when that section is enabled, read the **timeline**, and send ad hoc messages if your workflow includes that action.

Bookmark **\`/dashboard/guests\`** still works; it simply redirects into **Contacts**.

## Reports for admins

Venue **admins** also use the second **Reports** tab (URL \`?tab=clients\`, label from your **terminology**, often **Clients**). That tab shows aggregate summary tiles and quick exports, but the narrative copy in app explicitly steers you back to **Contacts** for filtered views, communications history, and the richer CRM tools.

## During booking handling

Appointment and class sheets include panels for **tags** and **internal customer notes** so front desk staff can annotate without bouncing to another route.

## Terminology

Appointments venues often set **client** wording in **terminology**. Charts, CSV headers, and some buttons adopt that language automatically.

## Light touch compliance

Tags and notes can contain sensitive observations. Only staff who should see them have accounts, but you are still responsible for GDPR style fairness and for marketing consent on campaigns you send off platform.
`.trim(),
      markdownRestaurant: `
# Guest records (Restaurant and Founding Partner)

## Contacts

**Contacts** (\`/dashboard/contacts\`) remains the shared CRM list for admins and staff who have the link. Use it for phone edits, **tags**, visit counts, and household tools when enabled.

## Reports

Admins should use the second **Reports** tab (\`/dashboard/reports?tab=clients\`, label from **terminology**) when they want summary KPIs or quick exports, then drop into **Contacts** for full detail work, mirroring the in app guidance.

## Table service specifics

Restaurant bookings still attach guest profiles. Internal notes entered while managing **Bookings** or **Day Sheet** sync back to the contact record when the UI offers that field.

## Tags and marketing

Tags are handy for VIPs or dietary flags, not a replacement for consent tracking. Use your own policies before bulk email.
`.trim(),
    },
    {
      slug: 'data-export',
      title: 'Exporting all your data',
      description: 'Reports full CSV, per chart CSV, import undo reports, and security notes.',
      tags: ['export', 'csv', 'backup'],
      content: `
# Exporting all your data

## Full venue CSVs

Inside **Reports** on the **Overview** tab, scroll to **Export your data**. Buttons call \`/api/venue/export?type=bookings\` and \`/api/venue/export?type=guests\`, which download **entire venue** CSV files not scoped to the date picker above.

Copy uses your **terminology** (for example **clients** vs **guests**) when the dashboard is in appointment style experience.

## Chart level CSVs

Each analytics card on **Reports** includes its own **Download CSV** action for the currently applied date range. If a dataset is empty, the UI shows a notice instead of downloading an empty file.

## Import audit

After **Settings → Data import** (\`/dashboard/import\`), download the per session CSV from the import UI to see what changed. Imports are designed to be reversible within the product’s undo window (see in app copy for the exact retention).

## Security

CSV downloads may contain PII and payment references. Store them encrypted at rest inside your organisation.
`.trim(),
      markdownAppointments: `
# Exporting data (Appointments plans)

## Full CSV exports

1. Sign in as an **admin** (staff cannot open **Reports**).
2. Go to \`/dashboard/reports\` and stay on the default **Overview** tab (the **Clients** tab is separate).
3. Scroll to the **Export your data** card.
4. Use **Export all bookings** or **Export all …** client list button. These hit \`/api/venue/export\` and download the **whole venue**, ignoring the date range control used for charts.

Appointment style venues see wording that matches **terminology** (for example **Appointments** instead of **Bookings**).

## Per report CSVs

Higher up the same Overview tab, each report section (activity, no shows, cancellations, payments, practitioner breakdowns, etc.) exposes **Download CSV** for **only** the selected date span. Use those for finance or ops slices.

## Import reporting

**Settings → Data import** links to \`/dashboard/import\`. After a session finishes, download the session report CSV from that wizard if you need an audit trail.

## Staff limitation

If someone on the team needs a full export, they must ask an **admin** because **Reports** is blocked for staff accounts.

## Handling downloads

Browsers save files locally; delete copies when no longer needed.
`.trim(),
      markdownRestaurant: `
# Exporting data (Restaurant and Founding Partner)

## Full CSV exports

Admins open **Reports** (\`/dashboard/reports\`, **Overview** tab) and use **Export your data** at the bottom:

- **Export all bookings** → \`/api/venue/export?type=bookings\`.
- **Export all guest records** → \`/api/venue/export?type=guests\`.

These files cover the **entire** venue history available to the API, independent of the chart date picker.

## Chart CSVs

Sections such as booking summary, no shows, cancellations, deposit summary, and **Table utilisation** (only when table management data exists) each include **Download CSV** for the applied range.

## Imports

Use **Settings → Data import** for CSV imports; download the provided session report afterwards if you need proof of what changed.

## Governance

Restaurant exports can include high value guest data. Limit distribution to managers only.
`.trim(),
    },
  ],
};
