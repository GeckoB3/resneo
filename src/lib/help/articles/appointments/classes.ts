import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: 'classes',
  helpSection: 'operations',
  title: 'Classes and timetables',
  description:
    'Switch classes on, build class types, schedule sessions, run the roster on the day, and see how classes use calendar columns, roles, and reports.',
  tags: ['classes', 'timetable', 'roster', 'sessions', 'check-in', 'capacity'],
  verified: '2026-09-06',
  content: `
# Classes and timetables

A class is one session several clients book at once. You build it in two parts: a **class type**, which is the reusable template, and **sessions**, which are the real dates guests book. A type on its own is never bookable.

**Who can do this:** admins manage every class type and every session. A team member can see all of them, but can only add, edit or remove the ones sitting on a calendar column they manage, and needs at least one calendar assigned before they can create anything at all.

**What this covers:** switching classes on, class types, scheduling sessions, the roster on the day, calendar columns and plan limits, and where classes appear elsewhere in ResNeo.

:::help-figure schedule-models

## Before you start

1. Switch classes on. Open **Settings → Booking Settings** and, in the **Booking models** card, tick **Classes & sessions**. Until you do there is no **Classes** row in the sidebar. Model links sit just after **Contacts**.
2. Have a calendar column ready. Every class type must name one. Admins can create one without leaving the class form. See [Creating and assigning bookable calendars](/help/appointments/calendar-setup).
3. Connect Stripe if you want to take money online. See [Deposits, full payments, card holds, and refunds](/help/appointments/deposits).

Open **Classes** from the sidebar (\`/dashboard/class-timetable\`). The page is headed **Class timetable**, with the subtitle "Set up class types, add sessions to the calendar, then manage bookings from your roster."

Above the class list sits a summary bar: **active types**, **sessions (7d)**, **upcoming** and **booked spots**. It only appears once you have at least one class type. Under it, **How this page works** expands into the same three-step workflow this article follows, and team members also see a **Staff access:** note there explaining their limits.

## Step 1: Create a class type

Click **+ Add class type** in the page header. The **New class type** window has four sections.

**Basics**

- **Name** (required) and **Description**, both shown to guests on your booking page.
- **Colour**, which tints the session on your calendar.
- **Active (visible to guests)**, ticked by default. Untick it to park a type without deleting it.

**Session defaults**

- **Duration (minutes)**, from 5 to 480. It starts at 60.
- **Capacity (spots)**, at least 1. It starts at 10.
- **Calendar column** (required): the column the class occupies in the schedule. This is also what decides which team members can manage the type later.
- **Instructor label (optional)**: shown to guests instead of the calendar name, so a column called "Studio A" can read as a person's name.

**Guest booking rules**

- **Max advance (days)**, 1 to 365, starting at 90.
- **Min notice (hours)**, 0 to 168, starting at 1.
- **Cancellation notice (hours)**, 0 to 168, starting at 48. This is the one that decides whether a client gets their money back.
- **Allow same-day bookings**, ticked by default.

**Price & online payment**

- **Price (£)** is optional and is per person.
- **Online payment (Stripe)** offers exactly four choices:
  - **None: pay at venue or free class**
  - **Deposit per person (partial payment online)**, with **Deposit amount (£)**
  - **Full payment online (per person)**
  - **Card hold**, which takes no money at booking but stores the card, with **No-show fee per person (£)** between £1 and £150

Finish with **Save class type**. The form reminds you that "Deposit and full payment require a price per person and a connected Stripe account", and shows a Stripe warning when no account is connected at all.

Saved types are listed under **Class types**, each row showing the colour dot, an **Active** or **Inactive** pill, the duration, the spots, the price, the payment rule and **Column:** followed by the calendar name. **Edit** and **Delete** sit on the row. Deleting asks **Delete this class type?** and warns that existing dated sessions stay on the calendar while no new ones will be generated from that type.

## Step 2: Put the type on real dates

Click **Schedule classes** on the **Scheduled sessions** card. Pick the class under **Class type to schedule**, then tap a day in the month grid and choose how it repeats:

- **One-off session**: one date, one **Start time**, and an optional **Capacity override** for that date only. Confirm with **Add session**.
- **Weekly repeat**: **Every N weeks**, then **How far to schedule**, either a number of weeks or **Between dates**. Confirm with **Schedule classes**.
- **Every few days**: **Repeat every** so many days, then **Stop after** either a **Number of sessions** or an **End date (inclusive)**. Confirm with **Create sessions**.

The finish time follows the **Duration (minutes)** on the class type, so you never set an end time here.

One run creates at most 100 sessions. Ask for more and you get "That would create more than 100 sessions. Shorten the range or number of weeks."

## Watching and adjusting the timetable

**Scheduled sessions** is a **Month view** of every date you have set, with **Filter class** (default **All classes**), **Today**, and arrows for the months either side.

**Upcoming sessions** lists what is coming, soonest first and grouped by date, each row showing the start time, the class name and a booked-of-capacity count. On each row:

- **Edit** opens **Edit session**, where you can change the **Date**, the **Start time** and the **Capacity override**. You cannot save a capacity below the number already booked; the form says so before the save is refused. **Remove from calendar** sits in the same window.
- **Remove** asks **Remove this session?** and names the class, the date and the time. Bookings already taken stay on file but are no longer linked to that class time.

Click the row itself (not **Edit**) to load the roster.

## Step 3: Run the class on the day

The roster opens as a panel on the right, headed with the class name, the date, the times and the duration, plus **Instructor:** when you set an instructor label. Under **Bookings & guests** you get a table of **Guest**, **Contact**, **Qty**, **Status**, **Deposit** and **Checked in**.

Along the top of the panel:

- **Download CSV** appears once at least one person has booked. The file is named \`class-roster-<id>.csv\` and carries Guest name, Email, Phone, Party size, Status, Deposit (pence), Deposit status and Checked in.
- **Check in all** marks everyone as arrived at once. It only appears when **Class packs, courses & memberships** is switched on under **Settings → Booking Settings → Optional Booking features**, and only while somebody is still unchecked.
- **Charge no-show fee** appears in the **Deposit** column beside a card hold that can still be charged. It is admin only and opens the full booking, where the charge itself happens.
- **Cancel class & notify guests** is admin only and shows only while the session is active. You are asked to confirm, then every enrolled guest is notified and refunds follow your policy. The session then shows **Session cancelled**.

## Where classes appear elsewhere

- **Calendar.** Sessions sit as blocks on their calendar column. Clicking one opens the same roster as a small panel, with each booking expanding to show email, telephone, deposit and check-in time, **Open full booking**, and (when class packs are on) **Check in** and **No show** per person. **Download CSV**, **Check in all** and **Cancel class & notify guests** are not there: the panel says "Cancel and CSV export are available on the class timetable" and links across.
- **New Booking.** To add a client yourself, use **New Booking** in the sidebar and switch to the **Classes** tab (\`/dashboard/bookings/new?tab=class\`). The roster does not take new bookings.
- **Your public page.** Guests use the **Classes** tab (\`?tab=classes\`), choose the class first, pick a highlighted date, pick a time if you run more than one that day, then choose how many **Spots** they want.
- **Reports.** Classes are counted in **By booking type** under **Settings → Reports**, alongside appointments, events and resources, with columns for bookings, covers, completed, cancelled, checked in and deposits, and a CSV of the same. There is no separate class report. Reports are admin only.

## Calendar columns and plan limits

Every class type has to sit on a bookable calendar, and a class type can only sit on one column at a time.

- Admins get **Add calendar column** inside the class form. It opens **Add calendar**, asks for a **Display name**, and **Create and select** makes the column and selects it straight away with default weekly hours you can refine later under **Calendar availability**.
- Only switched-on calendars count towards your plan. **Appointments Light** includes one, **Appointments Plus** up to five, **Appointments Pro** is unlimited. At the cap the button is replaced with a note naming your plan and linking to **Settings → Plan**.
- If you move to a smaller plan and a column is switched off, revisit any class type pointing at it. Guests cannot book a class whose column is not active.
- A class session also has to fit its column: it cannot overlap an appointment, another class, a resource booking or blocked time on the same column.

## Who can do what

| Action | Admin | Team member |
| --- | --- | --- |
| See every class type | Yes | Yes |
| Create, edit or delete a class type | Yes | Only on a calendar they manage |
| Schedule or remove sessions | Yes | Only for those class types |
| Open the roster and download the CSV | Yes | Yes |
| Check in guests (with class packs on) | Yes | Yes |
| Charge a no-show fee on a card hold | Yes | No |
| Cancel a class and notify guests | Yes | No |
| Add a calendar column | Yes | No |
| See Reports | Yes | No |

A team member with no calendar assigned sees the class types but gets no **+ Add class type** button at all. Assign calendars under **Settings → Staff**; see [Team access, roles, and calendar links](/help/appointments/team-management).

## Selling packs, courses and memberships

Prepaid credits, fixed-session courses and monthly memberships are a separate switch: **Settings → Booking Settings → Optional Booking features → Class packs, courses & memberships**. Turning it on adds a **Class products** button to the top of **Class timetable**, with tabs for **Credit packs**, **Courses** and **Memberships**, and it is the same switch that puts check-in on your rosters. See [Selling class packs (credits)](/help/appointments/selling-class-packs), [Building a class course](/help/appointments/building-a-class-course) and [Selling memberships](/help/appointments/selling-memberships).

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| There is no **Classes** row in the sidebar | The classes booking model is off | Tick **Classes & sessions** under **Settings → Booking Settings** |
| The class type is saved but nobody can book | It has no dates yet | Use **Schedule classes** to put it on the calendar |
| Sessions exist but guests cannot see them | The type is not **Active (visible to guests)**, or its column is switched off or has no hours that day | Tick **Active (visible to guests)**, then check the column under **Calendar Availability** |
| Saving a long run is refused | One run creates at most 100 sessions | Shorten the range, or the number of weeks, and repeat |
| I cannot lower a session's capacity | More people are already booked than the new number | Cancel a booking first, or set the **Capacity override** to the number already booked |
| Scheduling a session says the time conflicts | The column already has an appointment, class, resource booking or blocked time then | Move the session, or put the class type on a different column |
| **Check in all** is missing from the roster | Class packs, courses and memberships are off, or everyone is already checked in | Turn it on under **Settings → Booking Settings → Optional Booking features** |
| I cannot find **Class products** | The same switch is off | Turn it on, then reload **Class timetable** |
| **Charge no-show fee** does not appear | You are not an admin, or the booking is not a chargeable card hold | Ask an admin, and check the payment rule on the class type |
| **Add calendar column** is replaced by a message | You have used every calendar your plan allows | Switch an unused calendar off, or upgrade under **Settings → Plan** |
| I cannot edit a class type | You are a team member and it sits on a calendar you do not manage | Ask an admin, or ask to be linked to that calendar |
| **+ Add class type** is missing | You are a team member with no calendar assigned | Ask an admin to assign you at least one calendar |

## Next steps

- [Set up your classes](/help/getting-started/classes)
- [Creating and assigning bookable calendars](/help/appointments/calendar-setup)
- [Using the Appointment Calendar](/help/appointments/appointment-calendar)
- [Deposits, full payments, card holds, and refunds](/help/appointments/deposits)
- [Reports, exports, and the Clients directory](/help/appointments/reports)
`.trim(),
};
