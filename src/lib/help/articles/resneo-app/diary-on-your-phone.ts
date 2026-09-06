import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: "diary-on-your-phone",
  title: "The diary on your phone",
  description: "Read your day on the Calendar tab, switch between Day, Week and Month, add a booking or a block from a slot, and drag an appointment to a new time.",
  tags: ["app","mobile","calendar","diary","day","week","month","drag","block time","walk-in"],
  verified: '2026-09-06',
  content: `# The diary on your phone

The **Calendar** tab is the app's home. It shows the same diary as the web dashboard, laid out for a phone screen, and it is where most of your day happens.

The app has four tabs along the bottom: **Calendar**, **Appointments**, **Contacts** and **More**.

## Step 1: Choose your view

At the top of the **Calendar** tab is a row of three buttons: **Day**, **Week** and **Month**.

- **Day** is one day as a grid, with time down the side. This is the view you will live in.
- **Week** shows a week. If you are looking at one person, you get their week hour by hour. If you have picked **All**, you get a grid of everyone against the seven days, which is a read-only overview. Tap a day heading or a cell to drop into that day.
- **Month** is a whole month of squares, with a dot pattern and a count on each day, and **Open** or **Closed** on quiet days. Tap any day to open it in **Day** view.

Under the view buttons:

1. The arrows step back and forward. They move a day, a week or a month, depending on the view.
2. The date in the middle is a button. Tap it to open a month picker and jump to any date. That panel also holds the **From** and **Until** boxes that set which hours the grid shows.
3. When you are not on today, a **Today** pill appears next to the date. Tap it to come back.
4. You can also swipe the grid sideways to move a day or a week at a time.

## Step 2: Fit more on the screen

In **Day** view, the button that looks like two arrows squeezing together is **Compact day rows, fit the whole day on one screen**. Tap it to squash the grid so the whole working day fits without scrolling, and tap it again to go back to normal spacing.

## Step 3: Pick which calendars you see

Under the date is a row of chips you can scroll sideways.

On a phone in **Day** or **Week** view, the chips pick one calendar at a time. Tap a person's name to see just them, or tap **All** to see everyone side by side. The **All** chip carries the day's total, and each person's chip carries their own count.

On a larger screen in **Day** view, the chips become a filter instead. Every highlighted chip is a column you can see, so you can show one person, a few, or everybody:

- **All** puts every column back.
- **Working today** (it reads **Working this day** on any other date) hides the columns of people who are not down to work.
- Each person, and each linked venue that shares its calendars with you, has its own chip.

If a calendar is not scheduled to work on the day you are looking at, a line above the grid says so: "Not scheduled to work this day, tap a slot to book anyway or block time."

## Step 4: Add something to the diary

Tap an empty slot in the grid. A panel opens headed **Add at** and the time you tapped, offering:

- **New booking**, which opens the booking form with that date, that calendar and that time already filled in.
- **Walk-in**, which opens the same form set to a walk-in, starting at the slot you tapped.
- **Block time**, for lunch, a meeting or anything else that is not a booking.
- **Book a resource**, followed by a button for each resource that sits on that column, if you have resources set up.

The round **+** button at the bottom right does the same thing without a slot. It offers **New booking** and **Walk-in**, starting from now.

### Blocking time out

Choosing **Block time** opens **Add time block**. Set **Start** and **End** (both in 24-hour form, like 09:00), add a **Reason (optional)** such as "Lunch break", and save. Tap an existing block to open **Edit time block**, where you can change it or delete it. Deleting asks you to tap twice, so a stray tap cannot wipe a block by accident.

## Step 5: Work a booking from its bar

Each booking is a coloured bar. Tap it to open a summary panel, with a button in the corner to open the booking full screen.

When a bar is tall enough, it carries up to two small buttons in its bottom-right corner. They change with the booking's status:

- **Pending**: **Arrived** and **Accept**.
- **Booked** or **Confirmed**: **Arrived** and **Start**.
- **Started**: **Undo** and **Complete**.
- **Completed**: **Reopen**.

Once someone has arrived, the **Arrived** button becomes **Clear**, in case you tapped it by mistake. Cancelled and no-show bookings carry no buttons.

If the bar stands for a visit of several services, or a group booked together, the button applies to the whole thing at once.

## Step 6: Move a booking by dragging

1. **Press and hold** the bar for about half a second. The phone gives a small buzz and the bar lifts.
2. Keep your finger down and drag up or down to a new time. Drag sideways to move it onto another person's column when several columns are on screen.
3. Let go. The booking lands on the nearest slot.

To change how long a booking runs, start your hold on the **bottom edge** of the bar instead, then drag down to lengthen it or up to shorten it.

The half-second hold is deliberate: it means an ordinary tap or a scroll never moves anything.

## Step 7: Decide whether to tell the guest

After you move a booking to a new time, a panel appears headed **Booking moved** (or **Visit moved** for a multi-service visit), asking whether to let the guest know:

- **Notify** and the guest's name sends them the new time.
- **Don't notify** changes the diary quietly.
- **Undo change** puts the booking back where it was.

If you only changed the length, the panel reads **Duration updated** instead. There is no notify button, because the start time has not moved and the guest has not been told anything. You still get **Undo change** and **Done**.

You get the same panel when you move a booking on a venue you are linked with, as long as the link lets you edit their bookings. The message goes out from that venue, in their name, not yours.

**Undo change** is the app's only undo for a drag, so use it there and then if the move was a mistake.

## Step 8: The Today overview

The sun button in the toolbar, **Open Today overview**, opens a screen called **Today**. It is the phone version of the web dashboard home:

- A greeting with today's date, and **Calendar** and **All appointments** buttons.
- A setup checklist while your venue is still being set up (admins only). Optional steps carry a **Not now**.
- Tiles for **Today**, **Confirmed**, **Arriving soon** and **Next up**.
- Any alerts that need your attention.
- A seven-day forecast.
- **Today's appointments**, a list you can tap straight into.

You can also reach it from **More → Today**.

## Live updates and going offline

A small green dot next to the date means the diary is live: bookings taken elsewhere, by a colleague or by a client online, appear without you doing anything. If it turns amber, the app is reconnecting. Pull the grid down to refresh at any time.

If your phone loses its connection, a banner appears at the top: "You're offline, changes won't save until you reconnect." **The app does not queue changes while offline.** Wait for the banner to go before you move or accept anything, or the change will not stick.

## Common problems & fixes

- **Nothing happens when you drag.** Hold still for about half a second first, until you feel the buzz, then drag. A quick swipe scrolls the grid instead.
- **The booking will not move where you want it.** The app refuses a drop that would overlap another booking. Move the other one first, or use **Reschedule** on the booking screen.
- **You cannot see a colleague's column.** In **Day** view on a phone, tap **All**, or tap their name chip. On a wider screen, check the chips are highlighted and that **Working today** is not hiding them.
- **A day looks empty but should not.** Check the **From** and **Until** hours in the date panel, in case the grid is only showing part of the day.
- **The bar has no buttons on it.** Very short bookings do not leave room for them. Tap the bar and use the summary panel instead.
- **"No practitioners yet".** Your venue has no calendars. An admin adds them on the web, under **Calendar Availability**. See [Business and calendar hours](/help/getting-started/business-and-calendar-hours).
- **The change you made has vanished.** Look for the offline banner. Nothing saves while it is showing.

## Next steps

- [Finding and updating bookings](/help/resneo-app/bookings-in-the-app)
- [Taking a booking in the app](/help/resneo-app/take-a-booking-in-the-app)
- [Using the calendar on the web](/help/getting-started/calendar)
- [Business and calendar hours](/help/getting-started/business-and-calendar-hours)`,
};
