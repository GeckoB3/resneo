import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: 'managing-appointments',
  helpSection: 'operations',
  title: 'Managing the appointments list',
  description: 'Ranges, filters and sorting, what an expanded row can do, bulk tagging and messaging, live updates, and where exports really live.',
  tags: ['bookings', 'filters', 'bulk', 'list'],
  verified: '2026-09-06',
  content: `
# The appointments list in practice

**Appointments** in the sidebar (\`/dashboard/bookings\`) is every booking as a list. The label reads **Bookings** instead when you run classes, events, or resources alongside appointments. This article is the reference for the page; for a gentler tour, read [Using the bookings list](/help/getting-started/bookings-list).

:::help-figure list-toolbar

## Choose the range first

The button on the left of the toolbar sets how much you are looking at: **Day**, **Week**, **Month**, or **Custom**. The arrows step by that amount and the date button opens a picker.

- In **Custom**, the picker becomes **From** and **To** date boxes. If you get them the wrong way round you will see "From must be on or before To".
- In **Day**, the picker also has **From** and **Until** hour boxes that narrow the list to part of the day. **Clear time filter** puts them back.
- **Day** shows one flat list. **Week**, **Month**, and **Custom** group the rows under a heading for each day.

## Filters

**Filter** opens one panel. While anything is set the button counts it, for example **Filter (2)**. The time-of-day boxes above count as one filter too.

- **Type**: **All**, then a pill for each booking type you run, such as **Appointment**, **Class**, **Event**, or **Resource**. It only appears when you have more than appointments.
- **Calendar**: **All appointments**, or one calendar. If you manage particular calendars, yours are listed first, prefixed **Mine** when there is more than one.
- **Service**: **All services**, or one service.
- **Status**: **All**, **Pending**, **Booked**, **Confirmed**, **Started**, **Completed**, **Cancelled**, or **No show**.

**Clear filters** appears at the bottom once anything is set.

Two more controls sit above the list when they apply. **All** / **My venue** / **Linked** picks whose bookings you are looking at when a venue shares calendars with you. **Needs compliance** shows only the bookings with a form still outstanding, with a count on the pill.

## Sorting and counting

Above the rows sit **Select all**, a **Sort** menu, and a count of the bookings on screen. Sort by **Date**, **Time**, **Client**, **Status**, **Service**, **Staff**, **Deposit**, or **Type**, then use the button beside it to switch between **Asc** and **Desc**.

The chips in the toolbar count the same range: bookings in total, then **Confirmed**, **Completed**, and **No-shows**.

## Reading a row

Each row carries the time, the date, the service, the calendar, and a status pill, then any of these:

- **Deposit pending**, and a price pill with the payment state beside it.
- **Compliant**, or "1 form due" and similar, when the client has paperwork to complete.
- A type pill for classes, events, and resource bookings.
- **Linked** for a booking that belongs to a venue you are linked with, and a pill when the appointment is online or off-site.

## What an expanded row can do

Click a row to open it in place. You get the client's name with **Call**, **Email**, and an icon that opens them in Contacts, plus:

- The status buttons for where the booking is now: **Accept** on a request, then **Start**, **Complete**, and their reverses **Undo Start** and **Reopen**. **Arrived** marks someone as waiting and **Clear** takes it off again.
- **Confirm** records that the client has said they are coming. To take that back, use **Cancel confirmation**, or **Undo confirm** on a booking whose status is already **Confirmed**.
- **New**, **Rebook**, and **Modify**, then **Cancel** and **No-Show**. Both of the last two ask you to confirm, with **Keep as is** to back out. **Undo No-Show** appears afterwards.
- **Services in this visit** when several services were booked together, and a group booking block when several people were booked at once.
- **Notes** for tags and booking notes, **SMS / email guest** to write to them, **Compliance** for outstanding forms, **Records** for their documents and photos, and **Timeline** for what has happened to the booking and when.
- The payment actions when money is involved: **Send payment link**, **Waive**, **Record cash**, **Refund deposit** or **Refund payment**, and **Resend confirmation**. These are covered in [Deposits, full payments, card holds, and refunds](/help/appointments/deposits).

A booking on a linked venue's calendar says so at the top: some links are view only, others let you edit but not cancel.

## Walk-ins and new bookings

**New** opens the **New booking** form and **Walk-in** opens the **Walk-in** form for someone already at the desk. Both apply exactly the same service, buffer, and availability rules as an online guest. If you filtered to one calendar, that calendar is pre-selected.

## Search

The magnifier is a client lookup, not a filter on the list. Type at least a couple of characters of a name, phone number, or email and each result offers **Book** to start a booking with their details filled in, or **View** to read their record. To narrow the list itself, use **Filter** and the date range.

## Tag or message several clients at once

1. Tick the checkbox on each row, or use **Select all**.
2. A tray appears at the bottom of the screen reading "N selected".
3. Choose **Add tag** to put the same tag on every one of those clients, or **Message** to write to them.
4. In the message box, pick a **Channel**: **Email & SMS (if available)**, **Email only**, or **SMS only**. Type your **Message** and click **Send**.

The same message goes to each selected booking, and anyone without the contact method you picked is skipped. Check the count in the title before you send. The cross at the end of the tray clears your selection.

## Live updates

The dot beside **Refresh** shows the connection. Green means live updates are running, and the list refreshes itself a couple of seconds after anything changes. Yellow means updates may be delayed while ResNeo reconnects, so press **Refresh** if you need to be sure before you act. Nothing is lost while the dot is yellow: it reconnects on its own.

## There is no export here

The bookings list has no CSV button. Every export lives under **Settings → Reports**, which also holds the date range, the per-report CSVs, and the client list. See [Reports, exports, and the Clients directory](/help/appointments/reports).

## Contacts

The person icon next to a client's name opens them in **Contacts**, where you edit their details, tags, marketing consent, documents, and history across every booking type. See [Your contacts (CRM)](/help/getting-started/contacts).

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| **No bookings match this view** | The range or a filter is too narrow | Widen the range, then open **Filter** and click **Clear filters** |
| A booking I know exists is missing | It falls outside the selected day, or its status is filtered out | Switch to **Week** or **Custom**, then set **Status** to **All** |
| The **Filter** button reads **Filter (1)** but the panel looks untouched | The **From** and **Until** hour boxes in the day picker are still set | Open the date picker and click **Clear time filter** |
| I cannot tick a row | It is a booking on a linked venue's calendar | Linked bookings cannot be tagged or messaged from here |
| Typing in the search box does not filter the list | It is a client lookup, not a filter | Use **Filter** and the date range instead |
| I cannot find the export | The list does not export | Go to **Settings → Reports** |
| **Cancel** or **No-Show** is not offered | The booking is already cancelled, completed, or marked no-show, or the grace period has not passed | Reopen a completed booking first, or wait for the grace period set under **Settings → Profile** |

## Next steps

- [Using the Appointment Calendar](/help/appointments/appointment-calendar)
- [Taking a booking](/help/getting-started/new-booking)
- [Deposits, full payments, card holds, and refunds](/help/appointments/deposits)
- [Reports, exports, and the Clients directory](/help/appointments/reports)
`.trim(),
};
