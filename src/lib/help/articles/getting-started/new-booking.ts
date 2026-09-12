import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: "new-booking",
  helpSection: "gs-run",
  title: "Taking a booking",
  description: "Create bookings by hand for appointments that come in by phone, email, or in person.",
  tags: ["bookings","new booking","appointments","guests","contacts","deposits","rebooking","scheduling"],
  verified: '2026-09-12',
  content: `# Taking a booking

Book someone in yourself, for phone calls and walk-ins.

> **Quicker for a regular:** if the caller has been in before, do not start here. Click the magnifier in the toolbar on the bookings list, the calendar, or the day sheet, type two letters of their name, and click **Book** on their row. The form opens with their details already in.

## Before you start

- The sidebar link is **New Appointment**, or **New Booking** once you also sell classes, events, or resources. The page heading always reads New Booking.
- Nothing on the form is compulsory. A name, phone number or email is worth having if you can get it, but the booking goes through without them.
- Nothing saves until you finish. Clicking the sidebar link again part way through clears the form and starts you over.

## Step 1: Pick what they are booking

If you sell more than one kind of thing, choose a tab first: **Appointment**, **Classes**, **Events**, or **Resources**.

Each tab has its own web address, so you can bookmark the one you use most: /dashboard/bookings/new?tab=appointment, and the same with class, event, or resource.

If your venue books as part of a collective, a line under the heading names it, and the form offers every member venue's calendars and the combined services.

## Step 2: Choose the services

1. Under **Select a service**, tick what they want. Tick one service, or several for the same visit.
2. The bar under the list shows how many services are ticked, how long the visit runs, and what it starts from. **Clear** unticks them all. Click **Continue** when the list is right.
3. If a service has options, choose one under **Choose your option**. If it offers extras, pick those under **Add extras to your booking**. ResNeo asks about each ticked service in turn.

:::help-figure newbooking-form

### Give one service longer than usual

A service with no options shows its length in a small pill with a pencil on its row. A service that has options shows the pill on each option instead, on the **Choose your option** step. Click the pill to open **Custom duration**, then pick one of the preset lengths or type into **Other minutes**. **Done** applies it, **Reset** puts the normal length back. It applies only to this booking, never to the service itself.

## Step 3: Choose the person and the time

1. Under **Who would you like to see?**, pick a calendar. Only people who offer every ticked service are listed. If your venue uses **Any available practitioner**, an **Any available** card sits at the top and takes the first available time across the team.
2. Under **Date and time**, pick a day on the month view (green days have at least one bookable time), then a slot. Slots are grouped into **Morning**, **Afternoon**, and **Evening**. With several services, every time shown fits the whole visit back to back.
3. If nothing is free that day, **See someone else** offers the same service with another person.

## Step 4: Check the visit

Every booking passes through **Review your services**, whether it holds one service or four.

1. Each service is listed with its own start time, length, person, and price, with the total duration and combined price underneath. ResNeo works the later start times out from the end of the one before, so the chair time is protected end to end.
2. **Remove** takes a service back out, **Add extras** or **Edit extras** changes the extras on a line, and **Change services** returns you to the list with the same services still ticked.
3. You can put up to four services in one visit.
4. Click **Continue to details**.

## Step 5: Add their details

:::help-figure newbooking-guest

Every field here is optional, so a caller who is in a hurry can still be booked in. They are worth filling when you can: without an email the client gets no confirmation, and without a phone number they get no text reminder.

Above the fields, **Find an existing contact (optional)** searches everyone you have by name, email or phone. Start typing, then click a result and the whole form fills from their record. The same lookup still runs as you type into any of the four boxes underneath, so either way works.

Add anything they mention under **Comments or requests**.

If the service asks for money online, two controls appear above the button:

- **Require deposit** (or **Require payment**) with the amount. It is off to start with: leave it off to confirm the booking now and take the money in person, or tick it to send a payment link and hold the booking until it is paid.
- **Card hold**, which sends the client a link to add their card details so a no-show fee can be charged later. It is **off** to start with: a booking you are taking yourself more often waives the hold than asks for it. The line under the switch says what each position does. Turned on it reads "the guest gets a link to add their card, charged only if they do not show. The booking is cancelled if no card is added within 24 hours." Left off it reads "no card is taken, so a no-show cannot be charged."

## Step 6: Finish

Click **Confirm Booking**, or **Continue to payment** if you asked for money up front. You will see **Booking Confirmed!**, and **Done** takes you back to the bookings list.

## Taking a walk-in

**Walk-in** on the bookings list, the calendar, or the day sheet opens the same form with two differences: no contact details are required (a booking with no name is saved as Walk In), and a deposit is never collected, though a card hold can still be asked for. On the time step, **Start appointment now** fills in today's date and the current time in one click.

## Squeezing a booking in

Tick **Override availability** at the top of the first step when you need to book something ResNeo would not normally offer: a service with a person who does not usually do it, a time outside their hours, or a slot that is already taken. With it ticked:

1. Every active team member is listed, and every active service. A person who does not usually offer the chosen service is marked **Does not usually offer this service**, and the booking is made at the catalogue price.
2. Instead of a slot list you type a **Date** (today or later) and a **Start time**.
3. The review step shows **What this overrides**: outside working hours, over a break, on leave, over another booking, and so on. Nothing in that list stops the booking.

The booking then appears on the calendar like any other, and its timeline shows **Booked with availability override** with the same list. The box is off every time you open the form. It works the same way for a linked venue's calendars when you have full permissions through a collective.

## Rebooking a regular

For "the usual, please", this is the fastest route in ResNeo.

1. Open **Contacts** and find the client.
2. Open the **Guest bookings** section on their record.
3. Click **Rebook** on the visit you want to repeat, under **Upcoming** or **Previous**.

A **Rebook** window opens with their details, the same service, the same person, and the same length already chosen. You only pick a date and a time. **New booking** at the top of their record does the same thing with their details but no service chosen.

The same **Rebook** button sits on every booking in the **Guest bookings** section of an open booking on the bookings list.

> **Note:** anything they asked for last time under **Comments or requests** starts blank on purpose, so an old note never follows them by mistake.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| The tab I want is missing | That booking type is not turned on | An admin can turn it on under **Settings → Booking Settings**, in the **Booking models** card |
| No times are offered | Nobody with that service is working then | Try another day or person, use **See someone else**, or book it from the calendar by clicking the slot you want |
| I cannot finish the booking | A phone number or email was typed but is not valid | Correct it, or clear the box and confirm |
| I cannot tick a fifth service | Four services in one visit is the limit | Take the rest as a second booking |
| The pencil for a longer appointment is missing | That service has options, so the length belongs to the option | Choose the option first, then use its own length pill |
| The client got no confirmation | They have no email address on the booking | Add one, then use **Resend confirmation** from the bookings list |
| They want several people booked together | Group bookings are offered on your public booking page, not on this form | Send them your booking link, or book each person separately |
| They want a slot that is full | The waitlist is joined by clients themselves | Send them your booking link and ask them to join the waitlist from there |

## Next steps

- [Using the bookings list](/help/getting-started/bookings-list)
- [Using the calendar](/help/getting-started/calendar)
- [Your contacts (CRM)](/help/getting-started/contacts)`,
};
