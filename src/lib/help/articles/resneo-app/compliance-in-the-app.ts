import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: "compliance-in-the-app",
  title: "Compliance in the app",
  description: "Track patch tests, consent forms and other records from your phone: capture a signature in the venue, send a link, read a record and set up your templates.",
  tags: ["app","mobile","compliance","consent","patch test","forms","signature","records","screenshots"],
  verified: '2026-09-06',
  content: `# Compliance in the app

If your venue keeps patch tests, consent forms, health questionnaires or certificates against clients, the app carries the whole thing in your pocket. Open **More**, then **Compliance**.

## Before you start

- **Compliance** only appears in **More** when your venue is on an appointments plan and compliance records are switched on.
- If they are not on, the screen says **Compliance isn't enabled**. An admin sees an **Enable compliance** button there and can turn it on straight away. Everyone else is asked to speak to an admin.
- The dashboard itself is open to your whole team, admins and staff alike. Only admins can reach **Compliance settings**.

## Screenshots are blocked on this screen

Compliance is the one screen in the app where screenshots and screen recording are switched off. On Android the screen refuses to capture and hides itself in the recent-apps preview; on iOS it is obscured while you are recording.

That is deliberate. Compliance records can hold special-category health data: patch test results, allergies, contraindications, things a client has told you in confidence. The block does not stop you doing your job, only the accidental screenshot that ends up in a group chat or a phone backup. Leave the screen and normal capture comes back at once.

The rest of the app deliberately allows screenshots, so you can still share an appointment with a client or send a colleague a picture of a booking.

## Step 1: Read the four sections

The card at the top counts what needs attention, or tells you that you are all caught up. Under it sit four sections.

- **Today's check-ins.** Today's bookings with a required form still outstanding, grouped by client and sorted by time. Each line names the form and what happens if it is missing: **Warn staff**, **Warn client**, **Block online booking** or **Block all bookings**. Every line has **Complete now** and **Send link**.
- **Missing for upcoming bookings.** Bookings in the next 14 days whose service needs a record that is not on file. Each row has **Send link** and **Booking**, which opens the booking.
- **Expiring soon.** Records on file that expire within 30 days, with **Send renewal** and **Contact**, which opens the client.
- **Awaiting client submission.** Form links you have sent that nobody has filled in yet, with when they were sent and when they expire, plus **Resend** and **Revoke**.

Pull down to refresh.

## Step 2: Complete a form in the venue

This is the check-in flow: the client is standing in front of you.

1. Tap **Complete now** on their line under **Today's check-ins**.
2. The form opens in **Client device** mode, with a **Client mode** badge and a line telling you to hand the phone over. Staff-only fields are hidden from the client.
3. If you would rather fill it in yourself, or alongside them, switch the control at the top to **Staff entering**. Be aware that switching modes clears anything already answered.
4. Work down the fields. Any guidance the form's author wrote appears at the top, and required fields are marked with a star.
5. A signature field offers **Draw** or **Type name**. Choose **Draw** and the client signs with a finger in the box marked **Sign here**; **Clear signature** wipes it and they start again. Choose **Type name** and typing their full name acts as the signature.
6. A file field opens your phone's file picker. PDFs and photos up to 10 MB are accepted.
7. Tap **Submit & save** (or **Save record** if you switched to **Staff entering**).

The record is filed against the client and the booking, and the line disappears from **Today's check-ins**.

> **Good to know:** you can start the same capture from a booking. Open the booking and use **Capture now** on its compliance card.

## Step 3: Send a link instead

When the client is not there, send them the form to fill in themselves.

1. Tap **Send link** on any outstanding line, or **Send renewal** on an expiring record.
2. Choose **Email**, **SMS**, or **Copy link** to put the address on your clipboard and share it however you like.

If the person has no email address and no phone number on file, the app tells you so and copies the link to your clipboard instead of failing.

Once sent, the form moves into **Awaiting client submission**.

## Step 4: Chase or cancel a link

In **Awaiting client submission**:

- **Resend** asks how the client should receive it, **Email** or **SMS**, and sends it again.
- **Revoke** asks you to confirm, then cancels the link so they can no longer submit it. Use it when you sent the wrong form, or to the wrong person.

## Step 5: Read a record

Records open from the **Compliance** card on a client (under **More details**) or on a booking. Tap any record to open the **Compliance record** sheet.

It shows the form's name, its result if there is one, and then:

- **Captured**, **Expires** and **Captured by**, which says whether the record came from staff entry, the client filling it in on your device, a link sent by email or SMS, the booking flow, the client's own account, or an import.
- Every question with the client's answer. **View signature** opens a signature; a file answer downloads.
- Any **Notes**.

If a client has completed a form but nobody has judged the outcome yet, an amber panel says **Needs a pass or fail decision**. Tap **Pass**, **Fail** or **Inconclusive**. Until you do, the record does not count towards their booking.

## Step 6: Void a record

Use this when a record is wrong, not when a client's circumstances have changed. There is no way to reverse it.

1. Open the record and tap **Void this record**.
2. Type a **Reason for voiding**, which is required.
3. Tap **Void record**.

Voiding is permanent. The record stays in the audit trail with the reason attached, but no longer counts towards compliance, and a **Voided** note appears at the top of the record.

## Step 7: Set up your types and requirements

The button at the bottom of **Compliance**, **Set up types and requirements**, opens **Compliance settings**. Admins only. It has three tabs.

**Templates** lists your compliance types. **Create custom type** builds one from scratch and **Add from library** starts you off from a ready-made template you can then edit. Each type can be edited or duplicated, and archived types are marked so.

**Requirements** maps those types onto your services, so the right form is asked for automatically when that service is booked. There is a row for **All bookings** and a row per service. If compliance records are switched off, this tab tells you to turn them on under **General** first.

**General** holds the venue-wide defaults:

- **Enable compliance records**, the switch that turns the dashboard, the forms and the booking checks on and off for the whole venue.
- **Default capture method** for new forms: **Staff**, **Client** or **Both**.
- **Form link channel**: **Email** or **SMS**.
- **Reminder cadence (days before expiry)**. Set 0 to switch expiry reminders off. The maximum is 90.
- **Form link expiry (days)**, between 1 and 90. A setting on an individual type still wins.
- **Lock period (hours before booking)**, how far ahead clients must finish required forms. 0 means no lock, and the maximum is 720 hours.
- **When a client arrives incomplete**, which currently warns staff.

Tap **Save settings** when you are done. Nothing on this tab saves on its own.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| No **Compliance** in **More** | Your venue is not on an appointments plan, or compliance records are switched off | An admin can turn them on with **Enable compliance**, or under **Compliance settings**, then **General** |
| The screen says **Compliance isn't enabled** | The same thing, seen from the dashboard | Admins tap **Enable compliance**; staff should ask an admin |
| My phone will not take a screenshot here | Screenshots and recording are blocked on this screen only | This is deliberate, to protect health data. Leave the screen and capture works again |
| **Complete now** is greyed out | The booking has no saved client, for example a walk-in with no details | Add the person to the booking first, then capture the form |
| Switching to **Staff entering** wiped the answers | Changing mode reloads the form's defaults | Choose the mode before you start filling it in |
| A record shows no result | Nobody has judged it yet | Open it and tap **Pass**, **Fail** or **Inconclusive** |
| I voided the wrong record | Voiding cannot be undone | Capture a fresh record; the voided one stays in the audit trail |
| No email or phone, so the link would not send | Nothing on file to send to | The app copies the link to your clipboard instead, so you can share it another way |
| **Compliance settings** is missing | You are signed in as staff, not an admin | Ask an admin |
| Nothing saves and a banner mentions being offline | Your phone has no connection | Reconnect and try again; the app does not queue changes |

## Next steps

- [Clients and contacts in the app](/help/resneo-app/clients-in-the-app)
- [Hours, breaks, leave and blocks in the app](/help/resneo-app/availability-in-the-app)
- [Compliance records](/help/getting-started/compliance)`,
};
