import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: "reports",
  helpSection: "gs-grow",
  title: "Reading your reports",
  description: "See how your business is doing at a glance, pick a date range, and download the numbers as a spreadsheet.",
  tags: ["reports","analytics","csv","export","no-shows","cancellations","deposits","admin","new bookings","bookings made","bookings taken"],
  verified: '2026-09-19',
  content: `# Reading your reports

Reports tell you how busy you are, how much you are taking, and where your bookings come from. This guide walks the page and, more importantly, says what each number means.

## Before you start

- Reports are admin only, under **Settings**, then the **Reports** tab. There is no Reports row in the sidebar. An old \`/dashboard/reports\` link still works: it sends you to the same tab.
- The page has four tabs at the top right: **Overview** (everything below), **New bookings**, **Revenue**, and your client directory.
- Figures follow the date range you set, except the two exports at the bottom, which always cover everything.
- Card and column names follow the wording your venue uses. This guide says "appointment" and "client". If your profile uses "session" and "patient", you will see those words instead.

## Step 1: Set the date range

The **Date range** card sits near the top with **From**, **To**, and **Apply**. It opens on the last seven days.

Above it sits **SMS segments this period**: how many text segments you have sent out of the allowance included in your plan, and how many are left. If you have gone past the allowance, an **Overage** note says how many extra segments you sent and roughly what they cost.

> **Tip:** the range shows one period at a time. To compare, set last month, write the figures down, then set the month before. The **Appointment performance** card below does this for you automatically.

:::help-figure reports-dashboard

## Step 2: Read each card

Every card except **Appointment performance** has an **Export CSV** button in its top right.

- **Appointment activity**: **Appointments created** counts the bookings made in your dates, each on the day it was made. It is the same count as the **New bookings** tab in step 4, so a visit with several services counts once. A booking still waiting for a deposit or card shows underneath as waiting for payment, and joins the count once it is paid. **Client places booked** counts each person, so a group of three counts as three. **Clients seen (arrived / completed)** is how many of those people have arrived, started or finished so far. Two charts sit below: **How they booked (when created)**, split the same way as **New bookings**, and **Appointment status (latest)**.
- **By booking type**: this one only appears when you run more than one booking type. It puts appointments, classes, events and resources in one table, with headcount, completed, cancelled, checked in and deposits taken.
- **Team, services & channels**: volume per calendar, **Top services by volume**, and **How clients booked (channel mix)**. Watch the channel split: if most bookings still say phone, your booking page is not being seen. If you sell add-ons, an **Add-on revenue** block appears with **Total add-on revenue**, **Appointments with add-ons**, and your best sellers.
- **No-show rate**: of the appointments due in your dates, the share where the client did not turn up, by the date of the appointment. It shows as an **Overall** figure with a trend line underneath, and matches the no-show rate on **Appointment performance**. A visit with several services counts once, and walk-ins are not counted.
- **Cancellation rate**: five tiles, **Appointments created**, **Client-initiated**, **Team-initiated**, **Cancellation rate** and **Auto (unpaid)**. The rate is the share of the appointments made in your dates that have since been cancelled. **Client-initiated** means the client cancelled it themselves. **Team-initiated** means someone on your team did, including when a client phoned to cancel. **Auto (unpaid)** counts bookings cancelled on their own because a required deposit or card did not come through in time. The client never finished booking, so these are not in the rate. The rate tile changes colour above 10%, a nudge to look at your deposit or reminder settings.
- **Payments & deposits**: **Total collected** is deposit money you took, **Total refunded** is what you gave back, and **Total forfeited** is what you kept when a client did not show. Below a divider sit **No-show fees charged** and **Active card holds**. If forfeited is climbing, your deposit rules are working. If it is zero and your no-show rate is high, you are not asking for deposits.
- **Event ticket sales by tier** and **Resource utilisation** appear only when you sell tickets or hire out rooms and equipment.

## Step 3: Read the Appointment performance card

This is the card built for appointments businesses, and the only place that compares periods for you. It is grouped under four headings.

**Attendance**

- **No-show rate**, with a plain-English line underneath. Under 5% is healthy. Above 10% is costing you money, and a deposit or a 24-hour reminder is the usual fix.

**Reschedules**

- **Guest moved online (share of known moves)**: of the appointments that moved, how many the client moved themselves. High is good, because your booking page is doing the rescheduling instead of your phone.
- **Guest notified after a move**: how often a change actually reached the client. If this is low, switch on **Booking modification** under **Settings**, then **Communications**.

**After a cancellation**

- **Rebooked within 7 days**: of the clients who cancelled, how many came back within a week. Low means cancellations are walking out for good.
- **Typical wait to rebook**: the middle wait between a cancellation and that client's next appointment.

**Team efficiency**

- **Median time to create an appointment**: how long your team takes to add a booking in the dashboard, from opening the form to saving it.

When ResNeo has saved a reference period, a **Reference period saved** bar at the top of the card names those dates, and each figure gains a line saying what it was then. That is how you answer "am I busier than last month" without doing sums. The reference snapshot is refreshed weekly.

> **Good to know:** this card has no Export CSV button. If there is too little activity in your range, it says so instead of showing figures. Widen the dates and look again.

## Step 4: Count the bookings you took, on the New bookings tab

Click **New bookings** at the top right. This tab counts how many bookings you took, each on the day it was made, whatever date it is for. A booking made today for next month counts today.

:::help-figure reports-new-bookings

1. Pick a range with the chips: **Today**, **Yesterday**, **This week**, **Last week**, **This month**, **Last month**, or **Custom range** for your own dates. This range is separate from the one on **Overview**.
2. Use **Show by** to group by **Day**, **Week** or **Month**.
3. Read the tiles: **New bookings** is the total, then how they came in. **Online** means your client booked themselves, **By your team** means someone on your team added it (by phone, in person or from a message), and **Walk-ins** counts clients your team booked in as they arrived.

A visit with several services counts once. Cancelled bookings still count, and the **New bookings** tile says how many have since been cancelled. Imported bookings, and bookings cancelled automatically because a deposit or card never came through, are not counted. A booking still waiting for a deposit or card counts once it is paid.

For the same dates, this is the same number as **Appointments created** on **Overview**.

**Export CSV** downloads the table exactly as you set it up.

> **Tip:** your **Home** page shows the same count in its **New bookings** card, for today, this week and this month.

## Step 5: See what is on the diary, on the Revenue tab

Click **Revenue** at the top right. This tab is not about what has been paid, it is about what is booked: the value of every appointment on the diary that has not been cancelled, added up by day and split by calendar.

1. Pick a range with the chips: **Today**, **This week**, **This month**, **Last 30 days**, **Next 30 days**, or **Custom range** for your own dates. This range is separate from the one on **Overview**.
2. Use **Show by** to group by **Day**, **Week** or **Month**.
3. Read the total, then the chart underneath: one colour per calendar, so you can see who is carrying the week.

Services marked as a no-show are taken off a past date's total and shown beside it. Tick **Include no-shows** to add them back. Future dates have no no-shows yet, so they show everything booked.

**Export CSV** downloads the table exactly as you set it up.

## Step 6: Check the Clients tab

Click the **Clients** tab, the last one at the top right of the page. You land on the **Client directory**, which follows the same date range.

Four tiles sit at the top:

- **Known clients (all-time)**: everyone on your books.
- **New this period**: first-time clients in your dates.
- **Returning this period**: clients who had been in before.
- **Anonymous appointments (period)**: walk-ins with no contact details. They are counted here but not listed below.

> **Tip:** set the range to last month, note **New** and **Returning**, then set the month before and compare. Growing **New** means your booking page is working. Growing **Returning** means your chair time is working.

Below the tiles are three controls:

- **Search** takes a name, email or phone number.
- **Show** picks **With contact (CRM)**, **All except walk-ins**, or **Walk-ins only**.
- **Sort** offers **Last visit (newest)**, **Last visit (oldest)**, **Name (A–Z)**, **Name (Z–A)**, **Most visits**, and **Recently added**.

If you use tags, a **Filter by tags** row of buttons appears underneath. Click a tag to narrow the list, click it again to clear it.

Click a client's name to open their row. You get their appointments, cancellations, no-shows, deposits paid, first and last visit, an editable name, email, phone and tags, a list of **Recent appointments**, and an **Export history (CSV)** button for that one person. **Export CSV** in the card's top right downloads your whole client list.

> **Good to know:** for the full customer record, with notes, documents, marketing consent and message history, use **Open Contacts** at the top of the card.

## Get a daily summary by email

At the bottom of the **Appointment activity** card is a **Daily booking log email** panel. Switch it on and ResNeo emails you a summary of new appointments and cancellations.

1. Click the switch on the right to change it from **Disabled** to **Enabled**. The pill beside the title says **On** or **Off**.
2. **Send to** arrives filled in with your venue's email address. Change it if the summary should go somewhere else.
3. Under **Schedule**, tick the days you want it and set a time for each. It suggests Monday to Friday at 17:00.
4. Click **Save email settings**.

Emails are off by default and only send on the days you tick.

## Export your data

At the bottom of **Overview**, **Export your data** downloads your appointments, your clients or your services as a CSV, an Excel spreadsheet or a PDF, for **All time** or any dates you choose. It has its own date choices, separate from the date range above. Files are built there and then, so nothing is out of date.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| A card is missing | That booking type is not in use, or there is nothing to report in your range | Widen the range. **By booking type**, **Event ticket sales by tier** and **Resource utilisation** only appear when there is something to show |
| Export CSV does nothing | There is no data in the range | You get a notice instead of a download. Widen the dates and try again |
| **Appointment performance** has no download | That card has no export | Use the other cards' exports, or the full exports at the bottom |
| **New bookings** and **Appointments created** give different numbers | The two tabs keep separate dates: **Overview** follows the **Date range** card, and **New bookings** has its own | Set the same dates on both. They count the same way, so the numbers then match |
| **Clients seen (arrived / completed)** is much lower than **Client places booked** | Many bookings made in your dates are for later dates that have not happened yet | Pick dates that ended a while ago, or check the no-show rate on **Appointment performance** |
| The numbers look too low | The range opens on the last seven days | Set a wider **From** and **To**, then click **Apply** |
| I cannot find Reports | You are not an admin, or you are looking in the sidebar | It is under **Settings**, then **Reports** |
| A client is missing from the list | **Show** is set to **With contact (CRM)**, and they have no contact details | Switch **Show** to **All except walk-ins** or **Walk-ins only** |

## Next steps

- [Reports and insights](/help/appointments/reports)
- [Guest communications (email and SMS)](/help/getting-started/communications)
- [Your contacts (CRM)](/help/getting-started/contacts)
- [Set up your services](/help/getting-started/services)`,
};
