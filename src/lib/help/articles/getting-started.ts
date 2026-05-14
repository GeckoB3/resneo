import type { HelpCategory } from '../types';
import { RESERVENI_MARKETING_PAYMENTS_AND_NO_HOLD } from '@/lib/booking-funds-copy';

export const gettingStartedCategory: HelpCategory = {
  slug: 'getting-started',
  title: 'Getting started',
  description:
    'From first login to a confident guest flow: Home, Settings, Stripe, your public page, and the setup checklist, explained in plain language.',
  plan: 'all',
  articles: [
    {
      slug: 'welcome',
      helpSection: 'gs-start-here',
      title: 'Welcome to ReserveNI',
      description:
        'What ReserveNI does, how the dashboard differs from your public booking page, and where to read next after you pick a topic on the help home.',
      tags: ['overview', 'basics', 'onboarding', 'plans'],
      content: `
# Welcome to ReserveNI

You are in the right place. ReserveNI helps **independent venues in Northern Ireland** take bookings, stay in touch with guests, and, if you choose, collect **card payments** through **Stripe Connect**. You run day to day work from the **dashboard**. Guests use your **public booking page** at \`/book/...\`, and you can optionally embed the flow on your own site.

> **Quick mental model:** the dashboard is for you and your team. The \`/book/...\` page is for guests. They never see your staff tools.

## What you can do here

| Area | What it gives you |
| --- | --- |
| **Bookings** | Table reservations, appointments, classes, events, or resources, depending on your **plan** and which **booking models** you turned on. |
| **Guest experience** | Branded public page, optional iframe embed, automated **email** and **SMS** (templates under **Settings → Communications**). |
| **Payments** | Deposits and full payments online via **Stripe Connect**. ${RESERVENI_MARKETING_PAYMENTS_AND_NO_HOLD} |
| **Insight** | **Reports** (admins) and **Contacts** for guest history, plus **Data import** (admins) when you move data in from a spreadsheet. |

## Plans (high level)

Your **product plan** (Restaurant / Founding Partner versus Appointments Light, Plus, or Pro) decides which tools appear and how software billing works. That is **separate** from **Stripe Connect**, which only covers money moving from guests to **your** Stripe connected account.

- **Restaurant / Founding Partner** venues get the dining toolkit: **Dining Availability**, **Day Sheet**, **Bookings**, and, when enabled, **table management** (**Table Grid**, **Floor Plan**). Detail lives under [Restaurant plan](/help/restaurant/overview).
- **Appointments** plans centre on **calendars**, **services**, and related models (**Classes**, **Events**, **Resources**). **Light** and **Plus** cap calendars and team logins. Detail lives under [Appointments plan](/help/appointments/overview).

## Your first session (about 15 minutes)

1. Sign in and open **Home** (\`/dashboard\`). Admins usually see a **setup checklist** card with the next concrete tasks.
2. Read [Your dashboard at a glance](/help/getting-started/dashboard-overview) so the sidebar matches what you see in the app.
3. As an **admin**, open **Settings** (\`/dashboard/settings\`) and work through **Profile**, **Business hours**, and **Payments** when you need them.
4. When you are ready for guests, read [Your public booking page](/help/getting-started/public-booking-page) and [Completing your setup checklist](/help/getting-started/setup-checklist).

## When something does not look right

- [Troubleshooting](/help/troubleshooting) for common fixes on access, Stripe, imports, and availability.
- **Support** in the dashboard sidebar footer to message the ReserveNI team from inside the app.

## Common questions

**Do I need Stripe on day one?**  
Only if you want guests to pay **online** (deposit or full payment) before confirmation. You can still take **phone** bookings and handle payment outside ReserveNI. Connect Stripe before you turn on online payment rules in your catalogue.

**Who can change venue-wide settings?**  
**Admins** see full **Settings** (Profile, Business hours, Plan, Payments, Communications, Staff, Data import). **Staff** see **Account** at the same URL for their own name, email, phone, and password, not the whole venue.

**Where did the old “Widget” menu go?**  
Embeds and QR now live on **Settings → Profile** in **Booking widget & QR code** (old \`/dashboard/settings/widget\` URLs redirect there).
`.trim(),
      markdownRestaurant: `
# Welcome to ReserveNI

You are on a **Restaurant** or **Founding Partner** plan. ReserveNI helps you run **table reservations**, guest messaging, and optional **card payments** through **Stripe Connect**, from the **dashboard** through to your public \`/book/...\` page and optional **website embed**.

> **Quick mental model:** the dashboard is for your team. Guests never log into it.

## What you can do on this plan

| Area | What it gives you |
| --- | --- |
| **Dining and tables** | **Dining Availability** (admins), **Day Sheet**, **Bookings**, **Waitlist** when you use table reservations, and optional **Table Grid** and **Floor Plan** when **table management** is enabled. |
| **Schedule add-ons** | If you enable **classes**, **events**, **resources**, or **unified scheduling**, you also get **Calendar Availability**, **Appointment Calendar**, and catalogue links such as **Services**, **Events**, **Classes**, and **Resources** after **Contacts**. The sidebar matches what the product turned on for your venue. |
| **Guest experience** | Public page, embed, **email** and **SMS** templates under **Settings → Communications**. |
| **Payments** | Guest charges through **Stripe Connect**. ${RESERVENI_MARKETING_PAYMENTS_AND_NO_HOLD} |
| **Insight** | **Reports** (admins), **Contacts**, **Data import** (admins). |

## Billing you need to know

**Settings → Plan** is your **ReserveNI subscription** (the software). **Settings → Payments** is **Stripe Connect** for guest cards. They bill and renew on different rails. Fix Plan issues first if banners say subscription or public booking paused.

## First working session

1. Open **Home** and clear the **setup checklist** rows (admins).
2. Read [Your dashboard at a glance](/help/getting-started/dashboard-overview) for **Day Sheet**, **Bookings**, and any **Appointment Calendar** link your venue shows.
3. Finish **Settings → Profile**, **Business hours**, and **Payments** as needed.
4. Open [Your public booking page](/help/getting-started/public-booking-page), then [Completing your setup checklist](/help/getting-started/setup-checklist).

## Where the deep guides live

- [Restaurant plan](/help/restaurant/overview) for dining, areas, and table operations.
- If your sidebar includes schedule tools, use the **Schedule and other booking types** section in this help centre for the same articles that Appointments venues use for calendars and catalogues.

## Support

[Troubleshooting](/help/troubleshooting) and **Support** in the sidebar footer.
`.trim(),
      markdownAppointments: `
# Welcome to ReserveNI

You are on an **Appointments** plan (**Light**, **Plus**, or **Pro**). ReserveNI is built around **bookable calendars**, **services** (and related catalogues), **availability**, and guest messaging, with optional **Stripe Connect** for deposits and online payment. You work in the **dashboard**; guests book on your **public booking page** and, if you use it, an **embed** on your website.

> **Quick mental model:** staff tools live under \`/dashboard\`. Guest booking lives at \`/book/your-slug\` (and \`/embed/your-slug\` inside an iframe).

## What you can do on this plan

| Area | What it gives you |
| --- | --- |
| **Scheduling** | **Calendar Availability** for calendars, weekly templates, breaks, and closures. **Appointment Calendar** (or **Day Sheet** when the app shows that layout for your booking model) for the live grid. |
| **Catalogue** | **Services** for appointment lines, plus **Classes**, **Events**, or **Resources** when those **booking models** are enabled under **Settings → Profile**. |
| **Operations** | **Bookings** or **Appointments** list (the label changes when you mix models), **New Booking** or **New Appointment**, and **Contacts**. |
| **Guest comms** | **Settings → Communications** for email and SMS templates and policies. |
| **Payments** | **Stripe Connect** under **Settings → Payments** for guest cards. ${RESERVENI_MARKETING_PAYMENTS_AND_NO_HOLD} |
| **Insight** | **Reports** (admins), **Contacts**, **Data import** (admins). |

## Tiers in one place

**Appointments Light** is built for a single calendar column and a single team login, with SMS charged per message (see **Settings → Plan** for the current rate). **Appointments Plus** raises calendar and team caps and includes a monthly SMS bundle. **Appointments Pro** (the tier stored as \`appointments\` in billing) removes those calendar and team caps for normal Pro use and includes a larger SMS bundle. Exact numbers, caps, and SMS wording always come from **Settings → Plan** in your venue, not from help text alone.

## First working session

1. Open **Home** and work through the **setup checklist** (admins).
2. Read [Your dashboard at a glance](/help/getting-started/dashboard-overview) so **Calendar Availability**, lists, and calendar links match what you see.
3. Under **Settings → Profile**, confirm **Booking models**, public fields, and **Booking widget & QR code**.
4. Connect **Stripe** under **Settings → Payments** if you sell online, then walk [Your public booking page](/help/getting-started/public-booking-page) and [Completing your setup checklist](/help/getting-started/setup-checklist).

## Where to go deeper

Everything about calendars, services, deposits, comms, and imports for this product line lives in **[Appointments plan](/help/appointments/overview)** and linked articles there.

## Support

[Troubleshooting](/help/troubleshooting) and **Support** in the sidebar footer.
`.trim(),
    },
    {
      slug: 'dashboard-overview',
      helpSection: 'gs-know-the-app',
      title: 'Your dashboard at a glance',
      description:
        'Home, sidebar links, admin versus staff, how list labels change, Support, and your public booking link.',
      tags: ['dashboard', 'navigation', 'roles', 'home'],
      content: `
# Your dashboard at a glance

Think of the dashboard as your **control room**: today’s work, shortcuts to create bookings, and links to every tool your role is allowed to use.

## Home

**Home** is \`/dashboard\`. It surfaces what matters **today**: upcoming bookings, useful alerts, and, for **venue admins**, a **setup checklist** card that tracks profile, availability, Stripe Connect, and a first test booking.

> **Staff note:** you have the same **Home** experience for operational work, but you will **not** see the setup checklist. That card is **admin-only**.

## The left sidebar

Links depend on your **role**, **plan**, **booking model**, and which extra models are enabled. Every venue gets **Home**. Most get **Bookings** and **New Booking** (or appointment style labels; see below). **Contacts** lists guests.

**Admin-only** items (hidden from staff):

- **Dining Availability** (\`/dashboard/availability\`) when you run restaurant style dining on a Restaurant or Founding tier with table reservations.
- **Reports** (\`/dashboard/reports\`).
- **Settings** for admins versus **Account** for staff (same route \`/dashboard/settings\`).

**Conditional tools**

- **Waitlist** when the venue uses **table reservations** in the model the app loaded.
- **Calendar Availability** (\`/dashboard/calendar-availability\`) when the venue needs calendar and availability settings for schedule backed models (the app decides from your plan and models).
- **Day Sheet** and/or **Appointment Calendar** next to **Bookings** depending on restaurant table primary layouts versus schedule calendar eligibility.
- **Table Grid** and **Floor Plan** when **table management** is enabled on a Restaurant or Founding table venue.
- **Services**, **Classes**, **Events**, **Resources** after **Contacts** when those models are active.

## Why labels say **Appointments** or **Bookings**

On appointment style dashboards, the list reads **Appointments** when you only run schedule backed flows. If you also enable another booking style (for example tables alongside appointments), the labels become **Bookings** and **New Booking** so they match what guests do.

## Your Booking Page

With a venue **slug**, **Your Booking Page** opens \`/book/your-slug\` in a new tab from the sidebar.

## Support

**Support** at the bottom of the sidebar, plus [Troubleshooting](/help/troubleshooting).

## Where to go next

- [Setting up your business profile](/help/getting-started/business-profile)
- [Restaurant plan](/help/restaurant/overview) or [Appointments plan](/help/appointments/overview)
`.trim(),
      markdownRestaurant: `
# Your dashboard at a glance

This page assumes a **Restaurant** or **Founding Partner** table led setup. Your sidebar prioritises covers, sittings, and service rhythm.

## Home

**Home** (\`/dashboard\`) shows today’s operational picture. **Admins** also get the **setup checklist** for profile, dining configuration, Stripe, and a first test booking.

> **Staff:** no checklist card. Ask an admin if setup still blocks you.

## What Restaurant and Founding venues usually see

- **Day Sheet** and **Bookings** together when the app uses that pair for your venue (covers focused day view plus the list).
- **Dining Availability** for admins (sittings, capacity, areas).
- **Waitlist** when **table reservations** are part of your model.
- **Table Grid** and **Floor Plan** when **table management** is turned on.
- **New Booking** for staff created reservations.
- **Contacts** for guest records.

If you added **classes**, **events**, **resources**, or **unified scheduling**, you will also see **Calendar Availability**, **Appointment Calendar**, and the relevant catalogue links after **Contacts**, matching the live product.

## Admin-only and staff views

**Dining Availability** and **Reports** are **admin** links. **Settings** is the full venue console for admins. **Staff** see **Account** at \`/dashboard/settings\` for personal details and password only.

## Labels next to **Bookings**

If schedule backed models are on, the second link may read **Appointment Calendar** or **Day Sheet** depending on eligibility. Trust the label shown in your sidebar.

## Your Booking Page

**Your Booking Page** uses your public slug and opens the hosted guest experience.

## Support

Use **Support** after [Troubleshooting](/help/troubleshooting).

## Next

- [Setting up your business profile](/help/getting-started/business-profile)
- [Restaurant plan](/help/restaurant/overview)
`.trim(),
      markdownAppointments: `
# Your dashboard at a glance

This page is for **Appointments** plans (**Light**, **Plus**, **Pro**). Navigation centres on calendars, services, lists, and guest comms, not on Restaurant dining consoles.

## Home

**Home** (\`/dashboard\`) shows what matters today. **Admins** see the **setup checklist** for profile, availability, Stripe, catalogue gaps for enabled models, and a first test booking.

> **Staff:** you do not see the checklist.

## Core links you should expect

- **Calendar Availability** (\`/dashboard/calendar-availability\`) when your venue uses schedule settings (calendars, weekly hours, breaks, closures). It appears whenever the product’s rules say you need that screen, including some mixed model venues on other tiers. On standard Appointments tiers without dining admin tools, you will not see a separate **Dining Availability** item because that is part of the Restaurant and Founding table product surface.
- **Services** at \`/dashboard/appointment-services\` when appointments style services are in your model set.
- **Appointment Calendar** at \`/dashboard/calendar\` when your venue is **schedule calendar eligible**. If the product shows **Day Sheet** instead of **Appointment Calendar** next to **Bookings** for your booking model, use the in app label: both are staff scheduling views, not guest tools.
- **Bookings** list at \`/dashboard/bookings\` (or the label **Appointments** when only schedule backed models are active) plus **New Booking** or **New Appointment**.
- **Contacts** for guest history.
- **Classes**, **Events**, or **Resources** entries after **Contacts** when those models are enabled.

## Admin-only

**Reports** and full **Settings** are **admin** only. **Staff** use **Account** on the same route for their own profile.

## Your Booking Page

Once a **slug** exists, **Your Booking Page** opens your live \`/book/...\` page.

## Practitioner links

Some setups expose \`/book/{venue-slug}/{practitioner-slug}\` for a focused guest entry. Whether that appears depends on your venue configuration in the product.

## Support

**Support** in the sidebar footer, plus [Troubleshooting](/help/troubleshooting).

## Next

- [Setting up your business profile](/help/getting-started/business-profile)
- [Appointments plan](/help/appointments/overview)
`.trim(),
    },
    {
      slug: 'business-profile',
      helpSection: 'gs-configure-venue',
      title: 'Setting up your business profile',
      description:
        'Venue identity, slug, timezone, cover image, booking models, embed and QR, and where to go for hours and catalogue rules.',
      tags: ['settings', 'profile', 'venue', 'slug'],
      content: `
# Setting up your business profile

**Who can edit venue fields:** **admins** on **Settings → Profile** (\`/dashboard/settings?tab=profile\`). **Staff** manage only **Account** (personal details on the same route).

The **Profile** tab stacks several blocks in one scroll:

1. **Your account** on Appointments plans: display name, sign in email, phone, and password for **you**, not the whole venue.
2. **Venue profile and public details** guests see on \`/book/...\` and in messages.
3. **Booking models**, **Booking widget and QR code**, and restaurant only fields when your tier exposes them.

## Venue essentials

| Field | Why it matters |
| --- | --- |
| **Business name** | Shown to guests and used in templates. |
| **Address and contact channels** | Trust on the public page and in comms. |
| **Venue slug** | Builds \`/book/your-slug\`. **Changing it later breaks old links.** |
| **Timezone** | Defines “today”, reminders, and slot windows. Match where you trade. |
| **Cover image** and **logo** when shown | Branding on the public header. |

Most simple fields **save automatically**. If the checklist on **Home** lags, refresh after saving.

## Booking models (Appointments plans)

Under **Booking models** (sometimes titled around models on your public page), **admins** enable **Appointments and services**, **Classes**, **Ticketed events**, and **Resources**. Only turn on what you sell. Each switch usually adds sidebar entries and a public tab.

> After changes, open your public page once to confirm tabs.

## Booking widget and QR code

Scroll to **Booking widget and QR code** for the \`/embed/...\` iframe snippet, optional **accent** colour, **QR** download, and the **resize.js** helper (\`/embed/resize.js\`) so iframe height tracks each step.

## Restaurant only fields

On Restaurant and Founding tiers you may also edit **cuisine type**, **price band**, **kitchen email**, and **no show grace**. Align them with house policy.

## Where deeper rules live

- Tables, areas, dining availability: [Restaurant plan](/help/restaurant/overview) and **Dining Availability**.
- Opening hours and closures: **Settings → Business hours**.
- Calendars and services: [Appointments plan](/help/appointments/overview), **Calendar Availability**, **Services**.

## Next

- [Connecting Stripe to take payments](/help/getting-started/stripe-payments)
`.trim(),
      markdownRestaurant: `
# Setting up your business profile

**Who can edit:** **admins** on **Settings → Profile** (\`/dashboard/settings?tab=profile\`). **Staff** use **Account** for themselves only.

## What sits on **Profile**

1. **Personal account** block (name, email, phone, password) for the signed in user where the product shows it.
2. **Venue profile and public details** (name, address, channels, slug, imagery).
3. **Booking widget and QR code** for embed and poster links.
4. **Restaurant fields** such as **cuisine type**, **price band**, **kitchen email**, and **no show grace** on Restaurant and Founding tiers.

## Venue essentials

| Field | Why it matters |
| --- | --- |
| **Business name** | Guest facing and used in templates. |
| **Address and contact channels** | Public trust and comms routing. |
| **Venue slug** | \`/book/your-slug\`. **Changing it later breaks old links.** |
| **Timezone** | Operational “today” and reminders. |
| **Cover image** / **logo** | Public header branding. |

Simple fields **save automatically**.

## Booking models when you run add ons

If you enabled **classes**, **events**, **resources**, or **unified scheduling**, use **Booking models** to control which public tabs appear. Save, then check \`/book/...\`.

## Booking widget and QR code

Same section as other plans: iframe to \`/embed/your-slug\`, optional **accent**, **QR** for hosted \`/book/...\`, and **resize.js** in the snippet so the iframe grows with the flow.

## Where deeper rules live

- Dining and areas: [Restaurant plan](/help/restaurant/overview) and **Dining Availability**.
- Opening hours: **Settings → Business hours**.
- Schedule catalogues when enabled: articles under **Schedule and other booking types** in this help centre (same underlying guides as the Appointments category).

## Next

- [Connecting Stripe to take payments](/help/getting-started/stripe-payments)
`.trim(),
      markdownAppointments: `
# Setting up your business profile

**Who can edit venue wide fields:** **admins** on **Settings → Profile** (\`/dashboard/settings?tab=profile\`). **Staff** only open **Account** for their own login details.

## How the **Profile** tab is organised

1. **Your account** (display name, sign in email, phone, password) applies to **you**, not the venue record.
2. **Venue profile and public details** power \`/book/...\` and automated messages.
3. **Booking models** decides which experiences are on sale (**Appointments and services**, **Classes**, **Ticketed events**, **Resources**).
4. **Booking widget and QR code** holds the embed snippet, optional accent, QR, and **resize.js** line.

## Venue essentials

| Field | Why it matters |
| --- | --- |
| **Business name** | Guest facing copy and templates. |
| **Address and contact channels** | Public page and comms. |
| **Venue slug** | Public URL. **Changing it later breaks old links.** |
| **Timezone** | Slots, reminders, and “today” in lists. |
| **Cover image** / **logo** | Public header presentation. |

Most fields **save automatically**.

## Booking models

Turn on only what you operate. Each active model typically adds:

- Sidebar links such as **Services**, **Classes**, **Events**, or **Resources** after **Contacts**.
- A matching tab on the public page when the product exposes that surface.

After saving, visit your public page and confirm tabs and copy.

## Booking widget and QR code

- Copy the **iframe** pointing at \`/embed/{slug}\`.
- Optional \`?accent=RRGGBB\` (no \`#\`) and \`?tab=\` values as documented in [Your public booking page](/help/getting-started/public-booking-page).
- Include **resize.js** from the snippet so height tracks each step.

## Business hours

Venue wide weekly hours and opening exceptions live under **Settings → Business hours**, not on **Profile**.

## Where to read more

- [Appointments plan](/help/appointments/overview) for calendars, services, deposits, comms, and imports.

## Next

- [Connecting Stripe to take payments](/help/getting-started/stripe-payments)
`.trim(),
    },
    {
      slug: 'stripe-payments',
      helpSection: 'gs-configure-venue',
      title: 'Connecting Stripe to take payments',
      description:
        'Plan tab versus Payments tab, Stripe Connect for guests, who can complete onboarding, and what “ready” means.',
      tags: ['stripe', 'payments', 'deposits', 'connect'],
      content: `
# Connecting Stripe to take payments

Two different Stripe relationships exist. Treat them separately:

| | **Settings → Plan** | **Settings → Payments** |
| --- | --- | --- |
| **What it pays for** | Your **ReserveNI subscription** (the software). | **Nothing to ReserveNI** for guest cards. Guest charges use **Stripe Connect**. |
| **Money goes to** | ReserveNI as the SaaS vendor. | **Your** connected Stripe account, then bank payouts per Stripe rules. |
| **Who sets it up** | Venue **admin**. | Venue **admin** (staff are prompted to ask an admin). |

${RESERVENI_MARKETING_PAYMENTS_AND_NO_HOLD}

## Stripe Connect (guest payments)

1. Sign in as an **admin**.
2. Open **Settings → Payments** (\`/dashboard/settings?tab=payments\`).
3. Complete Stripe onboarding (business details, bank account, any identity checks Stripe requests).

The app marks Connect **ready** when Stripe reports **charges enabled** and **details submitted**. Until then, catalogue rules that require online payment can block guest checkout even if everything else looks fine.

### Practical tips

- Use a **business** Stripe account for the legal entity that should receive guest money.
- If Stripe shows **restricted** or **pending** tasks, open the **Stripe Dashboard** from in app links and finish them.
- After Connect works, set **payment requirements** on each catalogue line you use (services, classes, events, resources, or dining rules on Restaurant plans).

## ReserveNI subscription (**Plan** tab)

**Settings → Plan** (\`?tab=plan\`) covers upgrades, SMS allowances on appointment tiers, cancellation state, and the card on file for **ReserveNI itself**. If software billing fails, banners on **Home** or **Settings** explain what paused. Fix **Plan** issues separately from Connect.

## Setup checklist

**Home** includes a **Stripe payments** row linking to **Payments**. Use it even if you think Connect is already done.

## Related reading

- [Settings overview](/help/settings/overview)
- [Troubleshooting for Stripe](/help/troubleshooting/stripe-issues)
`.trim(),
      markdownRestaurant: `
# Connecting Stripe to take payments

## Two Stripe relationships

| | **Settings → Plan** | **Settings → Payments** |
| --- | --- | --- |
| **Purpose** | **ReserveNI** software subscription. | **Stripe Connect** for guest card charges. |
| **Payout** | SaaS billing to ReserveNI. | Guest money to **your** connected account. |
| **Who** | **Admin**. | **Admin**. |

${RESERVENI_MARKETING_PAYMENTS_AND_NO_HOLD}

## Connect for guest cards

1. **Admin** opens **Settings → Payments** (\`/dashboard/settings?tab=payments\`).
2. Finish Stripe onboarding until the app shows Connect as **ready** (**charges enabled**, **details submitted**).

Without that, online deposits or full payment rules on dining or catalogue rows can fail at checkout.

Tips: use the correct legal entity, resolve **restricted** states in the Stripe Dashboard, then wire **payment requirements** in your dining and table rules ([Restaurant plan](/help/restaurant/overview)) and on any schedule catalogue you also run.

## Software subscription

**Settings → Plan** manages your **ReserveNI** invoice, plan tier, and payment method. Public booking pauses from subscription state are explained in product banners, not by Connect alone.

## Checklist shortcut

**Home** links to **Payments** from the checklist row.

## Related

- [Settings overview](/help/settings/overview)
- [Troubleshooting for Stripe](/help/troubleshooting/stripe-issues)
`.trim(),
      markdownAppointments: `
# Connecting Stripe to take payments

## Two separate flows

| | **Settings → Plan** | **Settings → Payments** |
| --- | --- | --- |
| **Purpose** | **ReserveNI** subscription (Light, Plus, or Pro software). | **Stripe Connect** for guest card charges. |
| **Money** | Software invoice. | Guest payments to **your** connected account. |
| **Who** | **Admin**. | **Admin**. |

${RESERVENI_MARKETING_PAYMENTS_AND_NO_HOLD}

## Stripe Connect

1. Sign in as **admin**.
2. Open **Settings → Payments** (\`/dashboard/settings?tab=payments\`).
3. Complete Stripe’s onboarding until **charges enabled** and **details submitted** are true in Stripe.

Until Connect is ready, guests cannot finish online payment for rules that require a card, even if services and calendars look fine.

### Tips

- Match the Connect account to the legal entity that should receive guest funds.
- Clear **restricted** or **pending** tasks in the Stripe Dashboard using the in app links.
- After Connect is healthy, set **payment requirements** on each **service**, **class type**, **event**, or **resource** row that should charge online. Step by step detail lives in **[Deposits and payments](/help/appointments/deposits)** under the Appointments help category.

## Plan tab and SMS

**Settings → Plan** shows tier, SMS allowance on Plus and Pro, Light pay as you go SMS rules, upgrades, and subscription status. That billing is unrelated to guest Connect charges.

## Setup checklist

The **Home** checklist **Stripe payments** button jumps to **Payments**.

## Related

- [Settings overview](/help/settings/overview)
- [Troubleshooting for Stripe](/help/troubleshooting/stripe-issues)
`.trim(),
    },
    {
      slug: 'public-booking-page',
      helpSection: 'gs-open-the-doors',
      title: 'Your public booking page and embed',
      description:
        'Hosted \`/book\` URLs, optional practitioner paths, guest pause messaging, embed parameters, resize.js, and how widget source appears in reporting.',
      tags: ['public', 'embed', 'widget', 'qr', 'guests'],
      content: `
# Your public booking page and embed

Guests never use the dashboard. They book through:

| Surface | URL | Typical use |
| --- | --- | --- |
| **Hosted page** | \`/book/{venue-slug}\` | Social bios, Google Business, QR, “Book now”. |
| **Practitioner page** (when supported) | \`/book/{venue-slug}/{practitioner-slug}\` | Deep link to one calendar column. |
| **Embed** | \`/embed/{venue-slug}\` | iframe on your site, plus \`/embed/resize.js\` for height. |

## What guests see

Branding from **Settings → Profile**, **tabs** when multiple booking models are on, and **Stripe hosted** card fields when your rules require payment. ReserveNI never asks you to build custom card fields.

### When booking is paused

Guests see **Online booking unavailable** and are asked to **contact you directly** (no hidden slots).

## Embed parameters

From **Settings → Profile → Booking widget and QR code**:

- \`?accent=RRGGBB\` without \`#\`.
- \`?tab=appointments\`, \`tables\`, \`events\`, \`classes\`, or \`resources\` when that model is enabled.

Always include **resize.js** from the snippet.

## QR

QR defaults to the **hosted** \`/book/...\` page for print. If you point QR at \`/embed/...\`, test on phones.

## Source in **Reports**

Embed traffic can record **widget** as a source where the product supports that attribution.

## Dining areas (tables)

Multiple dining areas and guest facing area choice are configured in dining tools, not on this help page alone. See [Restaurant plan](/help/restaurant/overview).

## Next

- [Completing your setup checklist](/help/getting-started/setup-checklist)
`.trim(),
      markdownRestaurant: `
# Your public booking page and embed

Guests use \`/book/{venue-slug}\`, optional \`/book/{venue-slug}/{practitioner-slug}\` when your setup exposes it, and \`/embed/{venue-slug}\` inside your site with \`/embed/resize.js\`.

## Guest experience

Public branding from **Settings → Profile**, model **tabs** when more than one surface is on, and **Stripe hosted** checkout when rules require payment.

Paused venues show **Online booking unavailable** and ask guests to phone or message you.

## Widget section on **Profile**

Copy the iframe, optional **accent** query, **tab** query for each model, and the **resize** script so the iframe height tracks steps.

## QR

Defaults to hosted \`/book/...\` for posters.

## Dining areas

Multiple areas and whether guests pick an area are part of dining configuration. See [Restaurant plan](/help/restaurant/overview).

## Source

Widget completions can appear as **widget** source in **Reports** where supported.

## Next

- [Completing your setup checklist](/help/getting-started/setup-checklist)
`.trim(),
      markdownAppointments: `
# Your public booking page and embed

## URLs guests use

| Surface | URL | Notes |
| --- | --- | --- |
| **Hosted booking** | \`/book/{venue-slug}\` | Main guest entry. |
| **Practitioner landing** | \`/book/{venue-slug}/{practitioner-slug}\` | When your venue exposes a practitioner or column slug for direct entry. |
| **Embed** | \`/embed/{venue-slug}\` | iframe on your site. |

## What they see

Cover and logo from **Profile**, **tabs** driven by **Booking models**, and **Stripe** card collection when your catalogue rules require payment online.

If the venue is **booking paused**, guests see **Online booking unavailable** and instructions to contact you, not a broken slot picker.

## Snippet and parameters

All controls live under **Settings → Profile → Booking widget and QR code**.

- iframe \`src\` to \`/embed/{slug}\`.
- \`?accent=RRGGBB\` (no hash) to tint chrome.
- \`?tab=appointments\`, \`events\`, \`classes\`, or \`resources\` to open on a tab that exists for your venue. Use the exact values the settings page lists for your setup.

## resize.js

Paste the **resize.js** line from settings (\`/embed/resize.js\` on your site origin). Without it, embeds often clip or double scroll inside CMS templates.

## QR codes

Download QR for marketing. It targets the **hosted** page so phones get the full responsive layout.

## Reporting

Bookings that start in the embed can record **widget** as their source in **Reports**, which helps compare channels.

## Next

- [Completing your setup checklist](/help/getting-started/setup-checklist)
- [Appointments plan](/help/appointments/overview) for model specific public behaviour
`.trim(),
    },
    {
      slug: 'setup-checklist',
      helpSection: 'gs-open-the-doors',
      title: 'Completing your setup checklist',
      description:
        'How the Home card works, what each step checks, dismiss and auto complete behaviour, and what to do when a row will not clear.',
      tags: ['checklist', 'onboarding', 'home', 'admin'],
      content: `
# Completing your setup checklist

**Admins** see a **Setup** card on **Home** (\`/dashboard\`). Titles read **Get your venue ready** while onboarding is incomplete, then **What’s next** when onboarding is done but something still needs attention. Each row explains why it matters and links to the right screen.

> **Staff:** the card is hidden for you. Ask an admin.

## What rows can represent

| Step (labels vary) | Done when |
| --- | --- |
| **Business profile** | Venue **name**, **address**, and **phone** are present. |
| **Availability** | Depends on booking model: onboarding wizard for some table first paths, **calendars and services** for unified or practitioner paths, or model specific hubs (events, classes, resources) when those models are enabled. |
| **Public booking page** | Guest booking can succeed (rules, services, calendars, Connect where needed). |
| **Stripe payments** | Connect is **ready** in Stripe, not half started. Opens \`/dashboard/settings?tab=payments\`. |
| **First test booking** | Encourages a trial; button opens **New booking** (\`/dashboard/bookings/new\`). |

Copy on each row comes from the same server rules as **Home**, so trust the live text.

## Progress, dismiss, auto hide

- Percent pill shows completion.
- **Dismiss** (X) hides the card and **persists** for your staff profile.
- When every step is complete, the card hides on its own and records dismissal.

## If a step will not clear

Use the row button, fix the underlying screen, return to **Home**, refresh if needed, then try [Troubleshooting](/help/troubleshooting) or **Support**.

## After go live

Templates, exports, and training sit in the wider help centre, including **Communications** and **Reports**.

## Related

- [Your dashboard at a glance](/help/getting-started/dashboard-overview)
- [Appointments plan](/help/appointments/overview)
- [Restaurant plan](/help/restaurant/overview)
`.trim(),
      markdownRestaurant: `
# Completing your setup checklist

**Admins** only: **Home** shows **Get your venue ready** or **What’s next** with rows wired to your venue’s booking model.

## Typical Restaurant and Founding rows

- **Business profile** (name, address, phone).
- **Services and availability** via onboarding or **Dining Availability** and related tools until guests can book tables.
- **Public booking page** readiness once rules, services, and Stripe (if used) line up.
- Optional **Events**, **Classes**, or **Resources** rows when those models are enabled and need a starter catalogue.
- **Stripe payments** through **Settings → Payments**.
- **First test booking** via **New booking**.

Row labels and descriptions match the live product for your venue.

## Dismiss and completion

**Dismiss** saves to your staff record. All green hides the card automatically.

## Stuck steps

Follow the row link, fix data, reload **Home**, then use [Troubleshooting](/help/troubleshooting) or **Support**.

## After launch

Tune **Communications**, run **Reports**, train staff on **Day Sheet** versus **Bookings** as your layout requires.

## Related

- [Restaurant plan](/help/restaurant/overview)
- [Your dashboard at a glance](/help/getting-started/dashboard-overview)
`.trim(),
      markdownAppointments: `
# Completing your setup checklist

**Admins** see the **Setup** card on **Home**. Titles are **Get your venue ready** until onboarding completes, then **What’s next** while anything remains.

> **Staff:** you will not see this card.

## What the product checks (Appointments plans)

Exact labels vary, but expect combinations of:

1. **Business profile** with name, address, and phone.
2. **Team and services** or **Services and calendars** style rows pointing at **Calendar Availability** and **Appointment Services** until calendars exist and services attach where required.
3. **Public booking page** until at least one active service is linked so online guests can see slots.
4. **Events**, **Classes**, or **Resources** rows when those models are enabled and still need a starter catalogue.
5. **Stripe payments** until Connect reaches **charges enabled** with **details submitted** if you sell online.
6. **First test booking** encouraging \`/dashboard/bookings/new\`.

The strings on the card are generated from the same **setup status** payload the dashboard uses, so read them literally.

## Dismiss and auto hide

**Dismiss** persists per staff member. Finishing every step hides the card without an extra click.

## If a row repeats

1. Click the suggested route (for example **Appointment services** or **Calendar Availability**).
2. Fix missing links, hours, or Stripe tasks.
3. Return to **Home** and wait a moment for status to refresh.

## After you are live

Polish **Communications**, use **Reports**, and keep staff aligned on **Bookings** list versus **Appointment Calendar** for day control.

## Related (Appointments help)

- [Appointments plan](/help/appointments/overview)
- [Your dashboard at a glance](/help/getting-started/dashboard-overview)
`.trim(),
    },
  ],
};
