import type { HelpCategory } from '../types';

export const appointmentsCategory: HelpCategory = {
  slug: 'appointments',
  title: 'Appointments plan',
  description:
    'Pro, Plus, and Light: calendars, services, availability, classes, events, resources, and imports.',
  plan: 'appointments',
  articles: [
    {
      slug: 'overview',
      title: 'Appointments Pro, Plus and Light',
      description: 'Limits, SMS billing differences, and what unified scheduling means in practice.',
      tags: ['pro', 'plus', 'light', 'limits'],
      content: `
# Appointments plans compared

## Tiers

- **Appointments Pro**: a high practical limit on active bookable calendars and staff seats for growing businesses.
- **Appointments Plus**: up to **5** active calendars and **5** staff seats.
- **Appointments Light**: **1** active calendar column and **1** staff login. **SMS** is usually metered (pay as you go) with stricter defaults. Watch any banners in **Communications** and **Plan**.

## Product shape

**Appointments** venues use **unified scheduling**: several **calendar columns** (often one per person or room) share one **Services** and **Calendar** experience. Older data may still appear in the same screens; you do not need to manage a separate “legacy” product area.

## Navigation labels

When you only run appointments (no extra models), the sidebar may say **Appointments** and **New Appointment** instead of **Bookings** / **New Booking**.

## Upgrades

Use **Settings → Plan** to change tier where the product allows it. Calendar and staff limits update as soon as the new tier is active. If **Add calendar** or invites disappear, you are likely at your new cap.
`.trim(),
    },
    {
      slug: 'calendar-setup',
      title: 'Creating your bookable calendars',
      description: 'Calendar Availability → Calendars tab, services assignment, entitlements, and Plus/Light caps.',
      tags: ['calendars', 'columns', 'entitlements'],
      content: `
# Bookable calendars (columns)

Open **Calendar Availability** (\`/dashboard/calendar-availability\`) as an admin and use the **Calendars** tab.

## What you create

Each **calendar** is a bookable column on your **Appointment Calendar**. Many businesses use one column per staff member or per room; choose a layout that matches how you work.

## Assign services

Link **appointment services** (and **class types**, **resources**, or **events** if you use them) to the right calendar so availability and new bookings stay consistent.

## Limits

**Plus** and **Light** enforce a **maximum** number of active calendars. The app uses **entitlement** checks: if **Add calendar** is disabled, upgrade the plan or **deactivate** a calendar you no longer need.

## Staff view

Staff may default to the **Availability** tab for their own hours, while admins manage the full **Calendars** matrix.
`.trim(),
    },
    {
      slug: 'services',
      title: 'Building your service catalogue',
      description: 'Services page: duration, price, deposits, per-service windows, colours, and staff overrides.',
      tags: ['services', 'catalogue', 'pricing'],
      content: `
# Appointment services

Go to **Services** (\`/dashboard/appointment-services\`).

## Each service

Configure **duration**, **buffer**, **price**, **deposit**, **payment requirement** (none, deposit, or full payment), **colour**, **active** flag, and **sort order**.

## Booking windows

Set **per-service** advance booking range, **minimum notice**, **cancellation notice**, and **same-day** rules where applicable so different services (for example a quick trim vs a colour) can behave differently.

## Custom availability

Some services need **non-standard hours**. Use the **custom availability** editor on the service when your usual template hours are not enough.

## Staff overrides

Allow or block **per-staff** customisation (name, description, duration, buffer, price, deposit, colour) and resolve conflicts with the **override** modal.

## Stripe

If you charge online, finish **Stripe Connect** first. The app warns when a service expects payment but Connect is not complete.
`.trim(),
    },
    {
      slug: 'working-hours',
      title: 'Working hours, breaks and closures',
      description: 'Calendar Availability tabs: availability, breaks, days off, and venue opening context.',
      tags: ['hours', 'breaks', 'leave', 'closures'],
      content: `
# Working hours and closures

Use **Calendar Availability** tabs:

## Availability

Set **weekly templates** per calendar with the working-hours editor.

## Breaks

Add **break patterns** so online slots respect lunch breaks or gaps between clients.

## Days off / closures

Mark **leave** or closed days per calendar so you are not bookable when you are not working.

## Venue context

**Settings → Business hours** sets venue-wide opening. Calendar hours should usually **fit inside** what you advertise to the public unless you deliberately allow wider practitioner hours.

## Exceptions

Use **opening exceptions** next to business hours for bank holidays or one-off late openings that affect the whole venue.
`.trim(),
    },
    {
      slug: 'appointment-calendar',
      title: 'Using the Appointment Calendar',
      description: 'Day/week/month views, filters, staff booking modal, and detail sheets.',
      tags: ['calendar', 'dnd', 'booking'],
      content: `
# Appointment Calendar

Open **Appointment Calendar** (\`/dashboard/calendar\`).

## Views

Switch **day**, **week**, or **month** to match how you plan. The grid respects venue context and your configured **grid hours**.

## Columns

Each **bookable calendar** appears as a column. Use the **column filter** to hide calendars you do not need. **Mine** shortcuts appear when the signed-in user manages specific calendars.

## Drag and drop

Move appointments and blocks when your role allows. The interface validates each move; read the message if a slot is not allowed.

## Create bookings

Use the **staff booking** flow from a slot to add appointments for guests or walk-ins.

## Detail sheets

Open **appointments**, **class instances**, or **event instances** from the grid to see payments, messages, attendance, and status in one place.
`.trim(),
    },
    {
      slug: 'managing-appointments',
      title: 'Finding, modifying and cancelling appointments',
      description: 'Bookings dashboard filters, status changes, CSV export, and bulk messaging.',
      tags: ['bookings', 'status', 'csv'],
      content: `
# Managing appointments (list)

The **Bookings** page for unified venues is built for **high-volume** appointment work.

## Filters

Filter by **status**, **calendar** (column), **service**, **booking model** when you run extra types, **search** (name, phone, email, id), and **time-of-day** windows on a day.

## Actions

Expand rows, change **status**, **confirm** bookings, open the **detail sheet**, create **new** or **walk-in** bookings, and export **CSV** for a custom date range.

## Bulk messaging

Select multiple bookings and send **email**, **SMS**, or **both**. The tool skips guests who are missing the channel you picked (for example no mobile number for SMS).

## Live updates

Watch the connection indicator. If sync drops, **refresh** before editing on another device so you do not clash with a colleague.
`.trim(),
    },
    {
      slug: 'classes',
      title: 'Setting up and managing classes',
      description: 'Class types, timetable, instances, capacity, payments, and check-in.',
      tags: ['classes', 'timetable'],
      content: `
# Classes

Open **Classes** (\`/dashboard/class-timetable\`) when the **class** model is enabled.

## Class types

Define **name**, **description**, **duration**, **capacity**, **price**, **colour**, **instructor calendar**, **payment requirement** (none, deposit, or full), deposit amounts, and **booking window** fields (advance days, minimum notice, cancellation notice, same-day toggle).

## Timetable

Add **weekly** patterns with start time, **recurrence interval**, and optional **end date** or caps on how many sessions to generate.

## Instances

Browse generated **instances**, **cancel** one-off sessions, set **capacity overrides**, and view **attendees**.

## Check-in and export

Mark **attendance**, use **CSV** helpers for rosters, and watch **Stripe** warnings when money is due online.

## Limits

Calendar **entitlement** still applies: each class type must sit on a bookable calendar your plan allows.
`.trim(),
    },
    {
      slug: 'events',
      title: 'Creating and selling event tickets',
      description: 'Experience events, ticket types, scheduling modes, and attendee CSV.',
      tags: ['events', 'tickets'],
      content: `
# Events

Open **Events** (\`/dashboard/event-manager\`) when **ticketed events** are enabled.

## Event setup

Create **experience events** with description, **start**, **capacity**, optional **image**, and assign the event to a **calendar column** for scheduling.

## Ticket types

Add **ticket tiers** with **price** and optional **per-tier capacity**.

## Scheduling modes

Choose a **single** date, **weekly recurrence**, or paste a **custom list of dates**. The app can parse text lists for tours, festivals, or irregular runs.

## Booking rules

Control advance booking, minimum notice, cancellation notice, same-day booking, and whether you require **deposit** or **full payment** online.

## Attendees

Track **status**, **check-in**, **cancellations**, and download **CSV** for door staff or finance.

## Search and detail

Use **search** and the **detail panel** when you run many events at once.
`.trim(),
    },
    {
      slug: 'resources',
      title: 'Resources and facility booking',
      description: 'Resource timeline, slot intervals, durations, and public resource flow.',
      tags: ['resources', 'facilities'],
      content: `
# Resources

Enable **resource booking** to open **Resources** (\`/dashboard/resource-timeline\`).

## What resources are

Bookable **facilities** or **equipment** (rooms, courts, studios) with **slot interval**, **durations**, **pricing**, and **payment** rules.

## Timeline

Staff manage occupancy from the **resource timeline** view.

## Public booking

Guests choose a **resource**, **month**, **duration**, then a **slot**, enter details, and pay online when required. The same **Stripe Connect** rules apply as for services.

## Maintenance

**Deactivate** resources you temporarily remove from sale so they disappear from public lists immediately.
`.trim(),
    },
    {
      slug: 'team-management',
      title: 'Inviting staff and managing access',
      description: 'Roles, calendar assignment, plan staff caps, password reset, and session timeout.',
      tags: ['staff', 'roles', 'invite'],
      content: `
# Team management

Admins: **Settings → Staff**.

## Invites

Send invites with **email**, **name**, and **role** (**admin** or **staff**). Link staff to **bookable calendars** they should work in (resource-type columns may be filtered out of assignable lists where that applies).

## Plan caps

**Plus** and **Light** enforce a **maximum staff** count. The add button hides when you are at the limit.

## Lifecycle

**Resend** invites, **promote or demote** roles, **reset passwords** for others, and **remove** users who leave.

## Session timeout

Set **venue session timeout** for shared reception tablets so idle devices lock sooner.

## Staff experience

Non-admins opening **Settings** only see **Account** for their own details. They cannot change venue-wide policies.
`.trim(),
    },
    {
      slug: 'deposits',
      title: 'Taking deposits and full payments',
      description: 'Service-level payment requirements, Stripe Connect, and guest checkout.',
      tags: ['deposits', 'stripe', 'full payment'],
      content: `
# Deposits and full payments (appointments)

## Requirements

1. **Stripe Connect** complete (**Settings → Payments**).
2. Each **service** (or class, event, or resource entry) sets **payment requirement** the way you intend.
3. **Communications** templates for deposit **request**, **confirmation**, and **reminder** if you rely on automation.

## Guest checkout

Public flows show **Stripe** whenever money is due before confirmation.

## Staff bookings

Staff-created bookings follow the same rules: if the product expects online payment, collect card details through the normal flow.

## Refunds

Match **cancellation** windows on services, classes, and events to what you promise in email and SMS so guests know what to expect.
`.trim(),
    },
    {
      slug: 'communications',
      title: 'Automated reminders and confirmations',
      description: 'Appointments lane, message types, SMS allowance, and previews.',
      tags: ['sms', 'email', 'reminders'],
      content: `
# Communications (appointments lane)

**Settings → Communications** loads **policies** and **templates** for automated messages.

## Lane

**Appointments & other** covers appointments, classes, events, and resources. Table venues get a separate **Table bookings** lane when that applies.

## Message catalogue

Typical types include **confirmation**, **deposit** flows, **confirm or cancel** prompts, **pre-visit reminder**, **modification**, **cancellation**, **auto-cancel**, **no-show**, **post-visit thank you**, and **custom** broadcast messages.

## Channels

Turn **email** and **SMS** on or off per message where the settings allow. Use **preview** with merge fields to check wording.

## SMS billing

**Plan** shows included messages vs overage. On **Light**, you may need a **saved card** before SMS can send. Follow any in-app banners.

## Operational sends

Staff can still send **one-off** or **bulk** messages from booking screens when policy and contact data allow it.
`.trim(),
    },
    {
      slug: 'reports',
      title: 'Reports, appointment insights and data export',
      description: 'Team & services charts, no-show series, CSVs, and full export.',
      tags: ['reports', 'analytics', 'csv'],
      content: `
# Reports (appointments)

**Reports** is **admin-only**.

## Date range

Pick a **date range** and apply. Most charts follow that window.

## Highlights for appointments

- **Summary** tiles for volume, clients, and channel mix.
- **By booking type** when you run more than one model.
- **Team, services, and channels** when available: who performed work, which services sell, and whether demand comes from online, phone, or the widget.
- **No-show** and **cancellation** views with **CSV** downloads.

## Data export

Download **all bookings** and **all guests** from the export section for backups or spreadsheets.

## Clients tab

Edit guest details in depth, use **tags**, and review **history** across models. Use the **Guests** shortcut route if your sidebar includes it.
`.trim(),
    },
    {
      slug: 'data-import',
      title: 'Importing clients and bookings',
      description: 'Import hub, platforms, validate, review, undo window, and report CSV.',
      tags: ['import', 'csv', 'migration'],
      content: `
# Data import

**Data Import** (\`/dashboard/import\`) is **admin-only**.

## Flow

1. **Start** a new import session.
2. **Upload** a CSV exported from your previous booking system. The mapping step works regardless of which platform the export came from.
3. **Map** columns to ReserveNI fields.
4. **Validate** and fix errors before you commit.
5. **Review** counts (clients, bookings, skipped, updated).
6. **Execute** the import.

## After import

- Sessions show **status** and timestamps.
- A **report CSV** is available for audit.
- **Undo** exists for a limited time. **Deleting** a session does **not** automatically remove rows that already imported; use **Undo** for that.

## Hygiene

Remove duplicate guests in your source file where you can. The mapper is strict on required fields to protect live data.
`.trim(),
    },
    {
      slug: 'booking-widget',
      title: 'Embedding your booking page',
      description: 'iframe URL, accent colour, tab query param, resize script, and QR.',
      tags: ['embed', 'widget', 'iframe', 'qr'],
      content: `
# Booking widget & QR

Visit **Settings → Widget** as an admin.

## iframe snippet

The snippet points to \`/embed/{venueSlug}\` with optional:

- \`?accent=RRGGBB\` (no \`#\`) to tint buttons.
- \`?tab=appointments\` | \`tables\` | \`events\` | \`classes\` | \`resources\` to open a specific tab when the venue supports it.

## resize.js

Include the hosted **resize** script so the iframe **height** grows as guests change steps. Without it, embeds may clip or scroll awkwardly inside your site.

## QR code

The QR opens your **public** \`/book/{slug}\` page (not the embed URL) so print collateral uses the full responsive layout.

## Analytics

Widget bookings record **source = widget** so you can compare channels in **Reports**.
`.trim(),
    },
  ],
};
