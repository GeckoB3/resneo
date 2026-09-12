import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: "calendar",
  helpSection: "gs-run",
  title: "Using the calendar",
  description: "Read your day at a glance, add and reschedule bookings with a click or drag, and keep each one on track.",
  tags: ["calendar","bookings","scheduling","drag","reschedule","status","appointments"],
  verified: '2026-09-12',
  content: `# Using the calendar

The **Appointment Calendar** is your day as a grid, one column per person or room. It is where you see what is happening now, move things, and block out time.

## Before you start

- Open **Appointment Calendar** from the sidebar.
- On a phone the toolbar shows icons instead of words. **New** is the plus, **Walk-in** is the person, **Compact** is the four lines, and **Undo** is the curved arrow.

## Find your way around

1. The view button shows the current view, such as **Day**. Click it to switch between **Day**, **Week**, and **Month**.
2. Move through dates with the arrows. They step a day, a week, or a month depending on the view. **Today** jumps back to today.
3. Click the date to pick another day. The same panel has **From** and **Until** boxes that set which hours the grid shows.
4. Use **Filter** to hide calendars or statuses you do not need. Inside it you will find:
   - **Calendars**: tick **All calendars** or just the ones you want.
   - **Only calendars working on the selected day**, which hides the columns of people who are off that day (Day view only).
   - **Linked venues**, if another venue shares its calendars with you.
   - **Status**: **All statuses**, **Pending**, **Booked**, **Confirmed**, **Started**, **Completed**, or **No Show**.
   - **Reset filters** puts everything back.
5. While filters are on, the button reads **Filter (1)**, **Filter (2)** and so on. ResNeo remembers your filters between visits.
6. In **Day** view, **Compact** shrinks the rows so the whole day fits on one screen.

> **Good to know:** Compact is ideal on a tablet, but the handle for changing a booking's length is hidden while it is on. Turn **Compact** off when you need to make an appointment longer or shorter. ResNeo remembers the setting for that browser tab, so if the handle is missing later, check Compact.

:::help-figure calendar-grid

### Week and Month views

- **Week** shows a table: one row per calendar under the **Team** heading and one column per day. Click any booking in it to open the details. Events and classes for the week sit in a strip underneath.
- **Month** shows how many bookings each day holds, with a coloured bar for each type: navy for team appointments, amber for events, green for classes, and grey for resources. Hover a bar to see its name. Days with nothing booked simply read **Open** or **Closed**. Click a day to open it in **Day** view.

## Take a booking from the grid

1. Click an empty slot in the column you want. A short menu opens.
2. Choose **New appointment**, or **Walk-in** for someone standing in front of you.
3. The form opens with that time and that person already filled in.

If a resource such as a room or a chair sits on that column, the same menu lists it under **Resources** as **Book** followed by its name. That opens the **Book resource** dialog.

## Block out time

Keep a slot free for a delivery, a break, or a chair that is out of action.

1. Click the empty slot where the block should start.
2. Choose **Block time**.
3. Set the **Start time** and **End time**. The **Duration** updates as you go.
4. Add a **Reason (optional)** so your team knows what it is for, then click **Save**. The block appears on the grid headed **Time blocked**.

Clients cannot book over blocked time online, and the grid will not let you drop a booking onto it. Press and hold a block to drag it to a new time, or pull its bottom edge to change its length. Click it to open **Edit block**, where you can change the details or **Delete** it.

> **Good to know:** on a column that belongs to a linked venue, the menu offers **New appointment** and **Walk-in** only. Blocks are set by the venue that owns the calendar.

## Move a booking by dragging

1. Press and hold the grip on the left of the card for about a second. **Hold to move** appears, then the card lifts.
2. Drag it where you want it. A green outline means it will land there. Amber means it lands outside your opening hours or over a break, which is allowed. Red means the slot is genuinely taken: booked leave, a block you made by hand, a class, or an event. Those will not drop.
3. Let go. A bar appears at the bottom of the screen saying where the booking went, for example **Moved Sam Jones to 11:15**, with the line **The customer will be notified in 60s unless you skip or undo.** and three buttons: **Notify now**, **Skip notify**, and **Undo**.

> **Warning: silence means send.** Leave that bar alone and the client is told about the change by email or text when the countdown ends. If you are only tidying your own diary, tap **Skip notify** before it runs out. **Undo** puts the booking back where it was and sends nothing.

> **Good to know:** dragging moves in one-minute steps. Dropping outside your opening hours is allowed, and so is dropping over a break or on top of another booking: you get a note reading **Moved outside opening hours.** or **Moved over a break.** rather than a refusal. Two bookings at the same time sit side by side in the column. In a visit with several services, each service is its own card and moves on its own; use **Modify** in the booking panel to move the whole visit.

The **Undo** button in the toolbar reverses your most recent move or length change.

## Change how long a booking lasts

1. Turn **Compact** off if it is on.
2. Press and hold the thin handle along the bottom edge of the card. **Hold to adjust** appears.
3. Drag down to make the appointment longer, or up to make it shorter. The new end time shows as you go, for example **Until 11:45**.
4. Let go. The new length saves straight away. There is no countdown and the client is not told, because the start time has not moved. **Undo** in the toolbar puts it back.

> **Good to know:** you can make a booking run past your closing time, or change the length of one that already sits outside your hours. You will see a note reading **Extended outside opening hours.** rather than a refusal.

## Move a booking to an exact time

Dragging is fiddly on a tablet. When a client is on the phone, use the form.

1. Click the booking, then click **Modify**. The **Modify appointment** window opens.
2. Change the **Service**, the **Staff / calendar**, the date, the time, or the duration. The **Quick durations** buttons are the fastest way to set a length.
3. Click **Save changes**. It stays greyed out until ResNeo has checked that the new slot is free.

A time outside your opening hours is allowed here too. The window shows a note saying so, and **Save changes** still works. The form is stricter than dragging: it refuses a time that clashes with another booking, a break, a block, or leave. If you need to double-book, drag the card on the grid instead.

If you changed the date or time, the window then shows **Time changed and saved** with the same 60-second countdown and three choices: **Notify now**, **Skip notify**, or **Undo change**. Closing the window without choosing sends the update. Other changes, such as a different service or a longer duration, save straight away.

## Cancel a booking, or mark a no-show

The buttons on a card only move a booking through its day. To cancel or record a no-show, click the booking to open its details, then use **Cancel** or **No-Show**. ResNeo asks you to confirm. Choose **Keep as is** if you clicked by mistake.

> **Warning:** if the client paid a deposit and you cancel while the booking is still inside its cancellation window, ResNeo refunds them automatically. Past the window nothing is refunded. If the refund itself fails, the booking is **not** cancelled and you will be told so.

> **No-show has a waiting time.** You cannot mark a no-show until your grace period after the start time has passed. It is 15 minutes unless you changed **No-show grace period (minutes)** under **Settings → Profile**.

## How a booking moves along

:::help-figure calendar-status

A booking starts **Pending** or **Booked**, and you move it on as the day goes. Each card carries the next step as a button:

- **Confirm** on a **Pending** booking makes it **Booked**.
- **Start** on a **Booked** or **Confirmed** booking makes it **Started**. **Undo start** goes back if you pressed it too soon.
- **Complete** on a **Started** booking makes it **Completed**. **Reopen** puts a completed booking back to **Started**.

**Confirmed** means the client has said they are coming, either by replying to the confirmation message ResNeo sends them or because you pressed **Confirm** in the booking details.

- **No Show** can be put back with **Undo No-Show** in the booking details.
- **Cancelled** is final. A cancelled booking cannot be brought back, so take the booking again.

**Arrived** is not a status. Tap it on the card when someone walks in, and the card says so until you start them. **Clear** removes it if you tapped the wrong card.

## Find a client without leaving the calendar

1. Tap the magnifier in the toolbar.
2. Type at least two characters of a name, phone number, or email.
3. Tap **Book** to start a booking with their details filled in, or **View** to open their record.

It searches every client you have, not just today's.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| The grid says **No calendars yet** | You have not added any team calendars | Add them under **Calendar Availability** |
| The grid says **No calendars working on this day** | **Only calendars working on the selected day** is on and everyone is off | Pick another day, or click **Show all calendars** |
| I cannot click a slot that looks empty | Something already holds it: a booking, blocked time, a class, an event, or the buffer after the previous service | Check the booking above it. If it has a buffer, that protected time is not bookable |
| There is no grip on the left of a card | The booking is **Completed**, **Cancelled**, **No Show**, or it is a resource booking | Only running bookings can be dragged. **Reopen** a completed one first |
| There is no handle at the bottom of a card | **Compact** is on | Turn **Compact** off |
| The drop area turns red | Something is already in that slot | Drop where the outline is green or amber, or move the other booking first |
| A booking I know exists is not on the grid | A calendar or status filter is on, or the **From** and **Until** hours are set too narrow | Open **Filter** and click **Reset filters**, then widen the hours in the date panel |
| The card has no buttons at all | It is cancelled, a no-show, or a resource booking | Open the booking for the full set of actions |
| A short booking is missing some buttons | There is not room on a small card | Click the booking to open it and get all of them |
| A cancelled booking vanished | Cancelled bookings are hidden on purpose | Find it on the bookings list with the **Cancelled** filter. You can read it, but not restore it |
| I cannot mark a no-show yet | The grace period after the start time has not passed | Wait for it, or shorten **No-show grace period (minutes)** under **Settings → Profile** |
| A booking moved and I did not move it | Clients can reschedule themselves from the link in their confirmation email | Check the **Timeline** in the booking details. To stop it, turn off **Guest self-reschedule** under **Settings → Booking Settings → Optional Booking features** |

## Next steps

- [Using the bookings list](/help/getting-started/bookings-list)
- [Taking a booking](/help/getting-started/new-booking)
- [Business and calendar hours](/help/getting-started/business-and-calendar-hours)
- [Your contacts (CRM)](/help/getting-started/contacts)`,
};
