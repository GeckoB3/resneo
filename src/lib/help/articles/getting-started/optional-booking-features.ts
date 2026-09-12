import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: "optional-booking-features",
  helpSection: "gs-set-up",
  title: "Optional booking features",
  description: "The Booking Settings tab: which booking types appear on your page, whether clients must sign in, in-person card payments, and the five optional features.",
  tags: ["booking settings","feature flags","booking models","any available","waitlist","self-reschedule","class packs","settings"],
  verified: '2026-09-12',
  content: `# Optional booking features

One tab decides what your booking page offers and which extra tools you get: **Settings**, then **Booking Settings**. Nothing here is required, and every setting can be changed back.

Open **Settings** from the sidebar and click the **Booking Settings** tab. It is described as "Active booking models, guest sign-in requirements, and optional appointment features", and it holds three groups:

1. **Models on your public page**, which is what clients can book.
2. **Taking payment in person**, for card payments at your counter.
3. **Optional Booking features**, five switches for extra behaviour.

## Before you start

- You need an admin login. **Booking Settings** does not appear for team members, whose sidebar shows **Account** instead of **Settings**.
- Everything on this tab saves on its own. There is no Save button to hunt for.
- Changes reach a booking page that is already open only when it is reloaded.

## Step 1: Choose which booking types appear on your page

The first card is **Booking models**. Your Appointments plan includes all four, so this is only about which ones you actually use. Tick the ones you want:

- **Appointments & services**: "Take bookings against calendars, people, or rooms with services and durations."
- **Ticketed events**: "Sell tickets for dated events from your public page."
- **Classes & sessions**: "Recurring or one-off classes with timetables and rosters."
- **Resources & facilities**: "Bookable rooms, courts, or equipment by time window."

A ticked type shows a **Set up →** link that takes you to the tool for it. Untick one and its tab comes off your booking page and its tools leave your dashboard. You cannot untick everything: at least one type stays on.

The line under the list tells you where the save is up to, from "Changes will save automatically in a moment." to "All booking type changes are saved."

> **Good to know:** most appointments businesses only ever tick **Appointments & services**. Add the others when you have something to put in them, otherwise your booking page grows tabs with nothing behind them.

## Step 2: Decide whether clients need a ResNeo account

Under the same group sits **Require ResNeo sign-in to book**. It is off for new venues, which means anyone can book with just their name, email and phone number.

Tick **Require account login for online bookings** and clients have to sign in before they can finish booking with you. On your booking page they see a panel saying "ResNeo account required to book" with a **Log in or sign up** button. That opens **Continue with ResNeo**, where they can ask for an email link or use a password, and where new clients are told they can enter an email to get a free account with no separate signup and no password.

Manage-booking links in your confirmation emails are not affected. A client who booked before you turned this on can still open their booking from the email as usual.

> **Warning:** this adds a step to every booking. It is worth it when you need to be sure who is booking, and it costs you bookings when you do not.

## Step 3: Taking payment in person

The **Taking payment in person** group holds one card, **Take card payments at your venue**. It lets your team collect an appointment's outstanding balance at your counter from the ResNeo app, by tapping the client's card or phone. The money goes to your own Stripe account and ResNeo takes no cut.

It is off until you tick **Allow in-person card payments from the ResNeo app**.

- Connect Stripe first. Without it, an amber note says the setting has no effect and points you to **Settings**, then **Payments**.
- Your team also needs the ResNeo app on a suitable phone: an iPhone XS or newer on iOS 16.4 or later, or an Android 11 phone or newer with NFC. It is being rolled out gradually, so it may not appear straight away.
- Taking payment stays your team's choice, appointment by appointment. Turning this on never forces anyone to collect, and an appointment can still be completed with a balance outstanding.

## Step 4: The five optional features

The last card is **Optional Booking features**, described as "Optional tools for your booking flow". Each row is a switch. Click one and it saves at once, confirming with **Setting saved.**

Four of the five start off. **Guest self-reschedule** is the exception and starts on.

### Any available practitioner

Off to begin with. It lets clients and your team book the next free slot without naming a person, so the times on offer are everyone's times added together.

When it is on, clients see an extra **Any available** card, with "First available time across the team" underneath, alongside your named people. It only appears when more than one calendar offers the service they picked.

Switching it on opens **Who gets the booking?** just below, which decides who ends up with a booking when several calendars are free at the same moment:

- **Priority order**: "Use the first calendar in your list that is available at that time."
- **Random**: "Each booking is assigned to a random available calendar at that time."

Choose **Priority order** and a numbered **Calendar priority** list appears, with **Up** and **Down** buttons on each row. The top of the list is checked first. If you have no active calendars yet, a note asks you to add them under Calendar availability before setting an order.

> **Good to know:** **Priority order** keeps a senior person busy first. **Random** spreads the work evenly. Neither changes the times clients are shown, only who gets the booking.

### Staff-first booking

Off to begin with. It swaps the first two steps of your booking page around, so clients choose who they want to see before they choose a service. Each person shows as their **Meet the team** photo and name.

This one has its own article: [let clients choose their person first](/help/getting-started/staff-first-booking).

### Guest self-reschedule

**On unless you turn it off.** It is the only one of the five that starts on.

With it on, a client can move their own appointment from the link in their confirmation email, using **Change appointment** (or **Change session** for a class, **Change slot** for a resource). Deposit refunds when they cancel still follow your cancellation notice rules.

Turn it off and that button disappears. Clients instead see "Need a different time?" and a line telling them your venue does not offer changes online, with your phone number if you have one on your profile. They can still cancel online, and you can still move anything yourself from your dashboard.

### Appointment waitlist

Off to begin with. It lets clients join a waitlist when you are fully booked, for the date, time, calendar and service they wanted, and it adds **Waitlist** to your sidebar.

Turning it on reveals **When a slot opens** with three choices: **Staff choose**, **First in line**, and **Offer to all**. ResNeo also confirms that guests are notified by email, and points you at **Settings**, then **Communications**, then the **Waitlist invites** section for SMS and the wording.

The full picture is in [using the waitlist](/help/getting-started/waitlist).

### Class packs, courses & memberships

Off to begin with. It turns on prepaid class buying: credit packs, fixed-session courses and recurring membership plans.

With it on, a **Class products** button appears on your **Class timetable** screen, opening a page with three tabs: **Credit packs**, **Courses** and **Memberships**. Clients see what they have bought in their own account, under **Passes and plans**.

There is an article for each: [selling class packs (credits)](/help/appointments/selling-class-packs), [building a class course](/help/appointments/building-a-class-course) and [selling memberships](/help/appointments/selling-memberships).

## If a switch will not turn off

Very occasionally a switch flicks back on and a red line says the feature is turned on for your account by ResNeo and cannot be switched off in settings. That means it is being held on for your venue rather than by this card. Use the **Support** link in the sidebar and ask us to change it.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| There is no **Booking Settings** tab | You are signed in as a team member | Sign in as an admin, or ask one to make the change |
| I cannot untick a booking type | It is the last one left | Tick another type first, then untick the one you do not want |
| My booking page has not changed | The page was open before you saved | Reload the booking page |
| The **Any available** card never appears | Only one calendar offers that service | Add the service to a second calendar under **Calendar Availability** |
| **Calendar priority** is empty | You have no active bookable calendars | Add one under **Calendar Availability**, on the **Calendars** tab |
| Clients say they cannot change their appointment | **Guest self-reschedule** is off | Turn it back on, or move the appointment for them from your dashboard |
| No **Waitlist** in my sidebar | **Appointment waitlist** is off | Turn it on here, then see [using the waitlist](/help/getting-started/waitlist) |
| The in-person payments tick does nothing | Stripe is not connected | Finish setup under **Settings**, then **Payments** |
| I turned something off and it came back on | It is held on for your account | Use the **Support** link in the sidebar |

## Next steps

- [Your public booking page and embed](/help/getting-started/public-booking-page)
- [Let clients choose their person first](/help/getting-started/staff-first-booking)
- [Using the waitlist](/help/getting-started/waitlist)
- [Connect Stripe to take payments](/help/getting-started/stripe-payments)`,
};
