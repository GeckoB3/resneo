import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: 'services',
  helpSection: 'setup',
  title: 'Building your appointment service catalogue',
  description: 'A field-by-field reference for the service form: options, add-ons, processing time, the four online payment modes, booking windows and start times, per-calendar overrides, and each service’s own schedule.',
  tags: [
    'services',
    'catalogue',
    'stripe',
    'variants',
    'options',
    'add-ons',
    'processing time',
    'card hold',
    'no-show fee',
    'booking interval',
    'start times',
    'overrides',
    'categories',
  ],
  verified: '2026-09-06',
  content: `
# Appointment services

Your service catalogue is the list of things a client can book. It feeds your public booking page, the staff booking form, the calendar, and your reports.

Open **Services** in the sidebar (\`/dashboard/appointment-services\`). The page has three tabs: **Services**, **Categories** and **Add-ons**. The tab you are on is kept in the address, so \`?tab=addons\` and \`?tab=categories\` are shareable links.

This article is the reference: what every field does and how the pieces fit together. If you are creating your first service, start with [set up your services](/help/getting-started/services) and come back here for the detail.

:::help-figure service-row

:::help-video services-setup

## Reading a service card

Each card in the **Services** tab is a summary of the whole service.

- Along the top: a colour dot, the duration, a **N variants** pill when the service has options, a compliance pill when forms are attached, and an **Inactive** pill when it is switched off.
- Underneath: a buffer pill such as **+15min buffer**, the price, and one payment pill: **Full payment online**, a deposit amount, **Card hold** (with the no-show fee when you have set one), or **No online payment**.
- **Variants** lists each option with its duration, price and deposit, and marks any you are not offering as inactive.
- **Add-ons** lists each linked group, whether it is required or optional, and the first four options with their extra prices.
- Small pills name the calendars that offer the service.
- On the right, admins get an **Active (visible to guests)** switch that works without opening the form, plus **Edit** and **Delete**.

Drag the grip handle, or use the up and down arrows, to set the order clients see. Services sort inside their category heading.

## The form, in order

**Edit** opens the dialog titled **Edit Service**; **Add service** opens **Add Service**. The fields appear in this order.

1. **Name** and **Description**. Both are shown to clients.
2. **Category** (admins, and only once you have created one). The dropdown starts at **No category**.
3. **Duration (mins)**, 5 to 480, and **Buffer (mins)**, 0 to 120. Buffer is protected time after the appointment; clients cannot be booked into it.
4. **Price (£)**.
5. **How will clients book this service?** (admins): **One fixed offering** or **Multiple bookable options**.
6. **Bookable options**, when you chose the second.
7. **Add-ons** (admins).
8. **Processing time** (admins, and only on a service with one fixed offering).
9. **Online payment when booking**.
10. **Guest booking rules**.
11. **Booking interval & start times**.
12. **Location** (admins).
13. **Colour** and **Active (visible to clients)**.
14. **Optional overrides per calendar** (admins).
15. **Calendars that offer this service**.
16. **When guests can book this service online** and **This service's schedule**.

Steps 3 and 4 disappear once a service uses options, because each option carries its own duration, buffer and price.

## Online payment when booking

Four choices, and only one can apply to a service.

- **No online payment (pay at venue or arrange separately)**. The default. Nothing is taken and Stripe is not involved.
- **Custom deposit (fixed amount online)**. Fill in **Deposit amount (£)**. The client pays that as they book, and the rest at the venue.
- **Pay full price online at booking**. The whole price is charged at the point of booking.
- **Card hold**. No money moves. The client's card is stored securely and you can charge the **No-show fee (£)** later if they do not turn up. The fee must be at least £1.

On a service with options the last two labels change to **Default deposit (£)** and **Default no-show fee (£)**, and are used only when an option leaves its own amount blank.

The deposit and the no-show fee share one field on the service, so switching between **Custom deposit** and **Card hold** keeps the amount you already typed. Read it as a deposit in one mode and a no-show fee in the other.

Choosing any of the three paid modes without Stripe shows the line "Stripe is not connected. Connect your Stripe account in Settings before guests can pay online." Finish **Settings → Payments** first. See [deposits and card holds](/help/appointments/deposits) for what happens after the booking is made.

## Options in depth

**Multiple bookable options** is for one service sold in several shapes: 45, 60 or 90 minutes; short, medium or long hair. Clients pick the option before any times are offered, which is what keeps availability honest: the diary is searched for the length they actually chose.

- Switching to options seeds the first one from what you already typed: duration, buffer, price, deposit and any processing periods carry across, so nothing is lost.
- Switching back asks you to confirm, because every option is removed.
- Each card is headed **Option 1**, **Option 2** and so on, and is marked **Ready** or **In progress**. **Add another option** stays greyed out until every option above has a name, a duration between 5 and 480 minutes, and, when you charge full payment online, a price above zero.
- Untick **Offer this option to clients** to keep an option in the service without selling it. At least one must stay ticked or the service will not save.
- **Remove** deletes an option and is disabled on the last one. To drop options altogether, switch back to **One fixed offering**.
- The headline duration and price on the service card, and anywhere a service is shown without its options, come from the **first option you are offering to clients**. Put your standard option first.

## Add-ons

Add-ons are paid extras a client can bolt on: a beard trim, a treatment, an upgrade. They live in **groups**, and a group is one question with a list of answers.

In the service form, **+ Add group** opens **Add an add-on group** and **Use existing group** links one you have already built. Inside the editor: **Group name** (internal), **Prompt to client** (the question clients see, falling back to the group name when blank), **Selection** as **Pick one** or **Pick multiple**, **Required (client must choose one)** or a **Minimum** and **Maximum**, and **Hide from online booking page (staff-only)** for extras only your team adds. Each option has a name, an optional description, **Extra price (£)** and **Extra minutes** up to 240, and an **Active** tick. Extra minutes are added to the appointment, so a 30 minute service with a 15 minute add-on takes 45.

Groups are shared across your whole business, which has two consequences worth knowing:

- **Edit** on a linked group edits the group itself, so the change reaches every service that uses it.
- **Remove** only unlinks it from this service. The group survives.

The arrows next to each linked group set the order the questions are asked in during booking.

The **Add-ons** tab is the library behind all of this, headed **Add-on library**. It lists every group with its selection rule, its prompt, and a **Used by** row of the services that link to it. **New add-on group** creates one, **Show N options** expands it, and **Delete** removes it, or archives it automatically when past bookings reference it. **Show archived groups** brings archived ones back into view; they are no longer offered to clients.

## Processing time

Processing time is the gap in the middle of an appointment where the client stays put but you are free: colour developing, a mask setting, a treatment resting. Marking it lets ResNeo book someone else into that window.

Click **+ Add processing period** and set **Start (min)**, how far into the appointment the gap begins, and **Length (min)**, at least 5. The bar above shows **Active with client** in blue, **Processing (you are free)** in amber and **Buffer / turnover** in grey, with the **Total span** alongside. Buffer time after the service cannot be used as processing time.

On a service with options, each option card has its own **Processing time** section instead of one for the service. Turning options on carries your existing periods onto the first option, and saving then clears the service-level ones, so set processing per option from that point on.

## Guest booking rules

These four settings only govern what clients can do online. Staff booking is not limited by them.

- **Max advance (days)**: how far ahead the diary opens, 1 to 365. Starts at 90.
- **Min booking notice (hours)**: the shortest warning you accept, 0 to 168. Starts at 1.
- **Cancellation notice (hours)**: 0 to 168, starting at 48. This is the refund line, not a booking rule. Clients who cancel at least this many hours before the start get a full refund of a deposit or online payment, subject to your payment settings.
- **Allow same-day bookings**: on by default.

## Booking interval and start times

**Booking interval & start times** decides *which* times clients are offered. Each service picks one of two modes.

:::help-figure booking-start-modes

**Repeat every few minutes** suits most businesses. Set **Interval (minutes)**, anywhere from 1 to 60, and slots run through the whole day anchored to the top of the hour: 15 gives :00, :15, :30 and :45. If you only want part of each hour, tick **Restrict start times within each hour** and tap the minute marks you want. **Select all** and **Clear** are there for speed. A line underneath always spells out the result, and if you clear every mark, bookings quietly fall back to every interval mark rather than offering nothing.

**Fixed times of day** suits businesses that take a handful of bookings a day at set times. A piano tuner who does four jobs a day might offer 9:20, 11:30, 1:45 and 3:30. Those times do not repeat neatly every hour, so an interval cannot produce them.

To set fixed times:

1. Open the service and find **Booking interval & start times**.
2. Choose **Fixed times of day**.
3. Enter your first time, then use **+ Add a time** for each of the others. **Remove** drops one.
4. Save. Clients now see only those times.

A few things worth knowing:

- Your fixed times still sit inside your opening hours, the calendar's working hours, and any custom schedule. A shorter day simply offers fewer of them.
- If a time is too late in the day for the appointment to finish before you close, it is not offered.
- Times already booked disappear, so four fixed times means at most four bookings a day per calendar.
- If you set two times closer together than the appointment takes, the form warns you and names them. That is fine when a calendar takes more than one client at a time, and a mistake otherwise.
- Blank rows and repeated times are tidied up when you save, and a repeat is only counted once.
- Your interval settings are kept, so you can switch back at any time without setting them up again.

Want different times on different days? Combine the two. Set your fixed times here, then use **This service's schedule** below to shorten the days that need it. Fixed times of 9:20, 11:30, 1:45 and 3:30 with a Saturday window of 9:00 to 12:00 gives you 9:20 and 11:30 on Saturdays, and all four on other days.

## Location

**Location** (admins only) decides which address the client sees in their confirmation and reminder emails.

- **At your venue** is the default and uses your business address.
- **At the client's address** makes the booking form ask every client for their address, saves it to their contact record, and prints their address in their emails instead of yours.
- **Online** adds **Link to the online service** and **Joining information for the client**. Both go into confirmations and reminders. Leave the link blank if you send a personal one separately.

## Per-calendar overrides

Sometimes the same service is not quite the same on every chair. **Optional overrides per calendar** lets you decide which fields a team member may change for their own calendar: **Display name**, **Description**, **Duration**, **Buffer time**, **Price**, **Deposit** and **Colour**. Leave them all unticked and every calendar uses the venue values.

Once you tick something, that team member sees an **Edit your settings** button on the service card. It opens a dialog headed **Your settings:** followed by the service name, showing only the fields you allowed.

- The venue value is printed under each field as **Venue default:**, so they can see what they are departing from.
- Setting a field back to the venue default clears the override rather than storing a duplicate.
- **Deposit** appears as a **Require deposit** switch with the amount underneath. Turning it off removes the deposit for their calendar.
- When someone manages more than one calendar, a **Calendar** dropdown at the top says which column they are editing. Changes apply to that one only.

Overrides only cover the seven fields above. Payment mode, booking rules, start times, add-ons, processing time and the service's schedule are set once for the whole venue.

## Calendars that offer this service

A service is only bookable on the calendars ticked here, so this list decides who offers it.

- **Add calendar** creates a new column without leaving the form: type a **Display name** and click **Create and assign**. It is ticked for this service straight away and starts with the standard weekly hours, which you can narrow later. When your plan has no room left, the button is replaced by a message naming your plan.
- **Calendar availability** is a link across to the full editor.
- A calendar that has since been switched off or is no longer eligible still shows, marked **(not available: calendar inactive or not eligible)**, with **Remove link** to clear it.
- New services start with every calendar ticked. Untick the ones that should not offer it.
- An admin can save a service with no calendars ticked and no warning. It will look correct in your list and no client will ever see it.

You can work from the calendar side instead: **Calendar Availability**, the **Calendars** tab, **Edit** a calendar, then tick services under **Appointment services**. The same service can sit on as many columns as you like.

## When guests can book this service online

Online availability is the overlap of three things: your venue opening hours, the weekly hours of each calendar you ticked, and this service's own schedule. The preview under **When guests can book this service online** draws that result before you save. Staff blocks and one-off calendar changes are not shown in the preview, but they do apply live.

**This service's schedule** (admins only) is the third layer, and it can only narrow, never widen. Tick **Limit this service to a custom schedule**, then add rules:

- **Weekly hours**: the same pattern every week, with **Mon–Fri 9–5**, **Every day 9–5** and **Clear** presets.
- **Specific dates**: tap days on the month grid and give each its own time windows.
- **Date range**: a season with its own weekdays and time windows, set by tapping a start day then an end day.

**+ Add another rule** adds more, and rules combine: a time is bookable if any rule allows it, still inside venue and calendar hours. A **Summary** underneath reads the whole thing back in plain English. A schedule that is switched on with no rules will not save, and the form warns you before you try.

Turning the tick off clears the rules when you save, so a schedule you may want again is worth writing down.

## Categories and order

The **Categories** tab holds your headings. **Add category** creates one, the drag handle and arrows set the order they appear in, **Rename** changes the wording, and **Delete** moves that category's services to **Other services** rather than deleting anything. Whether clients see categories as sections with a menu or as collapsible headings is set on your booking page: see [your public booking page and embed](/help/getting-started/public-booking-page).

## What a team member sees

Team members who are not admins get a shorter form. They can create services for the calendars an admin has linked to their login, and on each card they get an **Offer on your calendars** box with their own columns listed. Calendars are labelled **(your calendar)** or **(view only)**. They cannot edit or delete a saved service, and category, options, add-ons, processing time, location, per-calendar overrides and the service's schedule are all admin only.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| The service is not on the booking page at all | Every calendar is unticked (this saves silently), or it is not **Active (visible to clients)** | Open the service, tick at least one calendar under **Calendars that offer this service**, check the active switch, and save |
| The service shows but has no times | Venue hours, calendar hours and the service's schedule barely overlap, or **Min booking notice (hours)** rules out today | Read the preview under **When guests can book this service online**, then check **Settings → Business hours** and the calendar's own hours |
| Only some options can be booked | An option has **Offer this option to clients** unticked, or is longer than the free gaps in the day | Tick it back on, or shorten it |
| **Add another option** is greyed out | An option above is missing a name, a valid duration, or a price you need for full online payment | Finish the option highlighted in amber, then add the next |
| The service will not save | A deposit is blank or zero, a no-show fee is under £1, full payment is on with no price, no option is offered to clients, a custom schedule has no rules, or the online link is not a valid web address | The message names the exact problem; fix that one field |
| Nothing is charged even though a deposit is set | Stripe is not finished | Complete **Settings → Payments** until charges are enabled |
| Processing time vanished after adding options | Service-level periods are cleared once a service uses options | Set processing time on each option card instead |
| An add-on price changed on other services too | Add-on groups are shared, and **Edit** changes the group everywhere | Build a separate group for the service that needs different pricing |
| An add-on group will not delete | Past bookings used it, so it was archived instead | Tick **Show archived groups** on the **Add-ons** tab to see it; archived groups are no longer offered |
| A team member's price is stuck at the venue value | The field is not ticked under **Optional overrides per calendar** | Tick it, then ask them to use **Edit your settings** on the card |
| A calendar shows **(not available: calendar inactive or not eligible)** | The calendar was switched off or is no longer bookable | Reactivate it under **Calendar Availability**, or click **Remove link** |

## Next steps

- [Set up your services, step by step](/help/getting-started/services)
- [Calendar setup](/help/appointments/calendar-setup)
- [Working hours](/help/appointments/working-hours)
- [Deposits and card holds](/help/appointments/deposits)
- [Your booking page, embed and QR code](/help/appointments/booking-widget)
`.trim(),
};
