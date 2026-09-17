import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: "venue-collectives",
  helpSection: "gs-grow",
  title: "Run several venues as one collective",
  description: "Put linked venues on one booking page, with one set of services that the host manages and every venue keeping its own calendars, clients and payments.",
  tags: ["venue collective","combined booking page","multi venue","host","member","parked services","staff bookings only","shared services"],
  verified: '2026-09-17',
  content: `# Run several venues as one collective

A **collective** puts two or more linked venues on one public booking page, so your clients see one business. One venue is the **host**. The host decides which services are on the page and sets their prices, deposits, options, add-ons and forms for every venue. Each venue keeps its own calendars, working hours, clients, bookings and payments.

> **The one big idea:** the host runs the menu, and every venue runs its own diary. A client books a service from the host's menu with a person at one of the venues, and that booking, its payment and the client record belong to that venue.

A collective sits on top of your account links. It does not change them, and leaving or ending a collective leaves every link exactly as it is. If you have not linked yet, start with [Link with another venue](/help/getting-started/linked-venues).

## Before you start

- You need admin access, and every venue needs an active link with every other venue that shares **full booking detail** and **Create, edit and cancel bookings** both ways, with no calendar limits.
- Every venue has to use the same timezone and the same currency, and has to offer appointments. A collective page shows appointments only: classes, events and bookable rooms stay on each venue's own page.
- A venue can be part of one collective at a time.

## Step 1: Create the collective (host)

1. Open **Settings**, then **Linked Accounts**, and scroll to **Venue collectives**.
2. Click **Create venue collective**. **Create a collective** opens in four steps.
3. Read **What a collective is**, type a **Collective name**, and choose the address after \`/book/c/\`. ResNeo tells you whether it is free.
4. Tick the venues to invite. Venues that cannot join are listed too, with the reason, such as **Already part of another collective**, a different timezone or currency, or a venue that does not offer appointments.
5. Read **What changes when** your collective starts, tick the box to confirm, and click **Create and send invitations**.

The page is not live yet. It goes live once an invited venue accepts and at least one calendar offers a service.

## Step 2: Join a collective (member)

1. The invited venue's admins get an email and a bell notice. Open **Settings**, then **Linked Accounts**, and click **Accept invitation** on the collective's row.
2. **Join** walks you through what joining means, your services, and any forms you already use:
   - If you already have a service with the same name as one of the host's, choose **Use my** service (it keeps its calendars and bookings, and takes the host's settings) or **Add** the host's **as a new service**.
   - Your other services are **parked** while you are part of the collective. Nobody can book a parked service, your team included, but bookings already made for it are not changed.
3. Tick the box to agree and click **Join**.

An invitation nobody answers closes after 30 days, with a reminder on day 7. The host can cancel an invitation from the **Venues** tab with **Cancel invitation**.

## Step 3: Put services on the page (host)

Open **Services**. Your services show a **Collective** badge when they are on the page.

- To put a service on the page, switch on **On the** collective **page** on its card, or tick **Show on the** collective **page** when you add a new one. ResNeo sets it up at every venue with your settings.
- When you save a service that is on the page, the change reaches every venue. The message after saving says whether every venue is up to date. If you change your mind within a minute, click **Put it back**.
- A service that is not on the page is **parked** while the collective is live.
- To add a service only another venue has, click **Add from another venue**. It is copied into your services and put on the page, and that venue is asked whether to use its own service for it.

Then choose who offers each service. Under **Calendars that offer this service**, tick calendars at any venue in the collective. **Edit values** sets a price, length, buffer, deposit, colour or name for one calendar, where the service allows it.

> **Tip:** the **Collective** area in the sidebar (shown under your collective's name) has a grid of every service against every venue, a **What needs you** list, a **Venues** tab and a **History** of every change. Use **See what each venue will show** before saving a batch of changes.

## Step 4: What members see and do

Members see the host's services under **From** the host's name. They can open each one with **View** and choose which of their own calendars offer it. Everything else about those services is the host's to change.

- A parked service of your own can be suggested to the host with **Suggest to** the host.
- Each venue still sets its own working hours, closures, calendar hours and clients.
- **Before the appointment** on a service lets each venue add its own note for its own guests, such as where to park.

### Staff bookings only

A service marked **Staff bookings only** can be booked by the team at every venue from the diary, but guests do not see it on the collective page.

## Step 5: The booking page

Open **Settings**, then **Booking Page**. It opens on the collective page, and a switch at the top moves you between that and your own page.

- The host designs the collective page. Its header shows the host's address, phone and opening hours, which are for information only. Each calendar is still only offered when its own venue says it is free.
- While the page is live and at least one of your calendars is on it, guests who visit your own booking page are sent to the collective page, keeping the service, person, date and time they chose. The **Booking Page** tab says whether this is happening, and why not when it is not.
- If your venue also runs classes, events or bookable rooms, your own page keeps those. Its appointments tab links to the collective page instead.
- The host can ask to use a member's own page address for the collective page. Nothing changes until that member's admin clicks **Agree** on their **Booking Page** tab, and the member gets the address back if it leaves.

On the collective page, each person shows the venue they work at, and guests see **You are booking with** that venue before they pay. Their payment goes to that venue, and their confirmation says which collective they booked through.

## Working in the diary

Staff at every venue book for the collective from the diary, and every column opens the collective booking form.

- **Moving a booking to another venue:** drag it onto a calendar at another venue. ResNeo asks **Move this booking to** that venue, then moves it in one step. The other venue gets its own booking at the same price, the booking leaves the first venue's diary, and the client gets one message with the new details.
- A booking with a deposit, card hold or payment, completed forms, or that is part of a visit or group, stays with the venue that took it. ResNeo says why, and you can still move it within that venue.
- If the same person has a calendar at two venues and is already booked at one, whoever books second sees a warning.
- One visit is always with one person, so a multi-service visit is at one venue. A group booking is seen at one venue too.

## Clients and reports

- **Each venue keeps its own client records.** A client who books at two venues in the collective has a record at each, with its own visits, notes and tags. The two records cannot be merged, because each belongs to the venue that took the booking. This is expected.
- **What you can see of other venues comes from your account links**, not from the collective. When you join, you agree that the venues can see each other's clients, bookings and takings through those links. Leaving or ending the collective does not change the links.
- **Reports** name every venue. **Booked revenue** lists each venue's figure in its own row, with a column for the part booked through the collective page, and the export carries the same breakdown.
- On the **Bookings** list, a **Booked through** filter shows the bookings made on the collective page, and each booking's details say **Booked through** and the collective's name.

## Leaving, removing and ending

- **A member leaves** with **Leave** on the collective's row under **Linked Accounts**. It keeps every service, calendar and booking. The host's services become its own to edit, its parked services are bookable again, and its own booking page comes back. A short review afterwards points out anything to check, such as prices, Stripe and online meeting links.
- **The host removes a venue** from the **Venues** tab with **Remove**. The venue keeps everything, as if it had left.
- **The host ends the collective** from the foot of the **Venues** tab with **End** and the collective's name, typing the name to confirm. Every venue keeps its services, calendars, clients and bookings. For 90 days the old address shows a page listing the venues, so clients can still find them.
- **The host can hand over** with **Ask to host** on a member's row. The move happens 14 days after that venue accepts, and every venue is told.

A collective needs at least two venues, so it ends when the last member leaves.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| **Create venue collective** is greyed out | No link is fully open both ways | Open **Edit permissions** on the link and set both directions to full detail and **Create, edit and cancel bookings**, with no calendar limits |
| A venue shows **Cannot join yet** | It is in another collective, uses a different timezone or currency, does not offer appointments, or its plan does not include collectives | Read the reason under its name |
| A member's calendars are missing from the page | The venue has not connected Stripe for paid services, has forms switched off, is still being set up, or its subscription lapsed | The **What needs you** list in the **Collective** area says which |
| A client cannot book one of my services | It is parked because it is not on the collective page | Put it on the page, or as a member, suggest it to the host |
| A booking will not move to another venue | It has a payment, forms, or is part of a visit or group | Move it within its own venue instead |
| My own booking page still shows | The page is not live, none of your calendars offer a service on it, or your services are still being set up | The **Booking Page** tab says which |
| I cannot change my timezone or switch appointments off | Every venue in a collective shares these | Leave the collective first |

## Next steps

- [Link with another venue](/help/getting-started/linked-venues)
- [Services](/help/getting-started/services)
- [Your public booking page and embed](/help/getting-started/public-booking-page)`,
};
