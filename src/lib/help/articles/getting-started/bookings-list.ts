import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: "bookings-list",
  helpSection: "gs-run",
  title: "Using the bookings list",
  description: "Your one place to find every booking, open the details, update statuses, and message or tag several guests at once.",
  tags: ["bookings","appointments","list","filter","search","status","bulk actions","tags"],
  verified: '2026-09-08',
  content: `# Using the bookings list

The bookings list is where you find any booking, open it for the detail, change its status, and message or tag several clients at once. It is called **Appointments** in the sidebar, or **Bookings** once you also sell classes, events, or resources.

## Before you start

- A team member who looks after exactly one calendar opens this list already filtered to it. **Clear filters** returns to that calendar, not to everything.
- The list updates itself as bookings come in. The dot beside the toolbar reads **Live updates** while it is connected, and **Updates may be delayed** if it is not. The circular arrow refreshes by hand.

## Choose the dates you want

1. Click the view button (it shows the current view, such as **Day**) and pick **Day**, **Week**, **Month**, or **Custom**.
2. Use the arrows to move through your view.
3. On **Custom**, set a **From** and **To** date.
4. On **Day**, open the date button to narrow to a range of hours as well. **Clear time filter** removes that again.

:::help-figure bookings-row

## Filter the list

Click **Filter**. When filters are on, the button shows a count, like **Filter (2)**.

1. **Type** (only if you run more than one kind of booking): **All**, or **Appointment**, **Class**, **Event**, or **Resource**.
2. **Calendar**: **All appointments**, or one person or chair.
3. **Service**: **All services**, or one service. One at a time, not several.
4. **Status**: **All**, **Pending**, **Booked**, **Confirmed**, **Started**, **Completed**, **Cancelled**, or **No show**.
5. **Clear filters** starts over.

Use **Sort** above the rows to order by **Date**, **Time**, **Client**, **Status**, **Service**, **Staff**, **Deposit**, or **Type**, and the arrow beside it for **Asc** or **Desc**.

If you collect compliance forms, a **Needs compliance** button appears above the list with a count whenever forms are outstanding. Click it to show only those bookings, and **Clear** to show them all again.

:::help-figure bookings-filters

## Search for a client

1. Click the magnifier in the toolbar.
2. Type at least two characters of a name, phone, or email.
3. Click **Book** to start a booking with their details filled in, or **View** to open their record.

It searches every client you have, not just the dates on screen. The same search sits on the calendar and the day sheet.

## Open a booking

Click any row to open it in place. Click again to close. Inside you will find:

- The client's name, with a person icon beside it. **Open in Contacts** goes to their full record.
- **Payments and confirmation**: what is owed, what has been paid, and the money buttons.
- **Notes**: their tags, notes that live on the client record, and notes about this booking.
- **SMS / email guest**: a box to write to this client.
- **Compliance**: any forms this service needs.
- **Records**: documents and photos held for this client.
- **Guest bookings**: everything else they have booked, past and upcoming, each with **Rebook**.
- **Timeline**: when the booking was created, confirmed, changed, or cancelled.

If a client booked several services back to back, the row opens with a **Services in this visit** card listing each one with its own start time.

The small labels on a row tell you the rest at a glance: the status, **Deposit pending**, **Confirmed**, the price and its deposit status, **+1 extra**, the number of people, **Online** or **Client address**, **Linked** for a partner venue's booking, and a compliance label such as **2 forms due**.

## Change a booking's status

1. Open the booking's row.
2. Click the action for the next step.
3. It saves on its own.

Which moves are allowed depends on where the booking is:

- From **Pending** (waiting on a deposit or your approval): **Accept** or **Cancel**.
- From **Booked**: **Start**, **No-Show**, or **Cancel**. **Confirm** records that the client has confirmed they are coming, and **Cancel confirmation** undoes it.
- From **Started**: **Complete**, **Undo Start**, or **Cancel**.
- **Completed** offers only **Reopen**.
- **No-Show** can go back with **Undo No-Show**.
- **Cancelled** cannot go anywhere. Take the booking again instead.

**Arrived** marks that the client is with you before you start them, and **Clear** takes that off.

> **Good to know:** you cannot mark a no-show until your grace period has passed, which is 15 minutes unless you change **No-show grace period (minutes)** under **Settings → Profile**. If a slot was taken while you were working, you will be told the time is no longer available.

## Move a booking

Open the row and click **Modify**. The dialog is called **Modify appointment**, or **Modify visit** when the booking has several services in it. Change the **Service**, the **Variant**, the **Staff / calendar**, the **Date and time**, or the **Duration (minutes)**, then click **Save changes**.

If you changed the date, the time, or the length, ResNeo does not message the client straight away. A short follow-up appears saying **Time changed and saved**, with a countdown before the client is told. You can:

- **Notify now** to send it at once.
- **Skip notify** to save the change quietly.
- **Undo change** to put the booking back.

## Deposits, payments, and resending a confirmation

Open a row and look under **Payments and confirmation**. You will see buttons for the money side, depending on what is outstanding.

- **Send payment link** sends the client a link to pay what they owe.
- **Waive** clears the deposit for this booking only.
- **Record cash** marks the deposit as paid because they handed you the money.
- **Refund deposit** (or **Refund payment** when the service is paid in full) sends the money back through Stripe.
- **Resend confirmation** sends the confirmation again.

Where the booking holds a card instead of a deposit, you get a different set: **Resend link**, **Waive**, **Charge no-show fee**, **Refund no-show fee**, and **Release card hold**. Releasing the hold gives up your ability to charge the fee, so it asks you to confirm.

> **Warning:** cancelling inside the cancellation window refunds a deposit automatically. If that refund fails, the booking is **not** cancelled.

## Notes and tags on a booking

Open the row and expand **Notes**. There are four things in there, and they are not the same:

- **Tags** label the client, not the booking. Type in the box and press Enter, or pick one you have used before. Tags follow the client to every booking and to Contacts.
- **Customer info** is a lasting note on the client record, for things like allergies, access needs, or payment preferences. A client with one shows a **Guest note** label at the top of the booking.
- **Booking Notes** holds what the client typed when they booked.
- **Staff Notes for this booking** is yours alone. The client never sees it.

Each one saves with its own **Save** button.

## Message one client

Open the row, expand **SMS / email guest**, and write your message. Choose **Send via**: **Email & SMS (if available)**, **Email only**, or **SMS only**, then click **Send**. Anything already sent for this booking is listed in the same place.

## Processing time on a booking

Processing time is a wait where the client stays but you are free to see someone else, such as a colour developing. You set it per booking on the booking's detail card, which opens when you click the appointment on the calendar or the day sheet.

1. Find **Processing time** on the card.
2. Click **+ Add processing period**. The new period starts at the end of the appointment and runs on after it.
3. Set **Length (min)**, and for a wait in the middle of the appointment set **Start (min)**, counted from the start. **Remove** takes a period back out.
4. Click **Save processing time**.

The client still sees the service length. Time after the appointment is free on the calendar, and a later service in the same visit starts once it is over.

## Message or tag several clients at once

1. Tick each booking you want, or use **Select all**.
2. A tray appears showing how many are selected.
3. Click **Add tag** to label them, or **Message** to send them all the same email or text.
4. Click the **X** to clear your selection.

> **Good to know:** cancelling and marking no-shows is one booking at a time. There is no way to cancel a batch at once.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| A booking I expected is missing | A date, status, calendar, service, or time-of-day filter is hiding it | Widen the dates and click **Clear filters** |
| A colleague's booking is still hidden after clearing filters | Someone who looks after one calendar opens filtered to it | Set **Calendar** to **All appointments**, or ask an admin |
| I cannot pick the status I want | That move is not allowed from the current status | Move one valid step at a time |
| I cannot mark a no-show yet | The grace period has not passed | Wait until it has, then try again |
| The client was not told about a change I made | You clicked **Skip notify**, or the countdown was still running | Open the row and use **Resend confirmation** |
| **Add tag** says there is no contact to tag | None of the selected bookings has a contact record | Add the client's details first |
| I cannot find Cancel in the selection tray | The tray only offers **Add tag** and **Message** | Open the booking's row and cancel it there |
| I cannot see the deposit on my phone | Price and deposit labels are hidden on a narrow screen | Open the row to see them |
| The list says updates may be delayed | The live connection dropped | Click the circular arrow to refresh |

## Next steps

- [Taking a booking](/help/getting-started/new-booking)
- [Your contacts (CRM)](/help/getting-started/contacts)
- [Using the calendar](/help/getting-started/calendar)`,
};
