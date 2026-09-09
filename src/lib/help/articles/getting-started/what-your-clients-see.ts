import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: "what-your-clients-see",
  helpSection: "gs-set-up",
  title: "What your clients see when they book",
  description: "A walk through the guest side of ResNeo, from your booking page to the confirmation, and the manage, confirm and pay pages afterwards.",
  tags: ["guest experience","public booking","booking flow","group booking","add-ons","manage booking","confirmation","waitlist","clients"],
  verified: '2026-09-09',
  content: `# What your clients see when they book

You spend your day in the dashboard. Your clients never see it. This article walks the other side of the screen, step by step, so you know exactly what happens after somebody taps your booking link.

Nothing here needs setting up. It is a tour, not a task. Where a step depends on a setting, the article says which one and links to the article that owns it.

## Before you start

- Your booking link is under **Settings**, then the **Booking Page** tab. See [your public booking page and embed](/help/getting-started/public-booking-page).
- Open it yourself on a phone and follow along. Everything below is exactly what a client sees.
- Several steps only appear when a switch is on. Those live under **Settings**, then **Booking Settings**, in **Optional Booking features**.

## Step 1: They land on your booking page

Your page opens on the **Book now** tab. Three more tabs appear only if you switched them on: **Services**, **Meet the team** and **About**.

If you take more than one kind of booking, they choose the kind first on **Book now**. You can send them straight to one by adding \`?tab=\` and the type to your link: \`appointments\`, \`classes\`, \`events\` or \`resources\`.

A per-person link, such as \`.../book/sharps-barbers/dave\`, opens the same page with a **Booking with Dave** banner above the steps, and only that person's times.

## Step 2: One appointment, or a group

The first question is **How would you like to book?**, with the line "Choose a single appointment or a group booking for several people." Two cards follow:

- **Book an appointment**, described as "Schedule an appointment for yourself".
- **Group appointment**, described as "Different services for multiple people".

Most people tap the first. The group route has its own section further down.

> **Good to know:** this chooser is skipped for a per-person link and for a link that already names a service, so those clients go straight to the services.

## Step 3: They pick a service, or a person

By default the next screen is **Select a service**. Services are listed with their length and price. Where you have set categories, they are grouped, and with six or more services a **Search services** box appears.

If you have turned on **Staff-first booking**, the order flips: they see **Who would you like to see?** first ("Pick a person to see their services and prices"), then only that person's services at that person's own prices. See [let clients choose their person first](/help/getting-started/staff-first-booking).

Where **Any available practitioner** is on, an extra card sits at the top: **Any available**, "First available time across the team".

## Step 4: Options and add-ons

Two optional screens can follow the service, depending on how you set that service up on the **Services** page.

- **Choose your option** appears when a service is set to **Multiple bookable options**. The note reads "This service has a few variations to choose from. Pick one to continue." Each option shows its own length.
- **Add extras to your booking** (or **Add extras to** the service name) appears when the service has add-on groups. Each group shows your own prompt and how many they may pick: **Pick one (required)**, **Pick one (optional)**, **Pick up to 3**, **Pick at least 1** or **Pick any**. Each extra shows its price or **Free**, and any extra minutes. A bar at the foot keeps a running **Extras total** with a **Continue** button.

See [set up your services](/help/getting-started/services) for where these come from.

## Step 5: Several services in one visit

On **Select a service** your clients tick rather than tap through, so they can book two or three things back to back.

1. As soon as one service is ticked, a bar appears at the bottom of the screen with the count, the total minutes and a "from" price, and the names joined with a plus sign.
2. Under it: "Tick more to book them back to back with the same staff, up to 4.", using whatever word you use for a person.
3. Four is the limit. At four the bar says "That is the most you can book in one visit (4)."
4. **Clear** starts the selection again. **Continue** moves on.

Each ticked service asks its own options and extras in turn, then they pick one start time for the whole visit.

After the time comes **Review your services**, headed "Check your services with Ada, then continue to your details." The card lists every service with its start time, length, who it is with and its price, then **Total duration**, **Combined price** and, where money is due, **Deposit due** or **Full payment due**. Each line has **Remove**, and **Add extras** or **Edit extras**. **Continue to details** moves on.

## Step 6: Choosing a time

If more than one person offers the chosen service, they see **Who would you like to see?** with the note "Choose your preferred staff. Prices shown are what they charge for this service.", again using your own word for a person. **Any available** sits at the top when that feature is on.

Then comes **Date and time**: a month calendar with the line "Green days have at least one bookable time. Select a day to see times." Tapping a green day lists the times below it.

A day with nothing free says **No times available on Thursday 10 September**, then "Try a different date above." In staff-first booking a **See someone else** button appears here too.

> If ResNeo cannot reach your schedule, clients see "We could not check which days are free" with a **Try again** button, rather than an empty month that looks fully booked.

## Step 7: Joining the waitlist

When **Appointment waitlist** is on, a fully booked day also offers a **Join waitlist** button. It opens a short form: **Service**, **Preferred date**, **Who would you like to see?** (**Anyone available** or a named person), **First name**, **Last name**, **Mobile number**, **Email**, and **Preferred time** as either **Any time that day** or **Between specific times** with **From** and **Until**.

They submit and see a green confirmation. Their name appears on your **Waitlist** screen. See [using the waitlist](/help/getting-started/waitlist).

## Step 8: A form to fill in before booking

If a service needs a consultation, patch test or intake record and you collect it in the booking flow, a **Before you book** panel appears on the details step once they have typed their email. Each form is marked **Required** or **Optional**, and a required one has to be saved before they can confirm.

Where a client cannot complete it online, they get a short notice instead, headed **Before you can book online** when it blocks the booking, or **Forms needed for this booking** when it only warns. See [compliance: patch tests, consent and intake forms](/help/getting-started/compliance).

## Step 9: Signing in, if you ask for it

Most venues let people book without an account. If you have turned on **Require ResNeo sign-in to book** under **Settings**, then **Booking Settings**, a panel appears above the booking steps saying **ResNeo account required to book**, with a **Log in or sign up** button.

That opens a dialog headed **Continue with ResNeo** offering **Email link** or **Password**. A **New to ResNeo?** panel at the top reassures first-timers: "Enter your Email to create a free account automatically. No separate signup and no password required." The email route says "Enter the email you want on the booking. We will email you a one-time link to sign in", and the button reads **Email me a sign-in link**. They open the link on the same device and come back to finish the booking. See [signing in](/help/getting-started/signing-in).

## Step 10: Their details, and payment

The details screen shows a summary card of what they are booking, then a **Cancellation policy** panel. With nothing to pay it says **Cancel for free anytime**. With a deposit it states the amount and your refund deadline. With a card hold it says no payment is taken and names the maximum no-show fee.

Then the fields: **First name**, **Surname**, **Email**, **Phone** and **Comments or requests** ("Anything we should know (access needs, preferences, running late, etc.)"). A service you have set to happen at the client's address also asks for **Address line 1**, **Address line 2**, **Town or city** and **Postcode**.

Two tick boxes sit above the button:

- "Sign me up to receive offers and news from this business by email." This is the marketing consent that shows on their record in **Contacts**, and nothing else opts them in.
- "I accept the Website Terms of Use and Privacy Policy." This one is compulsory.

The button reads **Confirm Booking** when nothing is due, **Continue to payment** when a deposit or full payment is, and **Continue** when only a card is being saved.

Money is taken on a Stripe page, never on a ResNeo form. See [deposits, full payments, card holds, and refunds](/help/appointments/deposits).

## Step 11: The confirmation

The last screen is headed **Appointment Confirmed**, with the service, who it is with, the date and the time. Below it:

- "A confirmation will be sent to" their email or phone.
- A **Refund policy** line when a deposit was taken, or "No deposit was taken. You can cancel or change this booking at any time before your appointment (subject to the venue's terms)." when none was.
- A **Book another appointment** button, so somebody booking two things is not sent hunting for your link again.

If a card payment was abandoned, the screen instead says **Appointment not completed**. If their bank is still processing, they see a "processing" heading and are told the confirmation follows.

## Booking for several people

Choosing **Group appointment** opens **Group Booking**, headed "Add each person and their services to build your group booking." It works one person at a time:

1. A **Booking date** field at the top, which every person shares.
2. **Add a person** opens **Who is this appointment for?**, asking for "a name or label (e.g. 'Myself', 'My son', 'Alex')".
3. That person then goes through **Select a service** ("What would Alex like?"), **Choose an option** if there is one, **Add extras for Alex**, **Choose staff** if staff-first is on, and **Pick a time for Alex**.
4. Back on **Group Booking** the person appears as a card with their services, times and prices, and a count such as "2 people added. Add more or continue to checkout." A bin icon removes somebody.
5. **Continue to details** takes one set of contact details for the whole group, above a **Group booking summary** card.

The end screen is headed **Group Booking Confirmed**, and lists every person and time.

## The manage page in their emails

Their confirmation email carries a row of buttons: **Add to calendar**, **Location**, **Visit website** and **Manage**. Where you do not allow changes online the last one reads **Cancel** instead, and a service that happens online adds **Join online**.

**Manage** opens a page of its own, with your venue name and address across the top and tiles for **Service**, **Staff**, **Date**, **Time** and **Status**. Depending on the booking it also shows:

- **Get directions**, or a **Where** panel for an appointment at their address or online.
- **Before your visit**, which is the pre-appointment instructions you wrote on the service.
- **What you told the venue**, repeating their own notes back to them.
- **Forms to complete before your visit**, with a link for each one still outstanding.
- **Deposit paid: £25.00**, or "Add your card details to secure this booking. No payment is taken." with an **Add card details** button, or a line naming the no-show fee once a card is held.
- **Change appointment**, which reopens the booking steps at the date and time, and **Cancel appointment**.
- **Add to Google Calendar** and **Download for other calendars**.
- **Contact the venue** with your phone number and email, and a short **History**.

**Cancel appointment** opens a confirmation that spells out the outcome for that booking rather than quoting a policy: whether they are inside the free cancellation deadline, whether the deposit comes back, and whether a no-show fee could still be charged. The buttons are **Keep appointment** and **Yes, cancel**.

If **Guest self-reschedule** is off, the change button is replaced by **Need a different time?**, telling them you do not offer changes online and giving your phone number. They can still cancel.

Links do not live forever. An old one says **Link expired** or **Link already used**, with "Check your inbox for a more recent email, or contact the venue to resend your booking link."

## The confirm or cancel page

Your **Confirm or cancel prompt** message, if you use it, points somewhere else. The email is headed **Can you still make your appointment?** and carries two buttons, **Yes, I'm Coming** and **Cancel My Appointment**. Both open the same page.

That page shows your venue name and address, tiles for **Date**, **Time**, **Guests** and **Deposit** (either **Paid £25.00** or **Not required**), then the line "Confirm your booking below, or open Manage or cancel to change the time, party size, or cancel."

Three controls follow: **Manage or cancel booking**, **Confirm my booking** and **Cancel booking**. Confirming shows **You're confirmed!**

**Cancel booking** opens **Cancel Booking?**. Where a deposit was paid, a **Deposit Policy** panel states your rule: "Full refund if cancelled 48+ hours before your booking. No refund within 48 hours or for no-shows.", using your own notice hours. With no deposit it simply asks "Are you sure you want to cancel your booking?". The buttons are **Keep Booking** and **Yes, Cancel**.

Turn the message itself on or off under **Settings**, then the **Communications** tab. See [guest communications (email and SMS)](/help/getting-started/communications).

## The pay page

A payment link sent by email or text opens a page headed **Pay your deposit**, or **Secure your booking** when only a card is being saved. It greets them by name, repeats the date, time and address, and shows either **Deposit required** or **No payment is taken today** with the maximum no-show fee.

They finish, and land on **Deposit paid**, **Card saved**, or, if their bank is slow, **Almost done** or **Payment processing**. A refused card says **Payment failed** or **Card not saved**, and asks them to go back and try again.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| A client says your page offered no times | No service is on a bookable calendar, or that calendar has no hours | Check the service's calendars on the **Services** page, then that calendar's hours under **Calendar Availability** |
| They were asked to choose a person and you did not expect it | **Staff-first booking** is on | Turn it off under **Settings**, then **Booking Settings**, in **Optional Booking features** |
| They could not book two services together | They tapped one service rather than ticking, or they were already at four | Four services per visit is the limit, and options and extras are asked per service |
| Nobody joins your waitlist | **Appointment waitlist** is off, so the button never appears | Turn it on under **Settings**, then **Booking Settings** |
| A client was forced to sign in | **Require ResNeo sign-in to book** is on | Turn it off under **Settings**, then **Booking Settings** |
| They cannot change their appointment from the email | **Guest self-reschedule** is off | Turn it on under **Settings**, then **Booking Settings**, or take the change yourself |
| Their booking link says **Link expired** | Manage links are time limited for security | Resend the confirmation from the booking, or send them a fresh link |
| Nobody is opting in to your marketing | The tick box on the details step is the only place a client opts in | Leave it visible, and check **Marketing preferences** on their record in **Contacts** |
| They paid and the booking still says **Pending** | The card payment has not cleared yet | Give it a few minutes, then check the booking's payment status |

## Next steps

- [Your public booking page and embed](/help/getting-started/public-booking-page)
- [Your clients' ResNeo account](/help/getting-started/your-clients-resneo-account)
- [Deposits, full payments, card holds, and refunds](/help/appointments/deposits)
- [Guest communications (email and SMS)](/help/getting-started/communications)`,
};
