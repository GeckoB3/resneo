import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: 'building-a-class-course',
  helpSection: 'operations',
  title: 'Building a class course',
  description: 'Bundle a fixed set of class sessions into one course, set a cap and an enrolment window, and handle cancellations and refunds.',
  tags: ['classes', 'courses', 'commerce'],
  verified: '2026-09-06',
  content: `# Building a class course

A **course** bundles a fixed set of sessions into one price: six weeks of beginners Pilates, a four-session yoga immersion, a Saturday workshop series. Clients pay once, and every session in the course is then free for them to book.

> A course is a price and a list of sessions. It does not create the sessions, and it does not book your client into them. Put the dates on your timetable first, then wrap them in a course.

## Before you start

1. Turn classes on and put your sessions on the calendar. A course can only include dates that already exist on your **Class timetable**. See [set up your classes](/help/getting-started/classes).
2. Switch on **Class packs, courses & memberships**: **Settings**, then the **Booking Settings** tab, then **Optional Booking features**. It starts off. Until it is on there is no **Class products** button, the page sends you back to the timetable, and nothing there will save.
3. Connect Stripe if the course is paid. Free courses (£0) work without it. See [connect Stripe to take payments](/help/getting-started/stripe-payments).

## Step 1: Create the course

1. Open **Classes** from the sidebar, click **Class products**, then the **Courses** tab.
2. Fill in the form under **Create a course**:
   - **Course name**, what clients see. Required.
   - **Description**, your marketing line.
   - **Course price (GBP)**. Leave it empty or set £0 for a free course, which skips card payment entirely.
   - **Max enrollments**, an optional cap on how many people can join.
   - **Enrollment opens** and **Enrollment closes**, an optional date and time window. Closes must be later than opens.
   - **Cancellation window (days)**, how many days before the first session a client can cancel themselves for a refund. Leave it blank and the course is non-refundable.
3. Pick the sessions (see the next step).
4. Leave **Open for enrollment** ticked, then click **Create course**.

## Step 2: Choose the included sessions

The **Included sessions** picker sits in the middle of the form and shows the real dates from your timetable, grouped by class type.

1. Narrow the list with the three filters: a class type dropdown that starts on **All class types**, and two date boxes that start at today and 90 days ahead.
2. Tick each session you want. The counter above the list shows how many are **selected**, and each row shows the date, the time and how many people are already booked.
3. **Select all visible** ticks everything the filters are currently showing, and **Clear selection** empties the lot. Your ticks survive a filter change, so you can switch class type and keep adding.
4. If you see "No sessions in this range", widen the dates or add the sessions to your timetable first.

A course that is **Open for enrollment** must have at least one session. Saving without one is refused with "Add at least one class session before publishing this course."

> Adding a session to a course later does not add it to people who have already enrolled. Their places are linked at the moment they enrol. Set the full list of dates before you open enrolment.

## Step 3: Check it on your booking page

Open your public booking page and choose the **Classes** tab. Courses appear under **Passes, courses & memberships** in alphabetical order, up to two at a time, with an **Enroll** button (or **Enroll free** for a free course). Someone who is not signed in sees **Sign in to enroll**.

In the dashboard, each course in the list shows its price and session count, then a line such as "12 enrollment cap · opens 4 September 2026, closes 18 September 2026", the first four dates and "+ 2 more". A course with nothing picked shows "No sessions selected yet."

## How a client enrols

1. They tap **Enroll** on your booking page and sign in if they need to.
2. They land on **Passes and plans** in their account, on the **Courses** tab, with your venue and the course chosen.
3. A free course is confirmed as soon as they click **Enroll free**. A paid one opens a card form after **Pay with card**, showing the total to pay.
4. A **Course enrollment confirmed** email lists what they have joined.

Their place then shows under **Enrollments** with the venue, the status (Awaiting payment, Enrolled, Cancelled or Finished) and the first session date.

## Booking the sessions

Enrolling reserves the price, not the seat. Your client still books each session the normal way, and the course makes those bookings free. That is the first rule ResNeo applies: a course beats a membership, and both beat class credits, so nobody pays twice or burns a credit on a session their course already covers.

Because of that, an enrolment on its own does not take a spot out of the class's capacity. If you want the course cohort protected, keep **Max enrollments** at or below the room's capacity and watch the "N booked" numbers on the sessions.

## Attendance

Mark attendance on the class itself, not on the course. Open the session from your **Class timetable** or the appointment calendar and use **Check in**, **No show**, or **Check in all** for the whole room. Those buttons only appear when class packs, courses and memberships are switched on.

Each mark is mirrored onto the client's course, so the enrolment shows a running "3 / 6 sessions attended" and you can spot someone drifting away.

## Managing enrolments

Click **View enrollments** on a course to open its list. You get each person's name and email, when they enrolled, a status pill, their attendance total, and **Show sessions** for the session-by-session breakdown. Cancelled places are tucked into a "cancelled enrollments" line at the bottom, and **Refresh** reloads the list.

Two buttons cancel a place, and both are admin only.

- **Cancel enrollment** is the everyday one. Inside the cancellation window, ResNeo refunds through Stripe automatically and tells you the amount. The refund covers the sessions that have not run yet, so a client cancelling before the course starts gets everything back.
- **Force-cancel** is for cancelling after the window has closed. It asks for a reason, issues no refund, and leaves you to sort any money out with the client directly.

Either way the place and its linked sessions are cancelled, any bookings that client already had for those dates are cancelled too, and a **Course refund** email goes out.

Clients can also cancel themselves from **Passes and plans**, then **Courses**, while they are inside the window. Their screen tells them where they stand: "You can cancel for a full refund until 12 September 2026", "Past the cancellation window. Contact the venue." or "This course is non-refundable."

> These course emails send on their own. They are not among the cards under **Settings**, then the **Communications** tab, so there is nothing to switch on and nothing to reword.

## Archiving and deleting

Every course has **Edit**, **Archive** and **Delete**.

- **Archive** takes it off your booking page and swaps the pill to **Archived**. People already enrolled keep their places. **Reactivate** puts it back.
- **Delete** is refused while anyone is enrolled or part way through paying, with a message telling you to archive instead.

**Open for enrollment** in the form and the **Archive** button are the same switch, so unticking the box and saving archives the course.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| There is no **Class products** button | **Class packs, courses & memberships** is off | Turn it on under **Settings**, then **Booking Settings**, then **Optional Booking features** |
| The session I want is not in the picker | It is outside the date filters, it is cancelled, or it is not on the timetable yet | Widen the dates, or use **Schedule classes** on the **Class timetable** page first |
| It will not save the course | It is **Open for enrollment** with no sessions ticked, or **Enrollment closes** is not after **Enrollment opens** | Tick at least one session and check the two dates |
| A client sees "Enrollment is not open yet" or "Enrollment has closed" | Today is outside the enrolment window | Change **Enrollment opens** or **Enrollment closes**, or clear them both |
| A client sees "This course is full" | The cap in **Max enrollments** has been reached, counting people still paying | Raise the cap, or wait for an abandoned payment to clear |
| A seat looks taken but nobody paid | A checkout was started and left | Unfinished payments are cancelled automatically after two hours and the seat comes back |
| A client sees "Venue has not connected Stripe" | Your Stripe account is not connected or not finished | Open **Settings**, then **Payments**, and finish both Stripe steps |
| Someone who enrolled is not on the class roster | Enrolling does not book the sessions | Ask them to book each session from their account, or add them from **New Booking** |
| Someone enrolled late and is missing a date | Sessions added to a course after they enrolled are not linked to them | Book that session for them from **New Booking** |
| **Cancel enrollment** is refused | The cancellation window has passed | Use **Force-cancel** and arrange any refund with the client yourself |
| I cannot delete a course | Someone is enrolled or mid-payment | Click **Archive** instead |

## Next steps

- [Selling class packs (credits)](/help/appointments/selling-class-packs)
- [Selling memberships](/help/appointments/selling-memberships)
- [Set up your classes](/help/getting-started/classes)
- [Connect Stripe to take payments](/help/getting-started/stripe-payments)`,
};
