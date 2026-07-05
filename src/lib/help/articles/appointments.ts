import type { HelpCategory } from '../types';
import { SMS_INCLUDED_APPOINTMENTS, SMS_INCLUDED_LIGHT, SMS_INCLUDED_PLUS } from '@/lib/billing/sms-allowance';
import {
  APPOINTMENTS_LIGHT_PRICE,
  APPOINTMENTS_PLUS_PRICE,
  APPOINTMENTS_PRO_PRICE,
  SMS_OVERAGE_GBP_PER_MESSAGE,
} from '@/lib/pricing-constants';

export const appointmentsCategory: HelpCategory = {
  slug: 'appointments',
  title: 'Appointments plan',
  description:
    'Everything you need for Appointments Light, Plus, and Pro: calendars, services, availability, the appointment calendar, classes, events, resources, team access, payments, communications, reports, import, and your public booking experience.',
  plan: 'appointments',
  articles: [
    {
      slug: 'overview',
      helpSection: 'plans',
      title: 'Appointments Light, Plus, and Pro',
      description:
        'How unified scheduling fits together, what each tier includes, how the sidebar labels change, and where to manage your subscription.',
      tags: ['plans', 'tiers', 'sms', 'navigation', 'limits'],
      content: `
# Welcome to your Appointments plan

You run **unified scheduling**: one place to manage **bookable calendars** (often one column per person or room), your **service catalogue**, **availability**, and—when you turn them on—**classes**, **ticketed events**, and **bookable resources**. The articles below walk you through each area in plain language.

**What this covers:** how tiers differ, how the left menu adapts to your venue, and where to turn booking models on or off.

:::help-figure tier-compare

## Compare the three tiers

| | **Light** | **Plus** | **Pro** |
| --- | --- | --- | --- |
| **Monthly price (guide)** | From £${APPOINTMENTS_LIGHT_PRICE}/month | £${APPOINTMENTS_PLUS_PRICE}/month | £${APPOINTMENTS_PRO_PRICE}/month |
| **Bookable calendars** | 1 | Up to 5 | Unlimited |
| **Team logins** | 1 | Up to 5 | Unlimited |
| **SMS bundle** | **${SMS_INCLUDED_LIGHT}** included per month | **${SMS_INCLUDED_PLUS}** included per month | **${SMS_INCLUDED_APPOINTMENTS}** included per month |
| **After your SMS bundle** | Overage billed at about **${Math.round(SMS_OVERAGE_GBP_PER_MESSAGE * 100)}p** per message | Same overage rate | Same overage rate |

Exact prices and SMS wording appear in **Settings → Plan**. If **Add calendar** or **invite staff** disappears, you have reached your tier cap—either deactivate something you no longer need or upgrade.

## What “unified scheduling” means day to day

- **Calendar Availability** is where admins build **calendars** and everyone sets **weekly hours**, **breaks**, and **days off**.
- **Services** holds your appointment catalogue (durations, buffers, deposits, optional **variants** such as “45 min / 60 min”).
- **Appointment Calendar** is the live grid for moving and opening bookings when your venue is calendar-eligible.
- **Appointments** (or **Bookings**) is the high-volume list: filters, search, export, bulk messaging.

If you also enable **classes**, **events**, or **resources**, guests see matching tabs on your public page and you get matching items in the sidebar **below Contacts**.

## Sidebar labels that change with your setup

:::help-figure sidebar-appointments

- On **Appointments-style** venues with **only** schedule-backed models (no extra “Bookings” mix), the list link reads **Appointments** and the action reads **New Appointment**. As soon as you enable additional booking types (for example tables plus appointments), those labels become **Bookings** and **New Booking** so the menu stays accurate.
- **Reports** and full **Settings** (venue-wide) are **admin only**. Staff still see **Account** for their own profile and password.

## Turning booking types on or off

Admins: open **Settings → Profile** and find **Booking models** (which booking types appear on your public page and in the sidebar). Enable only what you sell (**Appointments & services**, **Classes**, **Ticketed events**, **Resources**). Save, then check the sidebar and public tabs—you can come back any time you launch a new line of business.

:::help-figure booking-models

## A sensible setup order

1. Turn on only the booking models you are ready to sell.
2. Create or check the **calendars** those models will use.
3. Add the matching catalogue items: services, class types, events, or resources.
4. Test your public booking page as a guest before sharing the link.

## Where to go next

- New venue checklist: [Getting started](/help/getting-started/setup-checklist)
- Stripe, sessions, and venue profile: [Settings](/help/settings/overview)
- When something looks wrong: [Troubleshooting](/help/troubleshooting/access-issues)
`.trim(),
    },
    {
      slug: 'calendar-setup',
      helpSection: 'setup',
      title: 'Creating and assigning bookable calendars',
      description:
        'Use the Calendars tab to add columns, assign services and other models, respect plan limits, and understand what staff see first.',
      tags: ['calendars', 'columns', 'entitlements', 'admin'],
      content: `
# Bookable calendars (your columns)

**Who can do this:** admins manage the full **Calendars** matrix; staff usually work from **Availability** for their own hours (see [Working hours](/help/appointments/working-hours)).

**What this covers:** adding a calendar, linking services (and optional class, event, or resource rows), and staying within your plan limits.

:::help-figure availability-tabs

## Open the right screen

1. Sign in as an **admin**.
2. Go to **Calendar Availability** (\`/dashboard/calendar-availability\`).
3. Start on the **Calendars** tab.

## What each calendar represents

Each active calendar becomes a **column** on the **Appointment Calendar** and a **who / where** dimension for online booking. Typical patterns:

- One calendar per practitioner.
- One calendar per room or chair bank.
- A blend of people and rooms—whatever matches how you operate.

:::help-figure calendar-columns

## Assign what can be booked

Still on **Calendars**, attach:

- **Appointment services** guests can pick online or staff can pick on the phone.
- **Class types**, **experience events**, or **resources** when those models are enabled—so generated sessions inherit the correct column.

If something should not appear online yet, fix it here before publishing changes.

## Plan limits and entitlements

**Light** allows **one** active calendar; **Plus** allows **up to five**; **Pro** is effectively **unlimited**. The product enforces this when you click **Add calendar**. If the button is disabled:

- Deactivate a calendar you no longer sell, **or**
- Upgrade under **Settings → Plan**.

## Naming, order, and housekeeping

Give calendars clear names (guests may infer who they are visiting). Admins can drag the **grip** on each calendar row to change the left-to-right order on the staff calendar; on smaller screens use the move buttons. Deactivate instead of deleting when you need history to stay intact.

Each calendar row can also show:

- A **plan pill** such as **3 / 5 on plan** or **Unlimited calendars**.
- Assigned **Services**, **Classes**, **Resources**, and **Events**.
- A public calendar link when the calendar has its own slug.
- Configuration alerts if resources share a column in a way that could create conflicts.

## Staff experience

Linked staff members may open **Calendar Availability** directly on **Availability** for their own template. They cannot add venue-wide calendars unless they are admins—if someone is blocked, promote them or perform the change yourself.
`.trim(),
    },
    {
      slug: 'services',
      helpSection: 'setup',
      title: 'Building your appointment service catalogue',
      description:
        'Durations, buffers, variants, deposits, booking windows, custom availability, staff overrides, and Stripe readiness.',
      tags: ['services', 'catalogue', 'stripe', 'variants'],
      content: `
# Appointment services

Open **Services** (\`/dashboard/appointment-services\`). This catalogue powers the public flow, staff bookings, and reporting.

**What this covers:** the main fields on each service, how variants work, when overrides help, and how Stripe Connect fits in.

:::help-figure service-row

## Core fields everyone should set

- **Name & description** – guest-facing clarity beats clever marketing jargon.
- **Duration** – drives slot length on the calendar.
- **Buffer / processing** – quiet time before or after the appointment so you are not double-booked back-to-back.
- **Price & deposits** – optional; pair with **payment requirement** (none, deposit, or full payment online).
- **Colour** – helps teams scan the calendar quickly.
- **Active** – toggles visibility without deleting history.
- **Sort order** – controls the order guests see in long lists.

## Booking windows (per service)

Fine-tune **how far ahead** guests may book, **minimum notice**, **cancellation notice**, and whether **same-day** bookings are allowed. Heavy services can require more notice than quick add-ons—set each service the way you run the diary in real life.

## Variants (sub-options)

When a service offers multiple lengths or styles (for example “Cut & blow dry” vs “Cut only”), add **variants**. Guests must pick a variant before times appear, which keeps availability accurate.

## Link services to calendars

After saving the service, make sure it is offered on the right calendars. Admins can link a service to any active team calendar; staff can only link or adjust services on calendars they manage. On the service card, linked calendars appear as small pills so you can quickly see who offers the service.

## Custom availability

Use the **custom availability** editor when a service is only offered on certain days or windows that do not match your usual template. The calendar will honour those exceptions after you save.

## Staff overrides

Allow selected team members to advertise their own duration, price, or description. When two sources disagree, the app walks you through an **override** modal so you know which values guests will see.

## Stripe Connect

Online payments require a completed **Stripe Connect** onboarding (**Settings → Payments**). If Connect is incomplete, the product warns you when a service expects card payments—finish Connect before promoting those services online.

## Hygiene tips

- Start with a small set of live services; duplicate rows when you add seasonal menus.
- Align cancellation copy with what you promise in **Communications** templates (see [Communications](/help/appointments/communications)).
`.trim(),
    },
    {
      slug: 'working-hours',
      helpSection: 'setup',
      title: 'Working hours, breaks, and closures',
      description:
        'Use Calendar Availability tabs for weekly templates, breaks, and days off, alongside venue-wide business hours and opening exceptions.',
      tags: ['hours', 'breaks', 'closures', 'venue'],
      content: `
# Keep availability trustworthy

Guests only see slots when **three layers** agree: the venue is open, the calendar is working, and the specific service rules allow the time.

**What this covers:** what each **Calendar Availability** tab does for guests, and how **Settings → Business hours** sets the venue-wide frame.

:::help-figure availability-tabs

## Calendars tab (context)

You already create calendars here. Hours you set on other tabs apply **per calendar**, so each practitioner or room can differ.

## Availability tab

Build **weekly templates** with open and close times. This is the baseline grid the appointment engine uses before breaks or days off.

Tips:

- Align calendar hours with what you advertise publicly unless you intentionally allow wider practitioner hours.
- When a staff member works fewer days, remove those weekdays rather than leaving zero-length rows.

## Breaks tab

Add recurring **break patterns** (lunch, tidy-up blocks, handovers). Online booking respects these automatically.

## Days off / closures

Mark **leave** or one-off closures per calendar. Combine with **Closures** on the venue **Business hours** card when the whole site shuts (see [Settings](/help/settings/overview)).

## Venue-wide context

Under **Settings → Business hours** you set the venue’s advertised opening footprint and **opening exceptions** (bank holidays, private hires). Calendar templates should usually sit **inside** those windows so guests are never offered impossible times.

## After you save

Give the public booking page a quick try whenever you change hours—small mistakes (AM/PM, timezone) are easier to catch before guests do.

## Roles

Any staff linked to a calendar can maintain their own availability if you grant it; only admins should edit calendars they do not personally work in unless you have agreed an internal process.
`.trim(),
    },
    {
      slug: 'appointment-calendar',
      helpSection: 'operations',
      title: 'Using the Appointment Calendar',
      description:
        'Switch views, filter columns, create staff bookings, drag appointments when allowed, and open rich detail sheets.',
      tags: ['calendar', 'grid', 'drag', 'filters'],
      content: `
# The Appointment Calendar in practice

Open **Appointment Calendar** (\`/dashboard/calendar\`) whenever your venue is **schedule-calendar eligible** (appointments, classes, events, or resources are active). Pure table venues without those models use other tools—this article assumes you see the grid.

**What this covers:** views and filters, creating bookings, when drag-and-drop is allowed, and how the detail sheet keeps payments and messages in one place.

:::help-figure calendar-columns

## Choose the right zoom

- **Day** – front-desk mode; scan every column minute by minute.
- **Week** – planning who is in building-wide.
- **Month** – big-picture capacity; drill into a day when needed.

Use the **View** dropdown in the toolbar to switch between these modes. The date control, **Filter**, **Refresh**, **New appointment**, and **Walk-in** actions stay in the same toolbar so your team does not have to relearn the page in each view.

## Columns and filters

Each **bookable calendar** is a column. Use the **column filter** to hide rooms you do not need right now. **Mine** shortcuts appear when the signed-in user manages specific calendars—perfect on a tablet at reception.

## Create or move work

- Click a slot to launch the **staff booking** flow for walk-ins or phone bookings.
- **Drag and drop** when your role allows it; the app validates each move. If something is rejected, read the inline message—it usually means the destination violates buffers, closures, or double-booking rules.

## Detail sheets

Selecting an item opens its detail sheet: payments, messages, attendance (for classes), and status history stay together so you are not jumping between modules.

## Relationship to the list

Use **Appointments** / **Bookings** when you need filters, CSV export, or bulk messaging; use the **Appointment Calendar** when spatial context matters. Both stay in sync via live updates—watch the connection indicator and tap **refresh** if you lose sync on flaky Wi-Fi.

## Roles

Every staff member who can see the grid should know your internal rules for dragging bookings that already paid online—when in doubt, edit from the detail sheet so financial records stay tidy.
`.trim(),
    },
    {
      slug: 'managing-appointments',
      helpSection: 'operations',
      title: 'Managing the appointments list',
      description:
        'Filters, statuses, confirmations, walk-ins, CSV export, bulk email and SMS, and staying in sync with live updates.',
      tags: ['bookings', 'csv', 'bulk', 'filters'],
      content: `
# The high-volume appointments workspace

The **Appointments** (or **Bookings**) page is tuned for busy reception teams: filter fast, act in bulk, and export when finance needs a spreadsheet.

**What this covers:** the toolbar (filters, search, export), statuses and row actions, and how bulk messaging skips guests who are missing email or phone.

:::help-figure list-toolbar

## Filters that actually save time

Combine tools such as:

- **Status** – focus on requests awaiting confirmation, arrivals, or cancels.
- **Calendar / column** – isolate one practitioner or room.
- **Service** – when you run many catalogue lines.
- **Booking model** – if you enabled classes, events, or resources alongside appointments.
- **Search** – match name, phone, email, or internal IDs when someone is on the phone.
- **Time-of-day window** – useful on packed Saturdays.

The toolbar also has a **View** menu: **Day**, **Week**, **Month**, and **Custom** date range. Use **Custom** before exporting a payroll, campaign, or finance period.

## Row actions

Expand a row to see the full story without losing your place. From here you can:

- Update **status** or **confirm** a tentative booking.
- Open the **detail sheet** for payments or notes.
- Launch **edit** flows when policies allow changes.

## Walk-ins and new bookings

Use **New appointment** / **New booking** for planned entries and the **Walk-in** shortcut when someone is already at the desk. Both respect the same service rules as online guests.

## Export appointments

Choose a date range, export **CSV**, and hand the file to finance or external CRM tools. Exports reflect the filters you applied so you can slice a single practitioner or service before downloading.

## Bulk messaging

Select multiple rows to send **email**, **SMS**, or **both**. The tool automatically skips guests missing the channel you picked (for example no mobile number for SMS). Always double-check the recipient count before confirming.

## Live updates and polling

The toolbar shows whether you are **live** via realtime sync. If the banner indicates reconnecting, pause destructive edits until you are synced or press **refresh**—two colleagues editing blindly can cause clashes.

## Contacts integration

Need to edit a guest profile or add tags? Open **Contacts** (\`/dashboard/contacts\`) from the sidebar; the list view links neatly back to booking history across models.
`.trim(),
    },
    {
      slug: 'classes',
      helpSection: 'operations',
      title: 'Classes and timetables',
      description:
        'Enable the class model, define class types, generate instances, manage capacity, take payments, and check guests in.',
      tags: ['classes', 'timetable', 'roster'],
      content: `
# Classes (when the model is enabled)

Turn on **Classes** under **Settings → Profile → Booking models**, then open **Classes** (\`/dashboard/class-timetable\`) from the sidebar (just under **Contacts**).

**What this covers:** class types, weekly patterns, generated instances, and attendance.

## Class types (the template)

:::help-figure schedule-models

Each class type captures:

- **Marketing copy** – name and description shown online.
- **Schedule basics** – duration, default capacity, colour on the calendar.
- **Instructor calendar** – which column owns generated sessions.
- **Commercial rules** – price, deposit settings, and **payment requirement** (none, deposit, or full payment).
- **Booking windows** – advance days, minimum notice, cancellation notice, same-day toggle.

Spend time here once; timetable rows inherit these defaults.

## Weekly timetable

Add **weekly patterns** with start time, **recurrence interval**, and optional **end dates** or caps on how many sessions to generate ahead. The system materialises concrete **instances** your team can see on the **Appointment Calendar**.

## Instance lifecycle

Browse generated sessions to:

- **Cancel** a single date without deleting the whole series.
- Apply **capacity overrides** when a room changes size.
- Review **attendees** as bookings arrive.

## Check-in, attendance, and CSV

Mark attendance for operational confidence and export rosters to CSV when partners need a headcount. If payments are due online, watch for Stripe warnings on unpaid rows—handle them before guests arrive when your policy requires prepayment.

## Calendar entitlements

Each class type must reference a **bookable calendar** your plan still allows. If you downgrade tiers, revisit class assignments so nothing points at a deactivated column.

## Roles

**Admins** configure types and timetables; **staff** can help with check-in depending on your internal policy. Everyone should know who adjusts capacities mid-season.
`.trim(),
    },
    {
      slug: 'selling-class-packs',
      helpSection: 'operations',
      title: 'Selling class packs (credits)',
      description:
        'Configure credit packs guests can buy in advance, set expiry, restrict to specific class types, and track usage.',
      tags: ['classes', 'class-packs', 'credits', 'commerce', 'memberships'],
      content: `
# Selling class packs

**Class credits** let guests pre-pay for a fixed number of classes — for example, a 5-class intro offer or a 10-class pass. When they redeem a credit at booking, no card charge is needed.

**Where:** Classes → **Class products** → **Credits** tab. The "Class products" button only appears when **Class packs, courses & memberships** is on under **Settings → Booking settings → Optional Booking features**.

## What a pack contains

- **Name and description** — what guests see on your public booking page and in their account.
- **Credits count** — how many classes the pack buys (1 credit = 1 spot in a class).
- **Price** — total price for the pack, in £.
- **Validity (days)** — credits expire this many days after purchase. Leave blank for no expiry.
- **Eligible classes** — restrict the pack to specific class types, or leave empty to allow all classes.
- **Active** — toggle off to stop selling it without losing history.

Use the **Intro 5 pack** and **10 class pass** quick templates to prefill sensible defaults.

## How a guest buys a pack

1. They open your public booking page and choose the **Classes** tab.
2. Under "Passes, courses & memberships" they click **Buy pack**.
3. If signed out, they sign in (password or magic link); if signed in, they jump straight to **Account → Class credits** with the pack preselected.
4. Stripe Elements opens automatically. They pay with card or saved card.
5. The credits appear under **Balances** with their expiry date. A receipt email goes out (**Class credits purchased**).

## How credits are spent

When a guest books a class on your public page and the class requires payment, they can tick **Pay with class credits** instead. The system spends from the **oldest expiring** batch first (FIFO) and only from packs eligible for that class type. If they don't have enough, the line falls back to card payment.

If a credit-paid booking is cancelled within your cancellation window, **the credit is restored** to the same batch and a **Class credits restored** email goes out — automatic and idempotent.

## Expiry and reminders

A nightly cron expires balances on their expiry date. **7 days before expiry**, guests with unused credits get a reminder email (**Class credits expiring soon**) so they have time to book a class.

## Archive vs delete

- **Archive** when you stop offering a pack but want to keep its purchase history. Guests who already own credits from it can still spend them; new buyers can't see it.
- **Delete** only when no guest has ever bought from it. The dashboard blocks deletion otherwise — archive instead.

## Tips

- Set **validity_days** to nudge guests into a habit (30–90 days work well).
- Restrict an introductory pack to your beginner class type only — guests then upgrade to a "10 class pass" once they've found their level.
`.trim(),
    },
    {
      slug: 'building-a-class-course',
      helpSection: 'operations',
      title: 'Building a class course',
      description:
        'Bundle a fixed set of class sessions into one course product, set enrolment caps and dates, and manage cancellations.',
      tags: ['classes', 'courses', 'commerce'],
      content: `
# Building a class course

A **course** is a fixed-session programme — six weeks of beginners Pilates, a four-session yoga immersion — sold as one price. Guests enrol once and the system holds a spot for them in every linked session.

**Where:** Classes → **Class products** → **Courses** tab.

## Setup

1. First, generate the class instances that will make up the course (the **Classes** page does this from your weekly timetable).
2. Create the course product with:
   - **Name and description** — your marketing copy.
   - **Price** — total price in £. Free courses (£0) skip Stripe entirely.
   - **Max enrolments** — optional cap; the form blocks new enrolments once it's hit.
   - **Enrolment opens / closes** — optional window where guests can sign up.
   - **Included sessions** — pick the instances that make up the course. Use the **class type** dropdown and **date range** filters to narrow the list, then tick each session you want included.
   - **Cancellation window (days)** — how many days before the first session a guest can self-cancel for a full refund. Leave blank for non-refundable.

Active courses must have at least one session selected.

## How a guest enrols

1. From the public **Classes** tab they click **Enrol** on the course they want.
2. Free courses confirm immediately; paid courses open Stripe Elements with the venue's connected account.
3. After payment, the system links the guest's enrolment to every session and sends an **Enrolment confirmed** email listing the sessions and start date.

## Cancellations and refunds

Inside the configured window:

- **Guests** can cancel themselves from **Account → Courses** — Stripe issues a full refund automatically, all linked session enrolments are cancelled, and the guest gets a **Course refund** email.
- **Staff** can cancel any enrolment from **Class products → Courses → View enrollments** (same refund behaviour) or **Force-cancel** past the window if needed (no automatic refund — handle manually with the guest).

## Per-session attendance

After a session runs, mark each enrolled guest as **Attended** or **No show** from the **Class instance roster** (open it from the Classes dashboard). The course enrolment shows running totals like "5 / 6 sessions attended" so you can spot drop-offs.

## Tips

- **Limit max enrolments** to your room's capacity so a sold-out course doesn't accidentally over-fill a session.
- Set **opens_at** ahead of your first session so the marketing window matches your social posts.
- A 7-day **cancellation_window_days** is a good default — guests have time to commit, but you have enough notice to refill the spot.
`.trim(),
    },
    {
      slug: 'selling-memberships',
      helpSection: 'operations',
      title: 'Selling memberships',
      description:
        'Subscription class plans — unlimited or allowance-based — with rollover, member discounts, and Stripe Connect billing.',
      tags: ['classes', 'memberships', 'commerce', 'subscriptions'],
      content: `
# Selling memberships

A **membership** is a Stripe-billed subscription that gives the member ongoing class access — either unlimited classes or a fixed allowance per billing period. Memberships bill on **each venue's own Stripe Connect account**.

**Where:** Classes → **Class products** → **Memberships** tab.

## Plan rules

- **Unlimited** — the simplest model. Any class covered by the plan is free for the member.
- **Allowance per period** — N classes per billing period (weekly / monthly / yearly).
   - **Rollover** — unused allowance carries into the next period.
   - **Rollover limit** — cap the carry-over (otherwise it accumulates indefinitely).
- **Member discount %** — applies to paid classes that aren't already covered by allowance or unlimited (e.g. workshops outside the plan).
- **Eligible class types** — restrict the plan to specific class types, or leave empty for all classes.
- **Allow recurring booking** — must be enabled for guests on this plan to set up recurring auto-bookings.

## Stripe Connect setup

Two ways to attach a Stripe price:

1. **Recurring price + interval** (recommended) — ResNeo creates a Stripe Product and a recurring Price on your connected account when you save the plan. Change the price or interval later and a new Price is generated; the old one is archived automatically.
2. **Paste an existing Stripe Price ID** — useful if you already manage subscriptions externally.

Active plans must have a Stripe price attached so guests can subscribe.

## How a guest subscribes

1. From the public **Classes** tab they click **Start membership** on the plan.
2. They're sent to Stripe-hosted Checkout (on your connected account) to enter card details.
3. The webhook syncs the subscription to ResNeo and sends a **Membership started** welcome email.

## Period boundaries and allowance reset

A nightly cron writes a **period_reset** ledger row each billing cycle. The remaining allowance carries over per the rollover rules. The member sees "**X / Y classes used this period · Resets {date}**" in **Account → Memberships**.

## Cancelling

Members cancel from their account; the cancellation is **scheduled for period end** (they keep access until then). They get a **Membership scheduled to end** email immediately and a **Membership ended** email once the final period rolls over.

## Discount + allowance precedence

When a guest books a class with a paid line and they hold a membership covering it, the engine evaluates in this order:

1. **Pay with class credits** if the guest has a credit balance and ticked the box.
2. **Course coverage** if the class is part of a course they're enrolled in.
3. **Membership unlimited** — line is free.
4. **Membership allowance** — line is free, allowance ledger debits.
5. **Member discount** — the line is paid but reduced by the best discount on any membership covering the class type.
6. Otherwise, full price.

## Archiving

When you archive a membership product, ResNeo automatically archives the Stripe Product and Price on the connected account. Existing members keep their subscription until they cancel — the plan just stops being offered to new buyers.

## Tips

- Make your most popular plan the **default** by listing it first under your venue's marketing.
- Set **rollover_limit = allowance_per_period** to allow members one missed week without them stockpiling free classes indefinitely.
- Use **member_discount_percent** on workshop-style class types you don't want fully covered.
`.trim(),
    },
    {
      slug: 'events',
      helpSection: 'operations',
      title: 'Ticketed events',
      description:
        'Experience events, ticket tiers, flexible scheduling modes, attendee management, and CSV exports for the door team.',
      tags: ['events', 'tickets', 'capacity'],
      content: `
# Ticketed events

Enable **Ticketed events** under **Settings → Profile → Booking models**, then open **Events** (\`/dashboard/event-manager\`).

**What this covers:** structuring an event, multiple ticket types, flexible scheduling, and attendee management.

## Create the experience

:::help-figure schedule-models

Start with an **experience event**: marketing description, hero imagery (when you use it), overall **capacity**, and the **calendar column** that owns the runtime schedule. Guests browse these like any other tab on your public page.

## Ticket types (tiers)

Add one or more **ticket types** with independent prices and optional per-tier capacities—perfect for “General admission” vs “VIP”, or adult vs child pricing.

## Scheduling modes

- **Single date** – launches, dinners, one-night shows.
- **Weekly recurrence** – regular tours or supper clubs.
- **Custom date lists** – paste irregular runs (festivals, multi-city tours). The parser saves hours versus manual entry.

## Booking rules

Mirror how you sell elsewhere: advance booking windows, minimum notice, cancellation notice, same-day controls, and whether you require **deposit** or **full payment** online. Consistency with your **Communications** templates avoids guest disputes.

## Attendees and door operations

Track **status**, **check-in**, and **cancellations** from the event workspace. Download **CSV** for door staff or finance reconciliation.

## Search and detail panels

When dozens of events are live, use search and the **detail panel** to jump between runs without losing context.

## Stripe reminders

Card-present rules still apply: Connect must be healthy before you demand online settlement. Test a ticket purchase after major edits.
`.trim(),
    },
    {
      slug: 'resources',
      helpSection: 'operations',
      title: 'Resources and facilities',
      description:
        'Define bookable assets, manage the resource timeline, understand the guest journey, and pause resources safely.',
      tags: ['resources', 'facilities', 'timeline'],
      content: `
# Resource booking

Enable **Resources** under **Settings → Profile → Booking models**, then open **Resources** (\`/dashboard/resource-timeline\`).

**What this covers:** what counts as a resource, how staff use the timeline, and what guests see when they book online.

## What a resource is

:::help-figure schedule-models

Think courts, treatment rooms, hot desks, or equipment bundles. Each resource stores:

- **Slot interval** – the grid granularity (for example 30 minutes).
- **Allowed durations** – multiples guests can pick.
- **Pricing & payment rules** – aligned with Stripe Connect like other models.

## Staff timeline

The **resource timeline** shows occupancy across the day. Use it to spot gaps, move bookings (when permitted), or answer phone enquiries without opening the public site.

## Public booking flow

Guests choose a **resource**, browse a **month**, pick a **duration**, then select a **slot** that respects buffers and closures. Card payments run through Stripe when your rules require them.

## Maintenance mode

**Deactivate** a resource to remove it from public lists immediately—useful during refurbishments or when equipment is out for repair. Existing bookings remain visible historically; handle them according to your policy.

## Calendar columns

Resources still rely on **bookable calendars** created in **Calendar Availability**. If a resource disappears from sale, verify it is both active **and** attached to a live calendar.

## Reporting

Resource revenue rolls up into **Reports** alongside other models so you can compare demand drivers in one date range.
`.trim(),
    },
    {
      slug: 'team-management',
      helpSection: 'setup',
      title: 'Team access, roles, and calendar links',
      description:
        'Invite admins and staff, assign calendars, respect plan staff caps, reset passwords, and configure session timeout for shared devices.',
      tags: ['staff', 'roles', 'security', 'invites'],
      content: `
# Build a safe team workspace

Admins manage people under **Settings → Staff**. Staff without admin rights still get **Account** for their personal details.

**What this covers:** inviting people, linking calendars, and how staff caps on your plan behave.

## Invite flow

:::help-figure team-access

1. Click **Add User**.
2. Enter **email**, **name**, and **role** (**admin** or **staff**).
3. Link the person to the **bookable calendars** they should manage. Those links control “mine” filters and availability shortcuts.

Invites expire like any email link—use **Resend** if someone loses it.

## Plan caps

**Light** allows **one** staff login, **Plus** allows **up to five**, **Pro** is unlimited. When you reach the cap the **Add** button disappears—upgrade or remove inactive accounts.

## Day-two operations

- **Promote / demote** roles when someone changes jobs.
- **Reset passwords** for colleagues who are locked out (admins only).
- **Remove** users who leave—calendar assignments clean up automatically.

## Session timeout

Configure **venue session timeout** under **Settings** for tablets at reception so idle devices lock quickly on shared hardware.

## What staff cannot see

Non-admins do **not** get **Reports**, **Data import**, or full venue **Settings** tabs—they manage bookings and personal account details only. If someone needs billing access, promote them thoughtfully.

## Support

If a staff member is stuck, they can still use **Support** from the sidebar footer to reach your internal escalation path.
`.trim(),
    },
    {
      slug: 'deposits',
      helpSection: 'setup',
      title: 'Deposits, full payments, and refunds',
      description:
        'Stripe Connect, per-service rules, card holds with no-show fees, guest checkout, staff-created bookings, and keeping cancellation policy consistent.',
      tags: ['stripe', 'payments', 'deposits', 'refunds', 'card hold', 'no-show'],
      content: `
# Get paid the way you promise

ResNeo never holds your funds—card charges route through **Stripe Connect** straight to your business account. Your job is to configure **when** money is due and **what** happens if someone cancels.

**What this covers:** a short go-live checklist, card holds for no-show protection, staff-created bookings when payment is required, and keeping messages aligned with your policy.

## Go-live checklist

:::help-figure payments-flow

1. Finish **Stripe Connect** onboarding (**Settings → Payments**).
2. For each **service**, **class type**, **event**, or **resource**, choose the correct **payment requirement** (none, deposit, full payment, or card hold).
3. Review **Communications** templates for deposit **requests**, **confirmations**, and **reminders** so wording matches your legal policy.

## Guest checkout

Public flows automatically launch **Stripe** whenever money is required **before** confirmation. Guests see card fields hosted by Stripe (never custom card inputs).

## Staff-created bookings

Phone and walk-in bookings follow the same payment rules. If the catalogue expects online payment, collect card details through the guided flow so ledgers stay consistent.

## Card holds: no payment up front

A **card hold** protects you from no-shows without charging clients when they book. No payment is taken. The client's card is stored securely with Stripe, and you can charge a **no-show fee** if they do not attend. Nothing is ever charged automatically.

## Turn on card holds

1. In **Settings**, open the **service editor** (the same place you set deposits today).
2. Choose **Card hold** as the deposit type.
3. Set the **no-show fee (£)**. This is the most you can charge if the client does not attend.

Card holds also work for class types, events, resources, and table booking rules. For classes, events, and tables the fee is **per person**. If you do not see the Card hold option, it is not switched on for your venue yet; contact support.

## What clients see online

Clients enter their card details as part of booking, just like a deposit, but **no money is taken**. The booking confirms once the card is saved. Their confirmation explains that no payment was taken and shows the maximum no-show fee.

## Card holds on phone bookings

1. Create the booking as normal.
2. When the service needs a card hold, a **Card hold** toggle appears on the New Booking form, switched on by default. Turn it off to waive the hold for this booking.
3. Leave it on and the client receives a secure link by email or SMS to add their card details on their own device.
4. The booking stays **Pending** until the card is saved, then confirms on its own. The client gets a reminder after 2 hours, and the booking cancels automatically after 24 hours if no card is added.

## Charge a no-show fee

1. Mark the booking as a **no-show**, exactly as you do today.
2. Open the booking and choose **Charge no-show fee**.
3. Check the amount and confirm. You can charge less than the maximum, never more.

Only **admins** can charge the fee. The card is released automatically 14 days after the booking, or as soon as the booking is cancelled. Once released, it can never be charged.

## Refund a no-show fee

Charged in error, or the client had a genuine reason? Open the booking and choose **Refund no-show fee**. The money goes back to the saved card. Admins only.

## Confirm or cancel links

Automated messages may include **confirm or cancel** links (for example \`/confirm/{bookingId}/{token}\`). Guests should understand deposit implications before they tap—mirror that language in your templates.

## Refunds and disputes

Cancellation windows live on each catalogue row. When you change a window, update email/SMS templates the same day so support teams quote the correct policy.

## Troubleshooting payments

Start with [Troubleshooting — Stripe](/help/troubleshooting/stripe-issues) if Connect is disconnected or payments fail mid-checkout—most issues are incomplete onboarding or expired cards.
`.trim(),
    },
    {
      slug: 'communications',
      helpSection: 'growth',
      title: 'Automated messages and template lanes',
      description:
        'Appointments vs table lanes, message types, SMS allowances, previews, and when staff can still send manual messages.',
      tags: ['sms', 'email', 'templates', 'reminders'],
      content: `
# Communications that match how you sell

Open **Settings → Communications** as an admin. You will see **policy** switches and **template** editors with merge fields.

**What this covers:** choosing the right template lane, SMS allowances by tier, and using previews before you go live.

:::help-figure comms-lanes

## Pick the correct lane

- **Appointments & other** covers appointments, classes, events, and resources—the bulk of Appointments-plan venues live here.
- **Table bookings** only appears when your venue also runs **table reservations**. Keep table wording separate so merge fields stay accurate.

## Message types you will touch most

Typical automated types include **confirmation**, **deposit request**, **confirm or cancel**, **pre-visit reminder**, **modification**, **cancellation**, **auto-cancel**, **no-show**, **post-visit thank you**, plus **custom** broadcasts for campaigns.

Toggle **email** and **SMS** per message when the controls allow it—some regulatory templates require both channels to stay on.

## SMS allowances

**Light**, **Plus**, and **Pro** include monthly SMS bundles (${SMS_INCLUDED_LIGHT} / ${SMS_INCLUDED_PLUS} / ${SMS_INCLUDED_APPOINTMENTS}). You may need a saved card before SMS can send if billing is not active yet. Watch any red **banner** inside Communications or Plan for billing prompts.

## Previews

Use **preview** with sample merge data to catch awkward phrasing before guests see it. Remember previews are static—always send a real test booking if you changed something critical.

## Manual and bulk sends

Operational teams can still send **one-off** or **bulk** messages from booking screens when policy and contact details allow—automation does not replace human judgement for VIPs or incidents.

## Related reading

- Stripe and billing context: [Settings](/help/settings/overview)
- Guest-facing issues: [Troubleshooting](/help/troubleshooting/access-issues)
`.trim(),
    },
    {
      slug: 'reports',
      helpSection: 'growth',
      title: 'Reports, exports, and the Clients view',
      description:
        'Admin-only analytics, date ranges, appointment-focused charts, full booking exports, and how Contacts complements reports.',
      tags: ['reports', 'analytics', 'csv', 'admin'],
      content: `
# Understand performance at a glance

**Reports** (\`/dashboard/reports\`) is **admin-only**. If you do not see it, ask an admin to upgrade your role or share exports manually.

**What this covers:** the widgets that matter most for appointment-heavy venues and how CSV exports fit finance workflows.

:::help-figure reports-dashboard

## Date range first

Pick a **start** and **end** date, then **Apply**. Most charts and tables respect that window, so align it with your payroll or marketing cadence.

## Highlights for appointment businesses

- **Summary tiles** – volume, revenue mix, and channel split (online vs phone vs widget).
- **By booking type** – when you run multiple models, see which line drives growth.
- **Team & services** – who performs work and which catalogue items sell.
- **No-shows & cancellations** – download CSV slices for stand-ups.

## Full exports

Use **Export bookings** and **Export guests** sections for spreadsheet backups or data science projects. These respect your permissions and can be large—run them off-peak if your browser feels sluggish.

## Clients tab and Contacts

Inside Reports, the **Clients** tab summarises guest value. For deep profile edits, tags, or cross-model history, jump to **Contacts** (\`/dashboard/contacts\`)—the CRM view stays in sync with the same guest records.

## Hygiene

Exports contain personal data—store them securely and delete local copies when finished. Admins should rotate who can download full history as staff change roles.
`.trim(),
    },
    {
      slug: 'data-import',
      helpSection: 'growth',
      title: 'Importing clients and bookings',
      description:
        'Start from Settings, walk through upload, mapping, validation, review, execute, and know how the 24-hour undo window works.',
      tags: ['import', 'csv', 'migration', 'admin'],
      content: `
# Bring historical data forward

**Who can import:** venue **admins** only. Staff should send files to an admin to protect data quality.

**What this covers:** where to open the importer, each step in the wizard, and why **Undo** is different from deleting an import session.

:::help-figure import-flow

## Where to start

1. Open **Settings** (\`/dashboard/settings\`).
2. Choose the **Data import** tab.
3. Click **Open Data Import**—this jumps to \`/dashboard/import\` with the right permissions.

## Step-by-step flow

1. **Start** a new import session.
2. **Upload** the CSV export from your previous system (any platform is fine as long as columns are consistent).
3. **Map** columns to ResNeo fields—save mapping presets when you expect repeat uploads.
4. **Validate** to catch missing emails, impossible dates, or duplicates.
5. **Review** counts: new clients, new bookings, skipped rows, updates to existing profiles.
6. **Execute** when you are confident.

## After import completes

- Download the **report CSV** for audit trails.
- Use **Undo** within **24 hours** if something looks wrong—this actually rolls back imported rows.
- **Deleting** a session from the hub **does not** remove committed rows; only **Undo** (inside the window) does.

## Hygiene tips

- Deduplicate guests in your source file when possible.
- Run a small pilot file before importing tens of thousands of lines.
- Communicate downtime to staff if you import during business hours—realtime views may flicker briefly.

## Need help?

If validation errors feel cryptic, copy the exact message (and row references if shown), then use [Import troubleshooting](/help/troubleshooting/import-issues) or escalate to your admin with that text.
`.trim(),
    },
    {
      slug: 'booking-widget',
      helpSection: 'growth',
      title: 'Your booking page, embed, and QR code',
      description:
        'Find widget settings under Profile, build an iframe snippet, add accent colour and tab deep links, include resize.js, and understand QR behaviour.',
      tags: ['embed', 'widget', 'iframe', 'qr', 'marketing'],
      content: `
# Meet guests wherever they browse

You have three related surfaces:

1. **Hosted booking page** at \`/book/{your-venue-slug}\` (responsive, great for social links).
2. **Embeddable widget** at \`/embed/{your-venue-slug}\` for iframes inside your own website.
3. **QR codes** for posters—usually pointing at the hosted page so guests get the full layout.

**What this covers:** where to copy the embed snippet, useful URL parameters, and how widget bookings show up in reports.

:::help-figure embed-vs-book

:::help-figure widget-settings

:::help-figure public-tabs

## Where the controls live

1. Sign in as an **admin**.
2. Open **Settings → Profile**.
3. Scroll to **Widget, embed & QR code** (same page hosts the iframe snippet, accent colour picker, and QR download).

Legacy menu entries redirect here automatically.

## iframe snippet checklist

- Copy the **iframe** HTML ResNeo generates for you.
- Optional query params:
  - \`?accent=RRGGBB\` (hex **without** the hash) to tint buttons to match your brand.
  - \`?tab=appointments\` | \`tables\` | \`events\` | \`classes\` | \`resources\` to open a specific tab when the venue exposes that model.
- Include the hosted **resize.js** script so the iframe height tracks each step of the flow. Without it, embeds often clip or double-scroll inside your CMS.

## QR codes

The QR generator points at the **hosted** booking page so printed collateral benefits from responsive layout. If you intentionally want embed mode, swap the URL manually—but test on a real phone first.

## Analytics

Widget bookings record **source = widget** so **Reports** can compare marketing channels. Hosted page visits without the embed still count under their respective channel rules.

## Marketing ideas

- Drop the hosted link in Instagram bios or Google Business Profiles.
- Embed the iframe on your “Book now” page to keep traffic on your domain while checkout still runs securely inside ResNeo.

## Related articles

- Payments and deposits: [Deposits](/help/appointments/deposits)
- Communications after booking: [Communications](/help/appointments/communications)
`.trim(),
    },
  ],
};
