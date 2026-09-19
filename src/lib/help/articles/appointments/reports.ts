import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: 'reports',
  helpSection: 'growth',
  title: 'Reports, exports, and the Clients directory',
  description: 'A reference for every Reports card, what each Export CSV contains, the Appointment performance metrics, the New bookings and Revenue tabs, the daily booking log email, and the Clients directory.',
  tags: ['reports', 'analytics', 'csv', 'admin', 'revenue', 'booked revenue', 'no-shows', 'new bookings', 'bookings made', 'bookings taken'],
  verified: '2026-09-19',
  content: `
# Reports, exports, and the Clients directory

Reports shows how busy you are, what you are taking, where your bookings come from, and how your clients behave. This article is the reference: every card, what each **Export CSV** contains, and what each performance figure actually measures.

## Before you start

- Reports is **admin only**. Open **Settings**, then the **Reports** tab. There is no Reports row in the sidebar, and an old \`/dashboard/reports\` address sends you to the same tab.
- Four tabs sit at the top right of the page: **Overview**, **New bookings**, **Revenue** and **Clients**. The last one is named after your word for a client.
- Everything follows the date range you set, apart from **SMS segments this period** (which follows your billing period) and **Export your data** (which has its own date choices, including **All time**).
- Card names follow the wording your venue uses. This article says "appointment" and "client". If your profile uses "session" and "patient", you will see those words instead.
- Cards appear only when there is something to show. **By booking type** needs activity in more than one booking type, **Event ticket sales by tier** needs ticket sales, and **Resource utilisation** needs resource bookings.

:::help-figure reports-dashboard

## Step 1: Check your SMS usage

**SMS segments this period** sits above the **Reports** heading. It shows a bar, then segments sent against segments included in your plan, and how many are left.

Go past the allowance and an amber **Overage** note appears: how many extra segments you sent, roughly what they cost, and the note that overage is metered against your current Stripe billing period. This panel ignores the date range below, because it follows that billing period.

## Step 2: Set the date range

The **Date range** card has **From**, **To** and **Apply**, and opens on the last seven days. Set your dates, click **Apply**, and every card below reloads.

> **Tip:** the page shows one period at a time. To compare, write down last month's figures, then set the month before. The **Appointment performance** card does that comparison for you.

## Step 3: Read the Overview cards

Every card except **Appointment performance** has an **Export CSV** button in its top right. Downloads cover the same date range as the screen. If there is nothing to export you get an amber **Notice** instead of a file.

The cards run in this order:

1. **Appointment activity**. Three tiles about the bookings made in the period, each counted on the day it was made in your time zone. **Appointments created** is the same count as the **New bookings** tab in step 5: a visit with several services counts once, and imports, moves from another venue in your collective, and bookings cancelled because a deposit or card never came through are left out. A line underneath says how many more are still waiting for a deposit or card. **Client places booked** counts people (a group of three counts as three, a visit one). **Clients seen (arrived / completed)** is how many of those people have arrived, started or finished so far, so bookings made for later dates do not count yet. Two charts sit below: **How they booked (when created)**, split into the same channels as **New bookings**, and **Appointment status (latest)**, one bar per booking, where **Pending** is the bookings waiting for payment. The **Daily booking log email** panel is at the bottom of this card.
2. **By booking type**. Only when more than one booking type had activity. Columns: **Type**, appointments, **Covers / guests**, **Completed**, **Cancelled**, **Checked in** and **Deposits**.
3. **Appointment performance**. Covered in step 4.
4. **Team, services & channels**. Non-cancelled appointments only. A bar chart splits volume by calendar, headed with your word for staff, with a second bar for **Arrived or completed**. Below it are **Top services by volume** and **How clients booked (channel mix)**. If you sell add-ons, an **Add-on revenue** block appears with **Total add-on revenue**, **Appointments with add-ons**, and a table of your best sellers.
5. **No-show rate**. Of the appointments due in the period, the share where the client did not turn up, dated by the appointment. An **Overall** percentage sits above a trend line with a point for each day that had an outcome. An appointment counts once it is marked started, completed or no-show, a visit with several services counts once a day, and walk-ins are left out. It follows the same rule as the no-show rate on **Appointment performance**, so the two agree for the same dates.
6. **Cancellation rate**. Five tiles: **Appointments created** (the same count as on **Appointment activity**), **Client-initiated**, **Team-initiated**, **Cancellation rate** and **Auto (unpaid)**. The rate is the share of the appointments made in the period that have since been cancelled. **Client-initiated** means the client cancelled it themselves; **Team-initiated** means someone on your team did, including when a client phoned to cancel. **Auto (unpaid)** counts bookings cancelled on their own because a required deposit or card did not come through in time. The client never finished booking, so these are not in the rate. The rate tile changes colour above 10%, a nudge to look at your deposit or reminder settings.
7. **Payments & deposits**. **Total collected**, **Total refunded** and **Total forfeited**, then below a divider **No-show fees charged** (the amount, with the number of charges beside it) and **Active card holds**. Charged no-show fees are kept separate from deposits, because they are not deposit payments.
8. **Event ticket sales by tier**. **Tickets sold**, **Ticket revenue** and **Ticket tiers sold**, then a row per ticket type. Revenue uses the price captured when each ticket was booked, so editing a tier later does not rewrite history. Cancelled bookings are excluded.
9. **Resource utilisation**. Booked hours against each resource's open hours, as a bar per resource with the booking count underneath. Cancelled bookings do not count as booked hours.

### What each Export CSV contains

| Card | The file holds |
| --- | --- |
| **Appointment activity** | Appointments created, waiting for payment, client places booked, places seen, then a row per channel and a row per status |
| **By booking type** | Booking type, Bookings, Covers / guests, Completed, Cancelled, Checked in, Deposits collected (£) |
| **Team, services & channels** | A block per staff member (appointments, arrived or completed), then one per service, one per channel, and an add-on block when you have add-on revenue |
| **No-show rate** | Appointment date, No-shows, Attended or no-show (count), Rate % |
| **Cancellation rate** | Appointments created, Cancelled (client-initiated), Cancelled (team-initiated), Cancellation rate %, and the unpaid automatic cancellations |
| **Payments & deposits** | Total collected, refunded and forfeited, no-show fees charged with a count, and active card holds, in pence and in pounds |
| **Event ticket sales by tier** | Ticket type, Tickets sold, Bookings, Revenue (£) |
| **Resource utilisation** | Resource, Bookings, Utilisation %, Booked hours, Available hours |

Files are named after the report and the dates you chose, and land in your browser's downloads folder.

## Step 4: What the Appointment performance figures mean

This card is built for appointments businesses and is the only one that compares periods for you. It has no **Export CSV**. Where a figure cannot be worked out you see a dash, and if the range holds too little activity the whole card says so instead of showing numbers.

**Attendance**

- **No-show rate**: no-shows as a share of the appointments that were due to take place, meaning those that reached started or completed, or were marked as a no-show. A visit with several services counts once a day, and walk-ins are excluded, as on the **No-show rate** card. Under 5% is healthy. Above 10% is costing you money, and a deposit or a 24-hour reminder is the usual fix.

**Reschedules**

- **Guest moved online (share of known moves)**: of the moves where ResNeo recorded who made the change, the share the client made themselves. High is good, because your booking page is doing the rescheduling instead of your phone. Older changes with no recorded actor are counted separately in the line underneath.
- **Guest notified after a move**: how often a change actually reached the client as an email or text. If this is low, switch on **Booking modification** under **Settings → Communications**.

**After a cancellation**

- **Rebooked within 7 days**: of the cancelled appointments that had a client on file, how many of those clients booked again within a week. Low means cancellations are walking out for good.
- **Typical wait to rebook**: the median gap between a cancellation and that client's next appointment. The line underneath adds the point three quarters of clients have rebooked by.

**Team efficiency**

- **Median time to create an appointment**: how long your team takes to add a booking in the dashboard, from opening the form to saving it. The line underneath gives a separate typical time for returning clients.

When ResNeo has a saved reference period, a **Reference period saved** bar names those dates and each figure gains a line such as "Reference no-show rate was 8%". That snapshot refreshes weekly.

## Step 5: The New bookings tab

Click **New bookings** at the top right. This tab answers one question: how many bookings did we take? Each booking counts on the day it was made, in your venue's time zone, whatever date it is for. A booking made today for next month counts today.

What counts as one booking:

- A visit with several services counts once, on the day its first service was booked. Adding a service to it later does not count again.
- A recurring class reservation counts once, when it was first booked, not each time another session is added to it.
- Each person in a group booking, and each class in a basket, counts on its own, as the bookings list shows them.

What is left out:

- Bookings brought in with an import.
- A booking moved here from another venue in your collective. It already counted where it was made.
- Bookings cancelled automatically because a deposit or card never came through.

Cancelled bookings still count, because they were taken, and the **New bookings** tile says how many have since been cancelled. A booking still waiting for a deposit or card is not counted yet: an amber note says how many are waiting, and each one counts once it is paid, or once your team accepts it unpaid.

For the same dates, **New bookings** is the same number as **Appointments created** on **Overview**, and **Since cancelled** is **Client-initiated** and **Team-initiated** on the **Cancellation rate** card added together.

This tab keeps its own dates, separate from the **Date range** card on **Overview**. Pick **Today**, **Yesterday**, **This week** (where it opens), **Last week**, **This month** or **Last month**, or click **Custom range** and set your own **From** and **To**. This week and this month run up to today, because nothing can be booked in the future, and a custom range can cover up to 400 days. **Show by** groups the periods into **Day**, **Week** or **Month**.

The tiles at the top:

- **New bookings**, with a line saying how many have since been cancelled.
- **Online**: your client booked themselves, on your booking page or your website.
- **By your team**: someone on your team added it, by phone, in person or from a message.
- **Walk-ins**.
- **By a linked venue**, which only appears once a linked venue has booked on your calendars.

Each of the last four shows its share of your new bookings. Below them, a stacked bar chart gives one colour per channel, and a table repeats the figures period by period with a **Since cancelled** column and a **Total** row. **Export CSV** downloads the table, with a column for each channel, **New bookings**, **Since cancelled** and **Waiting for payment**.

The same count sits on your **Home** page, in the **New bookings** card, for today, this week and this month.

Where you are is kept in the address, so \`/dashboard/settings?tab=reports&reportsTab=new-bookings\` is a link straight back to this tab.

## Step 6: The Revenue tab

Click **Revenue** at the top right. This tab answers one question: what is on the diary, and whose diary it is on.

**Booked revenue** is the value of every appointment on the diary that has not been cancelled, priced the way the booking panel prices it: the total stored on the booking, else the option the client chose, else that calendar's own price, else the service's list price, plus add-ons. Each service of a multi-service visit counts on its own, so a visit is never counted twice.

This tab keeps its own range, separate from the **Date range** card on **Overview**. Pick **Today**, **This week** (where it opens), **This month**, **Last 30 days** or **Next 30 days**, or click **Custom range** and set your own **From** and **To**. **Show by** groups the periods into **Day**, **Week** or **Month**.

No-shows are reported beside the total rather than quietly dropped. A past date leaves out services marked as a no-show; tick **Include no-shows** to add them back. A future date has no no-shows yet, so it reads as everything booked.

Three tiles sit at the top:

- **Booked revenue** for the range, with a line saying whether it covers past dates, upcoming dates, or both.
- **No-shows deducted**, or **No-shows included** when the tick box is on, with the number of services behind it.
- **Appointments counted**. If any of them carry no price at all, the tile says how many, and an amber note repeats it: those services add nothing to the totals.

Below the tiles, a stacked bar chart gives one colour per calendar, and a table repeats the same figures period by period with a **Total** row. **Export CSV** in the card's top right downloads exactly what is on screen.

> **Linked venues:** if another venue has shared full booking detail with you and let you create, edit and cancel, their calendars appear as their own columns with the venue's name underneath, and a line above the chart names the venues included. Only the calendars they scoped the link to are counted.

Where you are is kept in the address, so \`/dashboard/settings?tab=reports&reportsTab=revenue\` is a link straight back to this tab.

## Step 7: The Clients tab

Click **Clients** at the top right. You land on the **Client directory**, which follows the same date range. **Export CSV** in its top right downloads your whole client list.

Four tiles sit at the top: **Known clients (all-time)**, **New this period**, **Returning this period**, and **Anonymous appointments (period)**, which counts walk-ins with no contact details. Those walk-ins are counted but not listed below.

Three controls sit underneath:

- **Search** takes a name, email or phone number.
- **Show** picks **With contact (CRM)**, **All except walk-ins**, or **Walk-ins only**.
- **Sort** offers **Last visit (newest)**, **Last visit (oldest)**, **Name (A–Z)**, **Name (Z–A)**, **Most visits** and **Recently added**.

If you use tags, a **Filter by tags** row appears. Click a tag to narrow the list, click it again to clear it.

The table lists each client with their email, phone, total appointments, lifecycle count (a red **NS** flag shows no-shows) and last visit. **View appointments** opens the bookings list filtered to them, and **Erase** starts a GDPR erase. Click the name instead and the row opens with:

- **Contact**: first name, surname, email and phone with **Save details**, plus the tag editor.
- Small tiles for total appointments, **Cancellations**, **No-shows**, **Deposits paid**, **First visit** and **Last visit**.
- **Export history (CSV)** for that one person.
- **Recent appointments**, each linking straight to the booking.

> **Good to know:** for the full record, with notes, documents, marketing consent and message history, use **Open Contacts** at the top of the card.

## Get the daily booking log by email

At the bottom of **Appointment activity**, the **Daily booking log email** panel sends you a summary of new appointments and cancellations.

1. Click the switch on the right to change it from **Disabled** to **Enabled**. The pill beside the title says **On** or **Off**.
2. **Send to** arrives filled in with your venue's email address. Change it if the summary should go somewhere else.
3. Under **Schedule**, tick the days you want and set a time for each. It suggests Monday to Friday at 17:00.
4. Click **Save email settings**.

Emails are off by default and only send on the days you tick.

> **Tip:** for an email on every single booking instead, use **New booking alert** under **Settings → Communications**.

## Export your data

**Export your data** sits at the bottom of **Overview**. Choose **Appointments**, **Clients** or **Services**, then the dates (**All time** for everything, or a month, a year or your own **From** and **To**), then **CSV**, **Excel spreadsheet** or **PDF**. The page counts what your choices cover before you download. Every file carries the full details, and it is built at the moment you click, so nothing is out of date. See [Exporting all your data](/help/settings/data-export) for what each file contains.

Exports contain personal data. Store them securely, and delete local copies when you are finished.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| I cannot find Reports | You are not an admin, or you are looking in the sidebar | It is under **Settings**, then **Reports** |
| **Export CSV** shows a notice instead of downloading | There is no data in the range | Widen **From** and **To**, click **Apply**, and try again |
| **Appointment performance** has no download | That card has no export | Use the other cards' exports, or **Export your data** |
| A card is missing | That booking type had no activity in the range | Widen the range. **By booking type** needs more than one type with activity |
| The numbers look too low | The range opens on the last seven days | Set a wider **From** and **To**, then click **Apply** |
| **Appointment performance** says there is not enough activity | Too few appointments in the range | Widen the dates and look again |
| A client is missing from the list | **Show** is set to **With contact (CRM)** and they have no contact details | Switch **Show** to **All except walk-ins** or **Walk-ins only** |
| **New bookings** and **Appointments created** give different numbers | The dates differ: **Overview** follows the **Date range** card, and **New bookings** keeps its own | Set the same dates on both. They count the same way, so the numbers then match |
| **Clients seen (arrived / completed)** is much lower than **Client places booked** | Many bookings made in the period are for later dates that have not happened yet | Pick dates that ended a while ago, or check the no-show rate on **Appointment performance** |
| A booking made today is missing from **New bookings** | It is still waiting for a deposit or card | It counts once paid, or once your team accepts it unpaid. The amber note says how many are waiting |
| **New bookings** will not show a future date | Nothing can be booked in the future | The range stops at today |
| SMS segments does not match my bill | The banner follows your Stripe billing period, not the date range | Cross-check **SMS usage** under **Settings → Plan** |
| **Could not load reports** | The page could not fetch your figures | Click **Retry**. If it keeps failing, check your connection |

## Next steps

- [Reading your reports](/help/getting-started/reports)
- [Exporting all your data](/help/settings/data-export)
- [Your contacts (CRM)](/help/getting-started/contacts)
- [Automated messages, channels, and timing](/help/appointments/communications)
`.trim(),
};
