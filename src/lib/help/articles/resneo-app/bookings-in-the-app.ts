import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: "bookings-in-the-app",
  title: "Finding and updating bookings",
  description: "Search, sort and filter the bookings list on your phone, swipe a row to accept or mark a no-show, and use the booking screen to call, reschedule, take payment or message a guest.",
  tags: ["app","mobile","bookings","appointments","search","filter","status","no-show","payment","compliance"],
  verified: '2026-09-06',
  content: `# Finding and updating bookings

The **Calendar** tab is your day as a grid. The tab next to it is the same information as a list, which is the quicker way to find one particular booking, work through a run of them, or look across a whole week.

On an appointments venue that tab is called **Appointments**.

## Step 1: Choose the period

Along the top are four buttons: **Day**, **Week**, **Month** and **Custom**.

- **Day**, **Week** and **Month** each have arrows either side of the date to step back and forward. Tap the date itself to jump back to today.
- **Custom** lets you set your own span. Tap the date label to open **Custom date range**, fill in **From** and **To**, then tap **Apply range**.

Under the date is a strip of totals for whatever you are looking at: **Total**, **Confirmed**, **Completed** and **No-shows**.

## Step 2: Search, sort and filter

The search box takes a name, a phone number or an email address. Beside it sit two small buttons.

**Sort bookings** (the up-and-down arrows) offers **Time**, **Client name**, **Status**, **Service**, **Staff**, **Deposit**, **Type** and **Party size**. The button in the corner of that panel switches between **Ascending** and **Descending**.

**Filter bookings** (the lines) opens **Filters**, with a section for each of:

- **Calendars**, when another venue shares its diary with you: **All**, **My venue**, then each linked venue.
- **Status**: **All**, **Pending**, **Booked**, **Confirmed**, **Started**, **Completed**, **Cancelled** and **No show**.
- **Staff**, starting with **All staff**.
- **Type**, starting with **All types**, for venues running classes, events or resources as well.
- **Time of day**, starting with **All day**.
- **Service**, starting with **All services**.
- **Compliance**, with a **Needs compliance** switch that leaves only the bookings still missing a form or a record.

Tap **Done** to apply. Whatever you have chosen then appears as a row of chips under the search box, so you can see at a glance what is being hidden. Tap the small cross on a chip to drop that one filter, or **Clear all** to start again.

## Step 3: Deal with a row without opening it

**Swipe a row from right to left** for the quick actions that suit its status:

- **Accept**, on a **Pending** booking. This is the one that turns a request into a booking.
- **No-show**, on a **Booked** or **Confirmed** booking. It only appears once the start time and your no-show grace period have passed, so you cannot mark a future booking as a no-show by accident.

If you tap **Accept** on a booking whose deposit has not been paid, the app stops and asks. You can **Send payment link**, **Accept without payment**, or **Go back**.

## Step 4: Work on several at once

**Press and hold** a row to start selecting. Tap any others you want, and a bar appears at the bottom with the count and two buttons:

- **Tag** opens **Add tag**. Type a tag name and tap **Add tag**. The tag goes on the contacts behind the bookings you picked, not on the bookings themselves, so it is there next time they come in.
- **Message** opens the composer for everyone you have selected.

The bar also has a control to select everything on screen, and one to clear the selection.

## Step 5: Open a booking

Tap a row to open the booking screen. At the top you get the guest, the time, the status, and badges where they apply: **Guest confirmed**, **Staff confirmed**, **Arrived**, **Deposit pending**, **Deposit failed** and **Linked**.

Under that is a row of round buttons you can scroll sideways:

- **Call** dials the guest's number.
- **Email** starts an email to them.
- **Reschedule** opens a date and time picker to move the booking.
- **Modify** changes the booking itself: the service, the person, the length, or the services in a visit.
- **Rebook** starts a new booking with the same service, the same person and the same guest already filled in.
- **New for guest** starts a blank booking for the same guest, so you can pick something different.

Which buttons you see depends on the booking. There is no **Call** without a phone number, and a cancelled booking cannot be rescheduled.

## Step 6: Change the status

Below the details are the status buttons. They follow where the booking has got to:

- **Pending**: **Accept**.
- **Booked** or **Confirmed**: **Start**, **No-show**, **Cancel booking**.
- **Started**: **Complete**, **Cancel booking**, **Undo Start**.
- **Completed**: **Reopen**.
- **No-show**: **Undo No-Show**.

**Cancel booking** and **No-show** ask you to confirm. The undo buttons apply straight away, because they put things back rather than changing anything for the guest.

## Step 7: Money and confirmations

The **Payments & confirmation** card holds what has been paid and what is outstanding.

- **Take payment** collects money in person, by card, cash or another method, and can also refund an earlier payment. What you can take depends on your card setup, which is covered in [Taking payments in the app](/help/resneo-app/payments-in-the-app).
- **Deposit actions** (it reads **Card hold actions** where a card hold is in play) appears only when there is a deposit to settle or refund. Inside it you can **Send payment link**, **Record cash payment** or **Waive deposit**.
- **Resend confirmation** sends the confirmation email again. Tap it once and it changes to **Tap to confirm resend**; tap again to send.
- If the guest can still cancel themselves, a line tells you until when.

A cancelled booking that still holds a deposit shows a **Deposit refund** panel with a **Refund deposit** button.

## Step 8: Compliance, notes and history

Further down the booking screen:

- **Details** lists the service, who it is with, the type, the location, the deposit or card hold, the guest's visit count, the source, and when the booking was created. There is a button to copy the booking reference.
- **Notes** is for anything the team needs to know.
- **Compliance** lists any forms or records this booking needs. Each one offers **View record** where you already have one, **Capture now** to fill it in on the spot with the guest in front of you, and **Send link** to email or text the form to them. Choosing **Send link** offers **Email**, **SMS** or **Copy link**. Anything a staff member still has to sign off shows **Awaiting decision**.
- **Guest history** shows what this guest has booked before.
- **SMS / Email guest** is a message composer with a log of everything already sent.
- **Activity** is the full timeline of what happened to this booking and when.

A cancelled booking also has a **Remove from diary** panel, which deletes it and its message log for good. It asks you to tap twice.

## What is different from the web

- The bookings list on the phone has **Custom** as a fourth period. The web dashboard has its own date controls.
- Deleting and resending ask you to tap twice rather than opening a pop-up, because a phone has less room for a dialog.
- Compliance forms can be filled in on the phone with the guest there, which is the main thing the app does that a desk cannot.

## Common problems & fixes

- **You cannot find a booking you know exists.** Check the period buttons first, then clear the filter chips. A stray **Status** or **Staff** filter is the usual culprit.
- **The swipe does not offer No-show.** It only appears after the start time plus your grace period. Open the booking and use the **No-show** button, or wait.
- **Accept was refused.** The deposit is unpaid. Choose **Send payment link** or **Accept without payment** in the panel that appears.
- **Tag did nothing.** Tags attach to contacts. If the bookings you picked have no saved contact behind them, there is nothing to tag.
- **A message did not send.** Check the guest has the email address or mobile number for the channel you chose, and check your SMS balance on the web under **Settings → Plan**.
- **Everything is read-only.** Either you are viewing a linked venue that has given you **View only** access, or the venue's subscription is past due. A link set to **Edit existing** or **Full management** lets you change their bookings from here. An admin can sort the plan out on the web.

## Next steps

- [Taking a booking in the app](/help/resneo-app/take-a-booking-in-the-app)
- [The diary on your phone](/help/resneo-app/diary-on-your-phone)
- [Taking payments in the app](/help/resneo-app/payments-in-the-app)
- [Using the bookings list on the web](/help/getting-started/bookings-list)`,
};
