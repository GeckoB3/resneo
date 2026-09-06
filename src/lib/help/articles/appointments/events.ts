import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: 'events',
  helpSection: 'operations',
  title: 'Ticketed events',
  description:
    'Create one-off, weekly, or custom-date events, price your ticket types, run the door with the attendee list, and duplicate, cancel, or delete an event safely.',
  tags: ['events', 'tickets', 'capacity', 'attendees', 'door', 'stripe'],
  verified: '2026-09-06',
  content: `
# Ticketed events

A ticketed event is a dated occasion clients buy a place at: a masterclass, an open evening, a tasting. You set the date, one overall capacity, and one or more ticket types.

**Who can do this:** admins can create any event. A team member needs at least one calendar assigned before **+ Create event** appears, and must put the event on a column they manage. Only admins can add calendar columns or cancel an event with guest notifications.

**What this covers:** switching events on, creating and scheduling one, ticket types and payment, running the door, duplicating and cancelling, and where events appear elsewhere in ResNeo.

:::help-figure schedule-models

## Before you start

1. Switch events on. Open **Settings → Booking Settings** and, in the **Booking models** card, tick **Ticketed events**. Until you do there is no **Events** row in the sidebar. Model links sit just after **Contacts**.
2. Connect Stripe if you want to sell tickets online, and finish every step. See [Deposits, full payments, card holds, and refunds](/help/appointments/deposits).

Open **Events** from the sidebar (\`/dashboard/event-manager\`). The page is headed **Event manager**, with the subtitle "Create ticketed experiences, manage capacity, and review attendees." The header also holds **Search events** and, once your public booking address is set, **Copy booking link**.

There is no limit on how many events you can create, on any plan.

## Step 1: Choose how often it runs

Click **+ Create event**. The **Schedule** choice sits at the top and only appears while you are creating, never when you edit later:

- **One date** asks for a **Date**.
- **Weekly (same weekday)** asks for a **First occurrence** and a **Repeat until** date, then tells you how many events will be created, every 7 days.
- **Custom dates** gives you a **Dates** picker: choose a day, click **Add date**, repeat. Chips show what you have added, with an x to remove one. Past dates and duplicates are refused as you type.

Weekly and custom create one event row per date, each with the same ticket setup, and each editable on its own afterwards. A single run creates at most 104 dates.

## Step 2: Fill in the event

- **Event name**, then **Start time** and **End time**.
- **Capacity** is the ceiling for the whole event, however many ticket types you add.
- **Guest booking rules**: **Max advance (days)** (1 to 365, starting at 90), **Min notice (hours)** (0 to 168, starting at 1), **Cancellation notice (hours)** (0 to 168, starting at 48) and **Allow same-day bookings**. Cancellation notice is the one that decides whether a client gets their money back.
- **Calendar column**: pick a **Calendar** so the event shows on your dashboard calendar and blocks that time. Leave it on **Not assigned to a calendar** and only admins can change or remove it later.
- **Description** and **Image URL**, both optional. The image is a web address for a picture already online, not an upload, and a **Preview** appears once the address works.

Admins creating a new event also see a **Who can manage this event later** note: staff linked to the column you choose can create, edit or delete it, and if you leave it unassigned only admins can.

## Step 3: Set your ticket types and payment

Every event starts with a **General Admission** tier.

1. Set the **Ticket name**, the **Price (£)** and an optional **Cap** for that tier. Leave the cap blank for no limit of its own; the event **Capacity** still applies.
2. **+ Add ticket type** adds another, for example adult and child pricing. **Remove** appears once there is more than one, because at least one tier must remain.
3. Choose one **Online payment (Stripe)** option:
   - **None - pay at venue or free event**
   - **Deposit per person (partial payment online)**, with **Deposit amount (£)**
   - **Full payment online (per ticket)**
   - **Card hold**, which takes no money at booking but stores the card, with **No-show fee per person (£)** of at least £1
4. Click **Save event**.

Deposit and full payment need every ticket priced above zero and a connected Stripe account. If a tier is still free the save is blocked and the message names it.

> **Warning:** the form only warns you when no Stripe account is connected at all. If your setup was started but charges are not enabled yet, the warning disappears and guests hit a payment error at the last step with no booking made. Finish every step under **Settings → Payments**, including **Complete identity verification**, before you sell tickets.

## Step 4: Run the event on the day

Events are listed under **Upcoming** and **Past**, split by today's date. Each card shows the name, the date and time, the description, a capacity pill, an **Inactive** pill when it has been cancelled, and a pill per ticket type with its price and cap. Click the card to open the detail panel underneath.

**Sales & capacity** gives you **Tickets sold**, **Revenue**, **Seats taken** out of capacity, **Fill** as a percentage with a bar, and a **By ticket type** breakdown. Cancelled and no-show bookings are excluded, so the figures match money actually taken and seats actually held.

**Attendees** lists everyone who has booked, with their name, email and phone, their ticket lines, the quantity, a status pill and the time they arrived.

- **Arrived** marks someone in; **Clear** undoes it. The buttons only show for bookings that are **Pending**, **Booked** or **Confirmed**.
- **Export CSV** appears once at least one person has booked. It carries Guest, Email, Phone, Qty, Status, Deposit_pence, Ticket_lines and Arrived_utc.
- Click any attendee row to open the full booking, where deposits, messages and notes live. See [Managing the appointments list](/help/appointments/managing-appointments).

## Duplicating, cancelling, and deleting

These three are different, and only one of them can be undone.

- **Duplicate** reopens **Create event** prefilled from this one: the times, capacity, calendar, booking rules, payment rule and ticket types all copy across, the name gains "(copy)", the schedule resets to **One date** and the date is left blank for you to fill in. Nothing is saved until you press **Save event**.
- **Cancel event & notify guests** is admin only and shows only while the event is active. You are asked **Cancel this event?** and told that every active booking is cancelled and guests notified per your refund policy. Confirm with **Cancel event & notify** or step back with **Keep event**. The event then carries a **Cancelled / inactive** pill for good. Use **Duplicate** to put it on a new date instead.
- **Delete** is separate: it asks **Permanently delete this event?** and throws the event row, its ticket types and its settings away. This cannot be undone either.

## Where events appear elsewhere

- **Calendar.** An event blocks its column and opens a panel showing spots taken, how many have arrived, the description, the ticket types and the bookings, with **Open in bookings** and **Event manager** links and a **Book now** button.
- **New Booking.** To sell a ticket yourself, use **New Booking** in the sidebar and switch to the **Events** tab (\`/dashboard/bookings/new?tab=event\`).
- **Your public page.** Guests use the **Events** tab (\`?tab=events\`), which offers **Choose an event** for anything running in the next 3 months. They pick the event, pick a highlighted date, pick a time if you run more than one that day, then set the number of **Tickets** per tier, with each tier showing its price and how many are left, followed by an **Order summary**.
- **Reports.** Under **Settings → Reports**, **Event ticket sales by tier** shows **Tickets sold**, **Ticket revenue** and **Ticket tiers sold**, then a table of ticket type, tickets sold, bookings and revenue, with its own CSV. Figures use the price captured when each ticket was booked, so they stay right after you edit a tier, and cancelled bookings are excluded. Events also appear in **By booking type**. The section only shows when there is data in the date range, and Reports are admin only.

## Calendar columns and plan limits

An event does not have to sit on a calendar, but it should. The column is what puts it on the dashboard calendar, what protects the time, and what decides which team members can edit or delete it.

- Admins get **Add calendar** inside the event form. It creates a column with default weekly hours and selects it for this event immediately.
- Only switched-on calendars count towards your plan: **Appointments Light** includes one, **Appointments Plus** up to five, **Appointments Pro** is unlimited. At the cap the button is replaced with a note linking to **Settings → Plan**.
- Saving is refused with a conflict message when the event time overlaps another appointment, class, resource booking or blocked time on that column.

## Who can do what

| Action | Admin | Team member |
| --- | --- | --- |
| See every event | Yes | Yes |
| Create an event | Yes | With a calendar assigned, on a column they manage |
| Edit or delete an event | Yes | Only when it sits on a column they manage |
| Duplicate an event | Yes | With at least one calendar assigned |
| Mark attendees **Arrived** and export the CSV | Yes | Yes |
| Cancel an event and notify guests | Yes | No |
| Add a calendar column | Yes | No |
| See Reports | Yes | No |

Assign calendars under **Settings → Staff**; see [Team access, roles, and calendar links](/help/appointments/team-management).

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| There is no **Events** row in the sidebar | The ticketed events model is off | Tick **Ticketed events** under **Settings → Booking Settings** |
| **+ Create event** is missing | Your account is not linked to a calendar | Ask an admin to link your account, or to create the event |
| I cannot save a paid event | A ticket type is still priced at zero | Price every tier, or set payment to **None - pay at venue or free event** |
| Saving says the time conflicts | The column already has an appointment, class, resource booking or blocked time then | Move the event, or pick a different **Calendar** |
| Guests get a payment error and no booking | Stripe is started but charges are not enabled | Finish setup under **Settings → Payments** |
| Clients cannot find the event | Events are off, the date is more than 3 months away, or the event was cancelled | Check the model is on and the date. **Cancelled / inactive** cannot be undone: **Duplicate** it to a new date |
| **Export CSV** is not there | Nobody has booked yet | It appears with your first attendee |
| There is no **Arrived** button on a row | That booking is cancelled, completed or already a no-show | Open the full booking to change its status |
| I cancelled an event by mistake | Cancelling cannot be undone | Use **Duplicate** to recreate it, then rebook the guests |
| **Add calendar** is replaced by a message | You have used every calendar your plan allows | Switch an unused calendar off, or upgrade under **Settings → Plan** |
| A weekly run created fewer dates than expected | One run creates at most 104 dates | Create the rest as a second run |

## Next steps

- [Set up ticketed events](/help/getting-started/events)
- [Creating and assigning bookable calendars](/help/appointments/calendar-setup)
- [Deposits, full payments, card holds, and refunds](/help/appointments/deposits)
- [Reports, exports, and the Clients directory](/help/appointments/reports)
- [Your booking page, embed, and QR code](/help/appointments/booking-widget)
`.trim(),
};
