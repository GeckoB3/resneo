import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: "take-a-booking-in-the-app",
  title: "Taking a booking in the app",
  description: "Walk through the booking form on your phone: pick services, choose a person or Any available, find a time, take the guest's details, decide about a deposit, and confirm.",
  tags: ["app","mobile","new booking","walk-in","deposit","card hold","waitlist","group booking","classes","events","resources"],
  verified: '2026-09-12',
  content: `# Taking a booking in the app

The booking form is the same wherever you start it: the round **+** button on the **Calendar** or **Appointments** tab, an empty slot in the diary, or **Rebook** on an existing booking. It asks one thing per screen, with a progress bar along the top telling you which step you are on.

The arrow in the top left goes back a step. The cross closes the form and throws the booking away.

## Before you start

- Your services, calendars and working hours need to be set up on the web first. See [Adding your services](/help/getting-started/services) and [Business and calendar hours](/help/getting-started/business-and-calendar-hours).
- If the diary slot you tapped had a date, a time and a calendar, the form starts with all three filled in and you can skip ahead.

## Step 1: Choose the booking type

If your venue runs more than appointments, tabs across the top let you pick: **Appointments**, **Classes**, **Events** and **Resources**. Most of this article follows the **Appointments** tab, which has the most to it. The others are covered at the end.

## Step 2: Choose the service

**Choose a service** lists everything you offer, grouped by category if you use them, with a price and a length on each row. Once you have more than a handful, a **Search services** box appears at the top.

Three things you can do here:

- **Tap one service** to carry straight on.
- **Tick several services** for one visit. As soon as you tick one, a bar appears at the bottom with the count, the total length and the price from. Tap **Continue** when you have them all, or **Clear** to start again. A visit can hold up to four services, and the bar tells you when you have reached the limit.
- **Change the length just this once.** The small pill on the right of a row shows the service's usual length in minutes. Tap it to open **Custom duration**, pick one of the preset chips or use **Fine-tune** to nudge it up and down, then tap **Done**. **Reset** puts the service's normal length back. As the panel says, this applies only to this booking.

Under the list, **Book for a group** switches to the group flow, described further down.

## Step 3: Options and add-ons

Some services then ask a follow-up:

- **Choose an option**, where a service has several bookable options, each with its own length and price.
- **Add-ons**, where a service has extras attached to it. Pick what the guest wants and tap **Continue**.

If you ticked several services, the app walks you through each one's options and add-ons in turn, on a step called **Options**.

## Step 4: Choose who it is with

**Choose a practitioner** lists everyone who does that service, with their own price and length.

Where your venue has turned it on and you have more than one person doing the job, the list also offers **Any available**. Pick it when the guest does not mind who they see, and ResNeo works out who is free.

Some venues ask this the other way round, starting with **Who is it with?** before any service is chosen. That is the staff-first setting, described in [Booking by staff member first](/help/getting-started/staff-first-booking).

## Step 5: Pick a date

A month calendar shows which days have space. Use the arrows to move month by month, tap a day, then tap **Continue**.

On a walk-in, a **Start Now** button sits above the calendar. It skips the date and time entirely and starts the appointment at this minute.

## Step 6: Pick a time

**Choose a time** lists the open slots for that day, grouped by part of the day. Tap one and then **Continue**.

If there is nothing free you get **No times available**, with a **Join waitlist for this date** button. Adding the guest to the waitlist means they get offered the slot if one opens up. See [Using the waitlist](/help/getting-started/waitlist).

Now and then a warning appears saying one or more team members could not be checked and some times may be missing. Tap **Try again** rather than assuming the list is complete.

## Step 7: Review a multi-service visit

If you picked several services, **Review your services** shows them in order with the total length and price, so you can check the running order before you take any details. **Change services** takes you back to the list with your ticks still there.

## Step 8: Take the guest's details

On **Guest details**:

1. If you tapped **Walk-in** to get here, a **Booking type** switch at the top shows **Phone** and **Walk-in**. It starts on the right one, and you can change it.
2. **Find an existing guest** searches your contacts by name or phone. Pick someone and their details fill in, so you are not typing a regular's number every time.
3. Otherwise fill in **First name**, **Surname**, **Email** and **Phone**. The phone field has a flag and dialling code beside it: tap that to pick another country, then type the number as it is written locally. Some venues also collect an address.
4. **Comments or requests** is for anything the guest mentions: access needs, preferences, running late.
5. Tap **Continue**.

**None of the contact details are required**, on any staff booking, not just a walk-in. Somebody on the phone in a hurry can be booked in with a name alone. The fields say what is lost without them: no email means no confirmation, and no phone means no text reminder.

## Step 9: Decide about money, then confirm

**Review & confirm** lists the service, the date, the time, the guest, and a **Total**.

Two controls may appear underneath, depending on the service:

- **Require deposit** (or **Require payment** where the service is paid in full). It is **off** by default, because you may want to take the money at the counter. Tick it and ResNeo sends the guest a payment link and holds the booking until it is paid. Leave it unticked to confirm now and collect in person. It is never offered on a walk-in.
- **Card hold**, shown where the service carries a no-show fee. It is **off** by default, the same as the web dashboard. The line under the switch follows it: turned on, the guest gets a link to add their card, charged only if they do not show, and the booking is cancelled if no card is added within 24 hours; left off, no card is taken and a no-show cannot be charged. No money is taken at the time either way.

The summary shows these as separate lines, **Deposit** (or **Pay now**) and **No-show fee**, so you can see exactly what is being asked for.

Tap **Create booking** to finish, or **Create visit** where you booked several services.

The confirmation screen says **Booking confirmed** with the guest, the date and the time, and offers **View booking** and **Book another**.

## Booking a group

**Book for a group** on the service step opens **Group booking**, for several people coming in together.

1. Tap **Add the first person**, give them a name on **Who is this for?**, and pick their service.
2. Repeat with **Add another person**. You can book up to ten people in one group.
3. The panel keeps a running **Total**.
4. Tap **Continue to organiser details** and fill in the contact details of the person who booked.
5. Review and confirm as usual.

**Switch to single booking** takes you back if you started a group by mistake.

## Classes, events and resources

The other tabs work the same way, with fewer steps.

**Classes**: **Class**, **Date**, **Session**, **Guest**, **Confirm**. Choose a class, pick a date, then pick a session, which shows how long it runs and how many places are left. Where more than one place is free, a **Spots** counter lets you book several people onto the same session.

**Events**: **Event**, **Date**, **Tickets**, **Guest**, **Confirm**. Choose an event and a date, then **Select tickets**, adding however many of each ticket type the guest wants. A running **Total** sits under the list.

**Resources**: **Resource**, **Date**, **Length**, **Time**, **Guest**, **Confirm**. Choose the resource, the date, how long they need it for, and a start time. You can also start this one straight from the diary: tap a slot on a column that hosts a resource and choose **Book** followed by the resource's name.

## Walk-ins

A walk-in is somebody in front of you now.

1. Tap the round **+** button and choose **Walk-in**, or tap the slot they should go in and choose **Walk-in** there.
2. Pick the service and the person as usual.
3. On the date or time step, tap **Start Now** to begin immediately. If you tapped a slot to get here, the form is already set to that time instead.
4. Fill in as much of the guest's details as you have. Name, email and phone are all optional for a walk-in.
5. Confirm.

Walk-ins never ask for a deposit or a payment up front. You take the money at the counter, from the booking screen.

## Common problems & fixes

- **"No services available".** Your venue has no active services, or nobody is set up to do them. Both are fixed on the web. See [Adding your services](/help/getting-started/services).
- **A service will not tick.** You already have four services on the visit, which is the most one visit can hold.
- **"Any available" is missing.** It only appears when your venue has that setting turned on and more than one person does the service. See [Optional booking features](/help/getting-started/optional-booking-features).
- **No times on a day you know is open.** Check the person you picked is working that day, and that the service fits the gap. A long service or a multi-service visit needs one unbroken block.
- **The date step will not load.** Tap **Try again**. On a walk-in, **Start Now** still works, because it does not check availability at all.
- **You cannot find the deposit tick box.** It only appears when the service actually has a deposit or a price to collect, and never on a walk-in.
- **The booking was refused because of compliance.** The guest needs a form or a record before this service can be booked. Collect it or send the form, then try again. See [Compliance records](/help/getting-started/compliance).
- **Nothing saves.** Check for the offline banner at the top of the screen. The app does not queue changes while you have no connection.

## Next steps

- [Finding and updating bookings](/help/resneo-app/bookings-in-the-app)
- [The diary on your phone](/help/resneo-app/diary-on-your-phone)
- [Taking payments in the app](/help/resneo-app/payments-in-the-app)
- [Taking a booking on the web](/help/getting-started/new-booking)`,
};
