import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: "dashboard-overview",
  helpSection: "gs-start-here",
  verified: '2026-09-06',
  title: "A tour of your dashboard",
  description: "A quick tour of your dashboard sidebar, so you can find any tool in a couple of clicks.",
  tags: ["dashboard","navigation","sidebar","roles","admin","staff","home","booking page"],
  content: `# A tour of your dashboard

Your dashboard is where you run the business: today's bookings, your calendar, your clients, and every setting. This tour walks the sidebar top to bottom so you always know where to click.

:::help-video dashboard-tour

> **Before you start:** this describes the dashboard you see once setup is finished. If signing in still drops you into the setup wizard, work through that first. See [welcome to ResNeo](/help/getting-started/welcome).

## Start on Home

**Home** is the first link in the sidebar and the screen you will look at most. Top to bottom it shows:

- A greeting (**Good morning**, **Good afternoon**, or **Good evening**) with today's date, and two buttons: **Calendar** opens your day grid, **All appointments** opens the full list.
- The **What's next** setup card, if you are an admin and setup is not finished. It hides itself once every step is done, or when you dismiss it.
- Three tiles: **Appointments today**, **Confirmed** (how many of today's clients have confirmed), and **Next up** (the time of your next appointment).
- A **Today by booking type** row with a count for each booking type you sell. If you sell classes, events, or resources, a **Today at a glance** row also adds **Classes today**, **Event tickets today**, and **Resource bookings today**.
- Occasional notes in a coloured box: a yellow warning for admins while public bookings are off because no service is active and linked to a calendar, and blue notes for pending appointments awaiting payment or for an empty day tomorrow.
- **7-day appointments**: a chart of how many appointments are booked on each of the next seven days.
- **Today's appointments** under the heading **Diary**: every booking for today in time order, with the client's name, its status, and whether a deposit has been paid. Click **View all** for the full list. Only the first ten are listed; a **view all** link at the foot of the card covers the rest.

If today is empty you will see "No appointments today". That is normal on your first day. If you signed up with a referral code, a green note at the top of Home reads **Your referral month is active** while your extended trial runs.

## On a phone or tablet

On a small screen the sidebar is tucked away. Tap the menu button at the top left, next to the ResNeo logo, to slide it out, then tap any link. The menu closes itself once you choose. Tap outside it, or press Escape, to close it without going anywhere.

The links are exactly the same as on a computer, so everything below applies either way.

## The sidebar, link by link

:::help-figure dashboard-sidebar

1. **Home**: the screen above.
2. **Appointments**: every booking in one filterable list. Once you switch on classes, events, or resources, this row is renamed **Bookings**. See [using the bookings list](/help/getting-started/bookings-list).
3. **Appointment Calendar**: your day, week, or month as a grid, one column per calendar. See [using the calendar](/help/getting-started/calendar).
4. **New Appointment**: book a client in yourself, for phone and walk-in bookings. This is renamed **New Booking** alongside the row above. See [taking a booking](/help/getting-started/new-booking).
5. **Contacts**: your client list, with history, notes, and tags. See [your contacts](/help/getting-started/contacts).
6. **Compliance**: patch tests, consent forms, and anything a client must complete before an appointment. Only appears once compliance records are switched on. See [compliance](/help/getting-started/compliance).
7. **Services**: what clients can book, with lengths and prices. See [set up your services](/help/getting-started/services). If you sell them, **Classes**, **Events**, and **Resources** sit directly below it.
8. **Waitlist**: clients waiting for a slot that is not free yet. Only appears once the waitlist is switched on. See [using the waitlist](/help/getting-started/waitlist).
9. **Calendar Availability**: four tabs in one place. **Calendars** is where you add a bookable column for each person or chair (admins only). **Availability** sets the hours each calendar can be booked. **Breaks** blocks out lunch and gaps. **Closures** blocks out days off and other time away. See [business and calendar hours](/help/getting-started/business-and-calendar-hours).
10. **Settings**: everything about your venue, admins only.
11. **Your Booking Page**: opens your public page in a new tab, exactly as clients see it.

If your venue belongs to a combined booking page shared with another ResNeo business, **Your Booking Page** is replaced by a link named after that page, ending in **(combined)**. That is the page to send clients to. See [link with another venue](/help/getting-started/linked-venues).

> **Good to know:** the sidebar changes with what you sell. Links for classes, events, resources, the waitlist, and compliance only appear once those features are switched on, so a simple salon sees a shorter list than a busy clinic.

At the very bottom sits a card with your venue name, your own name, and your email, then a **Support** row for contacting the ResNeo team and a **Sign out** button. Next to **Support** is a button that expands ResNeo to fill the screen (**Enter Full Screen**), which is handy on a front-desk tablet. Admins whose venue is linked with another venue also see a **Notifications** bell there for activity on that link.

## Banners across the top

Some messages appear as a coloured strip across the top of whatever page you are on. Each one starts with a small label:

- **Billing** (red): a payment failed, or on Light your free period has ended with no card on file. Admins get **Update billing** (**Add payment method** on Light); team members get **Contact admin**, which opens the Support page. While this strip shows you cannot save changes in the dashboard, and on Light your booking page is paused too.
- **Subscription ended** (amber): editing and online booking are paused on every plan until an admin clicks **Resubscribe**. Team members see **Contact admin**.
- **Announcement**, **Important**, or **Critical**: notices from ResNeo about the product, with a title and a short message. Click the **X** on the right to dismiss one. ResNeo remembers that for you on every device, but each person on your team dismisses their own.
- **ResNeo support** (blue): shows while someone from the ResNeo support team is signed in to your venue to help. It names them, notes that they can see your data and make changes, and shows the reason on file. Support sessions expire on their own: a dark strip at the very top shows when, and the support person can extend it by 60 minutes or end it early from there.
- **Linked accounts**: another venue wants to link with yours, or has proposed a change to an existing link. Admins get **Review request** or **Review change**, and **Dismiss for 24h**.
- **Waitlist**: a slot has opened that matches someone on your waitlist. Use **Offer appointment**, **View waitlist**, or **Dismiss**.

Deal with billing and subscription strips first. Everything else can wait.

## What your team sees

:::help-figure dashboard-roles

Team members see almost the whole sidebar: Home, the appointments list, the calendar, new bookings, contacts, your services, and whichever of compliance, waitlist, and calendar availability you have switched on. What they do not get is the setup card, the notifications bell, the full **Settings**, or anything to do with your plan and billing. In place of **Settings** they see **Account**, which opens **Account settings**: a **Your profile** card with their **Display name**, **Sign-in email**, and **Phone**, and a **Password** card for changing their password.

## Inside Settings

**Settings** is grouped into tabs: **Profile**, **Business hours**, **Booking Settings**, **Booking Page**, **Plan**, **Payments**, **Communications**, **Compliance**, **Staff**, **Reports**, **Refer & Earn**, and **Linked Accounts**.

Admins normally see all twelve; **Refer & Earn** only appears while the referral programme is open. Team members do not see these tabs at all, because their **Account** link opens their own details only. Your booking page address lives on the **Booking Page** tab, under **Booking page address**.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| I cannot see the sidebar | You are on a phone, a tablet, or a narrow window | Tap the menu button at the top left, next to the logo |
| There is no setup card on Home | You are staff not admin, setup is finished, or you dismissed it | Only admins see it, and it hides itself once every step is done |
| **Your Booking Page** is missing | Your booking page has no address yet, or your venue is on a combined booking page | Open **Settings**, then **Booking Page**, and set **Booking page address**. On a combined page, use the sidebar link ending in **(combined)** instead |
| A sidebar link I read about is missing | That feature is not switched on for your venue | For classes, events, resources, and the waitlist, open **Settings**, then **Booking Settings**. For **Compliance**, use the **Compliance** tab |
| I see **Account** instead of **Settings** | You are signed in as a team member | Ask an admin to make the change, or to promote your account |

## Next steps

- [Your go-live checklist](/help/getting-started/setup-checklist)
- [Set up your services](/help/getting-started/services)
- [Using the calendar](/help/getting-started/calendar)`,
};
