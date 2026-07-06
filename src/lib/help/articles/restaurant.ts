import type { HelpCategory } from '../types';

export const restaurantCategory: HelpCategory = {
  slug: 'restaurant',
  title: 'Restaurant plan',
  description:
    'Dining availability, floor plan, table grid, day sheet, waitlist, and table-focused communications.',
  plan: 'restaurant',
  articles: [
    {
      slug: 'overview',
      title: 'Restaurant plan overview and navigation',
      description: 'Who gets the restaurant product, what appears in the sidebar, and admin-only areas.',
      tags: ['restaurant', 'navigation', 'tier'],
      content: `
# Restaurant plan overview

The **Restaurant** and **Founding Partner** plans unlock the full **table reservation** product: **Dining Availability**, **Table Grid**, **Floor Plan**, and the **Table bookings** lane in **Communications**.

## Navigation highlights

- **Bookings**: list and manage reservations (and other enabled models if you added them).
- **Table Grid** and **Floor Plan**: appear when **table management** is on; live operational views for service.
- **Day Sheet**: front-of-house run sheet when **table management** is **off**. When table management is **on**, **Day Sheet** may redirect to **Floor Plan**.
- **Dining Availability**: **admin only**; configure services, capacity, rules, floor plan, and areas.
- **Waitlist**: for table-reservation venues only.
- **Calendar Availability**: appears when you also use schedule-backed models (appointments, classes, events, resources).

## Roles

**Staff** do not see **Reports** or **Dining Availability** in the sidebar, and do not have the **Data Import** tool (admins only: **Settings → Data Import**). They can still use bookings and floor tools you allow for their role.

## Hybrid venues

You can enable **extra** appointment-style models; the sidebar then adds links such as **Services**, **Events**, **Classes**, or **Resources**, and your public page gains tabs. See **Appointments plan** articles for those features.
`.trim(),
    },
    {
      slug: 'dining-services',
      title: 'Setting up dining services (sittings)',
      description: 'Lunch/dinner services, last booking time, and how they drive the grid and day sheet.',
      tags: ['dining', 'services', 'sittings'],
      content: `
# Dining services (sittings)

Open **Dining Availability** (\`/dashboard/availability\`) as an admin, then use the **Services** tab.

## What a “service” is

A **service** is a bookable sitting window, for example **Lunch 12:00–15:00** or **Dinner 17:30–22:00**, on the days you trade. You set **start** and **end** times and **last booking time** so the system knows when guests can still book.

## Why it matters

- **Public availability** for tables is calculated inside these windows.
- **Table Grid** and **Day Sheet** columns line up with your services for the date you pick.

## Tips

- Add **both** lunch and dinner if you serve both; guests only see slots inside active services.
- If you change service times, check bookings that sit on the old boundary so you do not strand anyone.
`.trim(),
    },
    {
      slug: 'booking-rules',
      title: 'Party sizes, advance booking and capacity rules',
      description: 'Min/max party, advance days, notice hours, and booking rules under Dining Availability.',
      tags: ['rules', 'capacity', 'party'],
      content: `
# Booking rules (restaurant)

Restaurant booking rules live under **Dining Availability** (tabs such as **Booking rules**, **Capacity rules**, and **Dining duration**, depending on your capacity model).

## Typical controls

- **Minimum and maximum party size** for online bookings.
- **How far ahead** guests can book (advance days).
- **Minimum notice** before a slot (hours).
- **Large-party handling**: you can require very large groups to call instead of booking online.
- **Pausing online booking** while you stay open for phone bookings (when your configuration supports it).

## Deposits

Table deposits follow your **deposit configuration** and dining rules. See **Deposits** in this section and **Settings → Payments** for Stripe.

## Consistency

After you change rules, open your **public booking page** as a guest would: check tonight and a date weeks ahead so the experience matches what you expect.
`.trim(),
    },
    {
      slug: 'floor-plan-setup',
      title: 'Designing your floor plan',
      description: 'Table Management tab, editor, tables, combinations, and adjacency.',
      tags: ['floor plan', 'tables', 'combinations'],
      content: `
# Designing your floor plan

As an admin, go to **Dining Availability → Table Management** (or **Settings → Floor plan** when the product links you there).

## Enable table management

Turn **table management** on when you are ready to assign bookings to **named tables** and to use **Table Grid** / **Floor Plan**. The product may offer a starter layout: review and adjust it before you go live.

## Editor basics

- Place **tables** on the canvas; set shapes, seats, and names.
- Define **combinations** (joined tables) where guests sit across merged capacity. Use **adjacency** so only tables that physically touch can combine.
- Upload a **background image** (optional) to trace your room.

## Dining areas

If you run several rooms or floors as **dining areas**, keep a **floor plan per area** where the product expects it.

Save as you go. Large layouts are easier to fix early than after weeks of live bookings.
`.trim(),
    },
    {
      slug: 'dining-areas',
      title: 'Managing multiple dining areas',
      description: 'Areas, colours, active flags, and public manual vs automatic area selection.',
      tags: ['areas', 'multi-room'],
      content: `
# Multiple dining areas

In **Dining Availability**, manage **dining areas** when you operate more than one bookable room, terrace, bar zone, and similar.

## For staff

- **Table Grid** and **Floor Plan** usually let you pick which **area** you are viewing.
- Filters and summaries follow the selected area.

## For guests online

You choose how guests pick an area:

- **Automatic**: availability can be merged for flows that support it.
- **Manual**: guests explicitly choose an area; use clear names and colours.

Keep inactive areas **turned off** so they do not appear in public flows.
`.trim(),
    },
    {
      slug: 'table-grid',
      title: 'Using the Table Grid',
      description: 'Time-by-table matrix, drag moves, filters, walk-ins, blocks, and undo.',
      tags: ['table grid', 'operations', 'drag'],
      content: `
# Using the Table Grid

**Table Grid** is your live **time × table** view for service.

## Core actions

- **Move** bookings between tables or times with drag-and-drop where it is enabled; invalid targets show a clear message.
- **Undo** recent moves when you slip during a rush.
- **Walk-in** from a cell to add a reservation on the fly.
- **Blocks**: hold tables (for example VIP hold, broken table) with optional repeat patterns.

## Filters and search

Filter by **zone**, **status**, **cancelled or no-show**, and **free text** to find a booking quickly.

## Combinations

When tables are **combined**, the grid reflects merged capacity from your floor plan rules and **combination** settings.

## Live updates

The view refreshes with **live sync** so the floor team stays aligned. Still confirm big moves out loud during service so everyone agrees.
`.trim(),
    },
    {
      slug: 'floor-plan-live',
      title: 'Using the live Floor Plan',
      description: 'Visual layout vs grid; link to edit layout from Dining Availability.',
      tags: ['floor plan', 'visual'],
      content: `
# Live Floor Plan

The **Floor Plan** page shows a **visual map** of tables for the selected **dining area**. It suits hosts who think in floor layout rather than a time grid.

## Compared to Table Grid

- **Grid**: time schedule and precise moves.
- **Floor Plan**: layout and status at a glance.

## Editing the layout

Admins can jump to **Dining Availability → Table Management** (or the linked floor plan editor) to adjust positions, combinations, and table metadata.

Use the same **area** selector as the grid when you have multiple rooms.
`.trim(),
    },
    {
      slug: 'day-sheet',
      title: 'Using the Day Sheet',
      description: 'Service-period columns, capacity, dietary summary, and when Day Sheet replaces floor tools.',
      tags: ['day sheet', 'foh'],
      content: `
# Day Sheet

The **Day Sheet** is a **front-of-house service sheet** by **service period** (lunch, dinner) with capacity, covers, and per-booking cards.

## When you see it

If **table management** is **off**, Day Sheet is your main operational schedule next to **Bookings**. If table management is **on**, the app may **send Day Sheet to Floor Plan** instead. Use Grid or Floor tools in that case.

## Features

- **Capacity** per period and **covers remaining**.
- **Dietary summary** with allergy-style highlighting for briefings.
- **Status** and **search** to filter the board.
- **Guest row** expansion: visit counts, **tags**, **table assignment**, **attendance**, **notes**, and **messaging** (email or SMS, depending on setup).
- **Polling** keeps the page reasonably fresh; refresh manually before service if you need absolute certainty.

## Best practice

Assign **tables** early, confirm **attendance**, and use **internal notes** for handover between shifts.
`.trim(),
    },
    {
      slug: 'managing-reservations',
      title: 'Finding, modifying and cancelling reservations',
      description: 'Bookings dashboard views, detail panel, table selector, messaging, and bulk tools.',
      tags: ['bookings', 'modify', 'cancel'],
      content: `
# Managing reservations

Use **Bookings** for calendar or list views across a day, week, or month.

## Detail panel

Open a booking to see **guest profile**, **communications log**, **table assignments**, **dietary** and **occasion** fields, **deposits**, **internal notes**, and **modify** flows.

## Table changes

Use the **table selector** with **day occupancy** hints so you do not double-book a table.

## Messaging

Send **SMS** or **email** from the booking when channels are on. **Admins** can use **bulk guest messaging** for a chosen set of bookings (respect opt-out and whether you have a number or email).

## Status workflow

Move bookings through your operational statuses (booked, confirmed, seated, completed, and similar) in line with your house rules and any **no-show grace** on the venue.
`.trim(),
    },
    {
      slug: 'waitlist',
      title: 'Managing the waitlist',
      description: 'Queue, statuses, and when the waitlist appears in the sidebar.',
      tags: ['waitlist', 'queue'],
      content: `
# Waitlist

**Waitlist** appears for **table reservation** venues.

## Typical workflow

Guests (or staff) join a **queue** when you are full. Entries move through states such as **waiting**, **offered**, **confirmed**, **expired**, and **cancelled**, depending on how you run service.

## Operations

- Review the list often during peak service.
- When a table frees, **offer** slots fairly and confirm quickly so offers do not expire on guests.

## Configuration

Align **booking rules** and **communications** with how you contact waitlisted guests when a table opens.
`.trim(),
    },
    {
      slug: 'deposits',
      title: 'Taking deposits from guests',
      description: 'Venue deposit rules, dining settings, and the guest Stripe payment step.',
      tags: ['deposits', 'stripe', 'payments'],
      content: `
# Deposits (restaurant)

Deposits need three pieces in place:

1. **Stripe Connect** ready under **Settings → Payments**.
2. **Deposit rules** on the venue or dining configuration (amount per person, online vs phone, minimum party size, weekend-only options; exact fields depend on your setup).
3. **Communications** templates for **deposit request**, **confirmation**, and **reminder** when you use them.

## Guest experience

When a slot needs a deposit, guests complete **Stripe** before the booking is confirmed.

## Card holds instead of deposits

Prefer not to take money up front? Choose **Card hold** as the deposit type in your booking rules and set a **no-show fee per person (£)**. Guests still add their card to book, but nothing is charged; the card is simply stored securely. If a party does not arrive, mark the booking as a no-show and an admin can charge the fee from the booking. Card holds follow your **Cancellation notice (hours)** setting: cancel before the notice period and the card is released, cancel late and the fee can still be charged from the cancelled booking. Otherwise the card is released automatically 14 days after the booking. If you do not see the Card hold option, it is not switched on for your venue yet; contact support.

## Staff-created bookings

Staff flows follow the same online payment rules when guests pay on the web; phone bookings may follow different rules if you configured that split.

## Refunds and cancellations

Cancellation **hours** control whether automatic refund messaging applies. Match your template wording to what you actually do in-house.
`.trim(),
    },
    {
      slug: 'communications',
      title: 'Automated guest communications (tables)',
      description: 'Table bookings lane, message types, channels, timing, and previews.',
      tags: ['sms', 'email', 'templates'],
      content: `
# Communications (table bookings lane)

Open **Settings → Communications**.

## Lanes

Restaurant and founding venues see **Table bookings** separately from **Appointments & other** when both apply.

## Message types

Examples include **confirmation**, **deposit** request, confirmation, **reminder**, **confirm or cancel** prompt, **pre-visit reminder**, **modification**, **cancellation**, **auto-cancel**, **no-show** (email where used), **post-visit thank you**, and **custom** staff messages.

## Channels and timing

Each message can use **email** and/or **SMS**, subject to plan and template. Timed messages support **hours before** or **after** the booking.

## Preview

Use **preview** to check merge fields and tone before you switch messages on for live traffic.

## SMS allowance

Most non-Light plans include a monthly **SMS bundle** with overage rates on **Plan**. **Light** appointments-style tiers may use metered SMS; read any banner in **Communications** if you see Light-style copy on a hybrid venue.
`.trim(),
    },
    {
      slug: 'reports',
      title: 'Reports, table utilisation and data export',
      description: 'Overview charts, table utilisation CSV, per-report exports, and full venue export.',
      tags: ['reports', 'csv', 'analytics'],
      content: `
# Reports (restaurant)

**Reports** is **admin-only**.

## Overview tab

Pick a **date range**, then review charts for **sources**, **status**, **covers**, **no-shows**, **cancellations**, and **deposits**. When you run **several booking types**, you will see **per-model** summaries.

## Table utilisation

When **table management** is on, use the **table utilisation** report for **percentage utilisation** per table and download **CSV** (occupied vs available time).

## Exports

Many widgets offer **Download CSV** for the chart you are viewing.

## Full export

On the reports page, **Data export** downloads **all bookings** and **all guests** for the venue. That export is **not** limited to the chart date filter. Use it for backups and spreadsheets.

## Clients tab

Open **Clients** for a guest list with tags, edits, and history. The same data may be linked from \`/dashboard/guests\`.
`.trim(),
    },
  ],
};
