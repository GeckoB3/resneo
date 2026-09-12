import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: "classes",
  helpSection: "gs-catalogue",
  title: "Set up your classes",
  description: "Create reusable class types and put them on real dates so guests can book your group sessions.",
  tags: ["classes","class types","sessions","timetable","rosters","capacity","schedule","check-in"],
  verified: '2026-09-12',
  content: `# Set up your classes

Classes let several clients book the same session at once, such as a weekly beard-care workshop or a beginners' studio hour. You set them up in two stages: first a class type, which is a reusable template, then the real dates people can book.

> A class only shows up for clients once its class type is **Active (visible to guests)** and it has been scheduled onto real dates. A type on its own is just a template, and nobody can book a template.

## Before you start

1. Turn classes on. Open **Settings**, then the **Booking Settings** tab, and find the **Booking models** card. Tick **Classes & sessions**. Until you do, there is no **Classes** row in your sidebar. See [set up your business profile](/help/getting-started/business-profile).
2. Have a calendar ready. Every class runs on a calendar column. Admins can also create one without leaving the class form. See [business & calendar hours](/help/getting-started/business-and-calendar-hours).
3. Connect Stripe if you want to be paid online. See [connect Stripe to take payments](/help/getting-started/stripe-payments).
4. Sign in as an **admin**. Team members can see every class type, but they can only add, edit or remove the ones on a calendar they manage.

> Turning classes on renames two sidebar rows. **Appointments** becomes **Bookings**, and **New Appointment** becomes **New Booking**. Nothing has moved, they just cover more than appointments now.

## Step 1: Create a class type

1. Open **Classes** from the sidebar. The page is called **Class timetable**.
2. Click **+ Add class type**. The **New class type** window opens with four sections.
3. Under **Basics**, fill in the **Name** and an optional **Description**, which guests see on your booking page. Pick a **Colour**, and leave **Active (visible to guests)** ticked. Untick it only to park a class type without deleting it.
4. Under **Session defaults**, set **Duration (minutes)** and **Capacity (spots)**, which is how many people can book one session. Choose the **Calendar column** the class runs on, and add an **Instructor label (optional)** if you want guests to see a person's name instead of the column name. Admins can click **Add calendar column** here to create one on the spot.
5. Under **Guest booking rules**, set **Max advance (days)** (starts at 90), **Min notice (hours)** (starts at 1), **Cancellation notice (hours)** (starts at 48), and whether **Allow same-day bookings** is ticked.
6. Under **Price & online payment**, add a **Price** per person if you charge for the class, then pick one **Online payment (Stripe)** option:
   - **None: pay at venue or free class**
   - **Deposit per person (partial payment online)**, with a **Deposit amount**
   - **Full payment online (per person)**
   - **Card hold**, which takes no money when the client books but saves their card, with a **No-show fee per person** of at least £1 and at most £150 that you can charge later if they do not turn up
7. Click **Save class type**.

:::help-figure classes-type

Deposit and full payment both need a price per person and a connected Stripe account. If Stripe is not connected, the form tells you so under the payment options.

Saved types are listed under **Class types**, each with an **Active** or **Inactive** pill, the duration, the spots, the price, the payment rule and the column it sits on. **Edit** and **Delete** sit on each row. Deleting asks **Delete this class type?** and leaves any dates you already scheduled on the calendar.

## Step 2: Put it on real dates

A class type does nothing until you schedule it.

1. Scroll down to **Scheduled sessions** and click **Schedule classes**.
2. Pick the class type at the top of the window, then tap a day in the **Month view**.
3. Choose how it repeats: **One-off session**, **Weekly repeat** or **Every few days**.
4. Set the **Start time**. The finish time follows the **Duration (minutes)** on the class type.
5. A one-off session can also take a **Capacity override** for that date only. A weekly repeat asks for **Every N weeks** and then **How far to schedule**, either for a number of weeks or **Between dates**. Every few days asks for **Repeat every** so many days and **Stop after** either a **Number of sessions** or an **End date (inclusive)**.
6. Finish with **Add session**, **Schedule classes** or **Create sessions**, depending on the option you chose.

One go can create at most 100 sessions. Ask for more and ResNeo tells you to shorten the range.

:::help-figure classes-schedule

## Step 3: Watch the bookings come in

A summary bar at the top of the page counts your active types, sessions in the next 7 days, upcoming sessions, and booked spots.

**Scheduled sessions** is a month grid of every date you have set. Use **Filter class** to show one class type instead of **All classes**, and click a session in the grid to edit it.

**Upcoming sessions** lists what is coming, soonest first, each row showing how many spots are booked out of the capacity.

- Click a session row to open its roster.
- **Edit** opens **Edit session**, where you can change the **Date**, the **Start time** and the **Capacity override**. You cannot set a capacity below the number already booked.
- **Remove** takes that session off the calendar. You are asked **Remove this session?** first. Bookings already taken stay on file, but they are no longer linked to that class time.
- To add a client yourself, use **New Booking** in the sidebar and choose the **Classes** tab.

:::help-figure classes-timetable

## Step 4: Run the class on the day

Click a session in **Upcoming sessions** and a panel opens on the right with everyone who has booked: guest, contact details, quantity, status, deposit and whether they are checked in.

- **Download CSV** saves the roster as a spreadsheet.
- **Check in all** marks everyone as arrived in one go. It only appears when class packs, courses and memberships are switched on for your venue (**Settings**, then **Booking Settings**, then **Optional Booking features**, then **Class packs, courses & memberships**).
- **Charge no-show fee** shows next to a card hold in the deposit column when someone has not turned up. It is admin only and opens the full booking so you can take the fee.
- **Cancel class & notify guests** is admin only. It cancels that one session and tells everyone who booked, with refunds following your policy.

Class sessions also appear on your dashboard calendar alongside your other bookings. Clicking one there opens the same guest list, and if class packs, courses and memberships are on you get **Check in** and **No show** on each person as well.

## Selling packs, courses and memberships

Prepaid class credits, fixed-session courses and monthly memberships are switched on separately: **Settings**, then **Booking Settings**, then **Optional Booking features**, then **Class packs, courses & memberships**. A **Class products** button then appears at the top of your **Class timetable** page. See [selling class packs](/help/appointments/selling-class-packs), [building a class course](/help/appointments/building-a-class-course) and [selling memberships](/help/appointments/selling-memberships).

## What your clients see

On your public booking page the **Classes** tab asks them to choose a class first, then shows a calendar with your scheduled dates highlighted in green. They pick a date, pick a time if you run more than one that day, choose how many **Spots** they want, then leave their details and pay if you take payment online. Anyone picking several dates at once is asked to sign in, so the bookings and any credits stay on their account.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| There is no **Classes** row in my sidebar | The classes booking model is off | Open **Settings**, then **Booking Settings**, and tick **Classes & sessions** |
| My class type is saved but clients cannot book | It has not been scheduled onto real dates yet | Use **Schedule classes** to put it on the calendar |
| My class is scheduled but clients cannot see it | The class type is not **Active (visible to guests)**, or its calendar column has no hours that day | Open the class type and tick **Active (visible to guests)**, then check the column's hours |
| I cannot lower a session's capacity | More people are already booked than the new number | Cancel a booking first, or set the **Capacity override** to the number already booked |
| I asked for a long run of dates and it refused | One go can create at most 100 sessions | Shorten the date range, or the number of weeks, and repeat |
| **Check in all** is not on the roster | Class packs, courses and memberships are not switched on | Turn them on under **Settings**, then **Booking Settings**, then **Optional Booking features** |
| I cannot find **Class products** | The same setting is off | Turn on **Class packs, courses & memberships** and reload the **Class timetable** page |
| I cannot add a client to a session | The roster does not take new bookings | Use **New Booking** in the sidebar and pick the **Classes** tab |
| I cannot edit a class type | You are a team member and it sits on a calendar you do not manage | Ask an admin, or ask to be linked to that calendar |

## Next steps

- [Using the calendar](/help/getting-started/calendar)
- [Set up your services](/help/getting-started/services)
- [Guest communications (email and SMS)](/help/getting-started/communications)`,
};
