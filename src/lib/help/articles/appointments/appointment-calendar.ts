import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: 'appointment-calendar',
  helpSection: 'operations',
  title: 'Using the Appointment Calendar',
  description: 'Every control on the grid: Day, Week and Month, the Filter panel, the slot menu, drag rules, and the four detail sheets.',
  tags: ['calendar', 'grid', 'drag', 'filters'],
  verified: '2026-09-08',
  content: `
# The Appointment Calendar in practice

**Appointment Calendar** in the sidebar (\`/dashboard/calendar\`) shows your day as a grid, one column per bookable calendar. This article is the reference for the page: every control, in the order you meet it. If you would rather read a walkthrough first, start with [Using the calendar](/help/getting-started/calendar).

The link only appears when appointments, classes, events, or resources are switched on under **Settings → Booking Settings → Booking models**. Venues that take table bookings alone get **Day Sheet** in its place.

:::help-figure calendar-columns

## Day, Week, and Month

The button on the left of the toolbar shows the view you are in. Click it and choose:

- **Day**: one column per calendar, minute by minute. This is the only view with drag-and-drop, blocked time, and the **Compact** button.
- **Week**: a table with one row per calendar under the **Team** heading and one column per day. Classes and events for that week sit in a strip beneath it.
- **Month**: one cell per day, with a total and a coloured bar for each booking type. Navy is team appointments, amber is events, green is classes, grey is resources, and pale grey is bookings on a linked venue's calendars. Hover a day to read the breakdown and whether you are **Open** or **Closed**. Click a day to open it in **Day**.

The arrows either side of the date step by a day, a week, or a month to match the view. Click the date itself to pick another one. The same panel has **From** and **Until** boxes that set which hours the day grid draws.

**Compact**, in **Day** view only, shrinks the rows so a whole day fits one screen. It also hides the handle for changing a booking's length, so turn it off when you need to make an appointment longer or shorter. ResNeo remembers the setting.

## Columns

Every column is a bookable calendar you created under **Calendar Availability**. Names and order come from there, not from this page.

If another venue shares its calendars with you, its columns sit alongside your own and carry the venue name. You can take a booking on them, but their bookings open read-only, and their slot menu has no **Block time**: blocks belong to the venue that owns the calendar.

## The Filter panel

**Filter** opens one panel with four parts. While anything is set, the button counts it: **Filter (1)**, **Filter (2)**, and so on. Your choices are remembered for that venue between visits.

- **Calendars**: tick **All calendars**, or just the ones you want. A calendar you personally manage is listed as **Mine:** followed by its name.
- **Only calendars working on the selected day** hides columns with no working hours on the date you are viewing. Day view only.
- **Linked venues**: tick **All linked calendars**, or pick columns venue by venue. This part only appears when your venue can link.
- **Status**: **All statuses**, **Pending**, **Booked**, **Confirmed**, **Started**, **Completed**, or **No Show**.

**Reset filters**, at the bottom, clears all four at once.

Beside the toolbar, four counters describe what is on the grid for the range you are viewing: **On grid**, **Booked**, **Confirmed**, and **Completed**. Cancellations and no-shows are left out of **On grid**.

## Search, refresh, and undo

- The magnifier searches every client you have by name, phone number, or email, not just the day on screen. Each result offers **Book** and **View**.
- The circular arrow is **Refresh**. Beside it, a green dot means live updates are running and a yellow one means updates may be delayed while ResNeo reconnects. Nothing is lost either way: press **Refresh** if you want the grid now.
- **Undo** reverses your most recent time or duration change on the grid. It is greyed out when there is nothing to undo.
- **New** and **Walk-in** open the staff booking form. On a phone they shrink to a plus and a person icon.

## Book, block, and move from the grid

Click an empty slot and a short menu opens:

- **New appointment** and **Walk-in**, with that calendar, date, and time already filled in.
- **Resources**, when a room or a chair sits on that column, listing **Book** and the resource's name. That opens the **Book resource** dialog.
- **Block time**, which opens a dialog with **Start time**, **End time**, a **Duration** that updates as you go, and **Reason (optional)**. Click a block later and the same dialog reopens as **Edit block**.

Processing time (a wait where the client stays but you are free, such as colour developing) is free space on the grid. A wait in the middle of an appointment shows as a pale band on its card, and a wait at the end of a service, or after it, is not drawn at all: the card stops where you stop. Click either and the same menu opens, so you can book someone else into that time. The card's details never sit on the wait, and clicking it does not open the appointment it belongs to. A booking taken in that time looks like any other booking. In a visit with more than one service, a wait after the first service leaves a visible gap before the next one.

Buffer time is the opposite: turnover after a service that nobody can be booked into. It is drawn as a grey hatched band marked **Buffer** directly under the card (after any processing that runs on past the service), so you can see why those slots will not take a booking.

Press and hold a card to move it, or its bottom edge to change its length. Whether a card can be dragged depends on the booking, not on your role: **Pending**, **Booked**, **Confirmed**, and **Started** bookings move, while **Completed**, **Cancelled**, **No Show**, and resource bookings stay put. A visit with several services moves as one. Every move and every length change offers to tell the client afterwards, so read the follow-up steps in [Using the calendar](/help/getting-started/calendar) before you rearrange a busy day.

## Detail sheets

What opens when you click depends on what you clicked.

- An **appointment** opens the booking panel. It holds the client's name with **Call**, **Email**, and an icon that opens them in Contacts; the status buttons; **Modify**; **Cancel** and **No-Show**; and the sections **Services in this visit**, **Notes**, **SMS / email guest**, **Compliance**, **Payments**, **Records**, and **Timeline**.
- A **class session** opens **Class session**, with **Bookings & guests**: each guest, their contact details, deposit, and whether they are **Checked in**.
- An **event** opens the event sheet, with **Ticket types** and **Bookings**.
- A **resource booking** opens **Resource booking**, with **Payment** and **Message guest**.

A booking on a linked venue's column opens read-only.

## When to use the list instead

The **Appointments** (or **Bookings**) list is the better tool when you want to sort, filter by **Type**, **Calendar** or **Service**, or tag and message several clients at once. See [Managing the appointments list](/help/appointments/managing-appointments). The calendar is the better tool whenever the shape of the day matters: gaps, overlaps, and who is free at three o'clock.

Neither page exports anything. Every CSV lives under **Settings → Reports**.

## Roles

Anyone who can sign in to the dashboard can open the calendar and work on it. There is no view-only mode and no separate permission for dragging.

A staff member who manages exactly one calendar starts with the grid filtered to it, and can tick **All calendars** in **Filter** to see the rest. Admins start on all calendars. Who manages what is set under **Settings → Staff**.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| There is no **Appointment Calendar** in the sidebar | Every schedule booking type is off | Turn one on under **Settings → Booking Settings → Booking models** |
| The grid says **No calendars yet** | No bookable calendars exist | Add them under **Calendar Availability** |
| A column I expect is missing | It is unticked in **Calendars**, or **Only calendars working on the selected day** is hiding it | Open **Filter** and click **Reset filters** |
| A linked venue's columns are missing | **Linked venues** is set to individual columns, or the link is not active | Tick **All linked calendars** in **Filter**, then check the link under **Settings → Linked Accounts** |
| I cannot drag a card | The booking is **Completed**, **Cancelled**, **No Show**, or it is a resource booking | Reopen a completed booking first. Resource bookings are changed from their detail sheet |
| Nothing has updated for a while | The live dot is yellow, so the connection dropped | Press **Refresh**. It reconnects on its own too |
| The month cells look empty | Nothing is booked, or a status filter is hiding it | Hover a cell to read the day, then clear **Status** in **Filter** |

## Next steps

- [Managing the appointments list](/help/appointments/managing-appointments)
- [Using the calendar](/help/getting-started/calendar)
- [Creating and assigning bookable calendars](/help/appointments/calendar-setup)
- [Working hours, breaks, and closures](/help/appointments/working-hours)
`.trim(),
};
