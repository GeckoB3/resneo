import { SMS_INCLUDED_APPOINTMENTS, SMS_INCLUDED_LIGHT, SMS_INCLUDED_PLUS } from '@/lib/billing/sms-allowance';
import { SMS_OVERAGE_GBP_PER_MESSAGE } from '@/lib/pricing-constants';
import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: "communications",
  helpSection: "gs-grow",
  title: "Guest communications (email and SMS)",
  description: "Switch on automatic emails and texts so every confirmation, reminder, and follow-up reaches your guests without any extra work.",
  tags: ["communications","email","sms","reminders","templates","notifications","settings","messaging"],
  verified: '2026-09-06',
  content: `# Guest communications (email and SMS)

Keep clients in the loop without lifting a finger. ResNeo sends confirmations, reminders and follow-ups automatically. You decide which messages go out, by which channel, and when.

> **Good to know:** the body of every message is written for you and cannot be edited. What you control is which messages send, by email or text, when they send, and one extra line of your own wording.

:::help-video communications-setup

## Before you start

- Only an admin can change these settings. A team member can open the tab, but every switch and box is greyed out.
- Set your business email first under **Settings → Profile**. It is the address guests reply to, and the fallback for your own booking alerts.
- Open **Settings → Communications**. The panel is headed **Guest communications**.

> **Good to know:** changes save on their own. A small **Saving…**, then **Saved** note appears at the top right. If you see a red **Save failed, retrying next change**, check your connection and change something again, which starts a fresh save.

## Step 1: Find your way around the cards

Every guest message is a card, in one long list, with a switch on the right. On an appointments plan that is the only list there is. (The **Table bookings** and **Appointments & other** tabs only appear on the Restaurant plan, where table wording is kept separate.)

Each card carries a one-line description of when it sends:

- **Booking confirmation**, sent as soon as the booking is confirmed
- **Confirm or cancel prompt**, asks the guest to confirm or cancel before the visit
- **Pre-visit reminder**, a reminder shortly before the booking starts
- **Deposit payment request**, used when a booking needs a separate deposit payment link
- **Deposit confirmation**, confirms a deposit has been paid
- **Deposit payment reminder**, for unpaid deposit bookings before they are released
- **Card details request**, asks the guest to add card details to secure a booking with a no-show fee
- **Card details reminder**, for bookings that still need card details added
- **Booking modification**, sent when the booking details change
- **Cancellation confirmation**, sent when a booking is cancelled
- **Auto-cancel notification**, sent when an unpaid booking is cancelled automatically
- **No-show notification**, an optional notice when staff mark a booking as a no-show
- **Post-visit thank you**, a follow-up after the booking has taken place
- **Custom message**, the one-off notes your team sends by hand from a booking or a contact

If you use the waitlist, a separate **Waitlist invites** heading sits below the list with a **Waitlist invite** card. It only appears when **Appointment waitlist** is switched on under **Settings → Booking Settings → Optional Booking features**.

:::help-figure comms-lanes

## Step 2: Check what is already switched on

You are not starting from nothing. A new venue begins like this:

| Message | On to start? | Channels to start | Timing box |
| --- | --- | --- | --- |
| Booking confirmation | Yes | Email | None |
| Confirm or cancel prompt | Yes | Email | 24 hours before |
| Pre-visit reminder | Yes | Email | 2 hours before |
| Deposit payment request | Yes | Email and SMS | None |
| Deposit confirmation | Yes | Email | None |
| Deposit payment reminder | Yes | Email and SMS | 2 hours before |
| Card details request | Yes | Email and SMS | None |
| Card details reminder | Yes | Email and SMS | None |
| Booking modification | Yes | Email | None |
| Cancellation confirmation | Yes | Email | None |
| Auto-cancel notification | Yes | Email and SMS | None |
| No-show notification | No | Email | None |
| Post-visit thank you | Yes | Email | 4 hours after |
| Custom message | Yes | Email and SMS | None |
| Waitlist invite | No | Email | None |

> **Tip:** two hours is the default for the pre-visit reminder, and it is usually too late to save the slot. Most salons and barbershops move it to 24, so a client who has forgotten can still cancel and let someone else in.

## Step 3: Choose the channels

Switch a card on and its options appear underneath.

1. Tick **Email**, **SMS**, or both. The tickbox is the only thing that decides whether that channel is used.
2. Three cards are email only, so no SMS box is offered: **Deposit confirmation**, **No-show notification** and **Post-visit thank you**. The **New booking alert** further down the page is email only too.
3. You cannot untick the last remaining channel. Every message that is on needs at least one way to reach the client, so turn the whole card off instead.

## Step 4: Set the timing

Only four cards have a timing box, and the label tells you which way it counts:

- **Confirm or cancel prompt**, **Pre-visit reminder** and **Deposit payment reminder** show **Send hours before**.
- **Post-visit thank you** shows **Send hours after**.

Enter any whole number from 1 to 168 hours, which is up to a week. The other cards send off the back of something happening, such as a booking being made, changed or cancelled, so there is nothing to time.

## Step 5: Add your own line

You cannot rewrite the standard wording, but you can add to it.

1. Find the card you want and make sure it is switched on.
2. Look for **Email optional message**, and **SMS optional message** on cards that allow texts.
3. Type your line, for example "Any problems, just reply to this text or call the shop."
4. Watch the character count under the box, which matters most for texts.
5. Click **Preview** above the box to see the finished message, built from a sample booking, as a client would receive it.

:::help-figure comms-editor

## Business notifications

Below the guest cards, under **Business notifications**, are the alerts that come to you rather than to your clients.

**New booking alert** emails the business whenever a booking is made. Switch it on and a **Notification email** box appears. Leave it blank to use the email on your **Settings → Profile** tab, or type a different address, such as a shared inbox your whole team reads. This one is email only.

**Ask for a Google review** adds a review button to your post-visit thank you email.

1. Paste your review link from your Google Business Profile, or your Place ID, into **Google review link**. A Maps search link will not work, because it does not open the review box.
2. Click away from the box to save it, then use **Test this link** to check it opens the review form.
3. Switch **Ask for a Google review** on.

Each customer is asked at most once every six months, so your regulars are not pestered. Alongside the review button the email offers an unhappy customer the chance to tell you directly instead. Walk-ins with no saved contact details are never asked, because there is no record to count the six months against. The thank you email itself still goes out either way.

> **Tip:** for a daily summary of new bookings and cancellations rather than an email per booking, use the **Daily booking log email** panel under **Settings → Reports**. You choose the address and which days it sends.

## Sending a message yourself

The cards above are the automatic messages. You can also write to a client on the spot.

- **One client, from a booking.** Open the booking from the bookings list or the calendar, expand **SMS / email guest**, type your note, then set **Send via** to **Email & SMS (if available)**, **Email only**, or **SMS only**, and click **Send**.
- **Several bookings at once.** Tick the bookings in the list, then click **Message** in the bar that appears. Choose a **Channel**, write the **Message**, and click **Send**. The same message goes to each one, and anyone without the contact method you chose is skipped.
- **From Contacts.** Tick the clients you want and click **Message**, or open one client and use **Send a message**. Everything you send shows in that client's **Message log**.

> **Note:** all of these ride on the **Custom message** card. If you switch that card off, or untick its **SMS** box, your hand-written messages stop going out by that channel too.

## What texts cost, and where to check

Email is included on every plan and never charged. Texts come out of a monthly allowance.

| Your plan | Texts included each month |
| --- | --- |
| Appointments Light | ${SMS_INCLUDED_LIGHT} segments |
| Appointments Plus | ${SMS_INCLUDED_PLUS} segments |
| Appointments Pro | ${SMS_INCLUDED_APPOINTMENTS} segments |

A segment is up to 160 characters. Longer messages are split and each part counts. Emoji and accented characters drop the limit to 70 per segment, so one emoji can double what a message costs.

To see where you stand, open **Settings → Plan** and look at the **SMS usage** panel, which shows segments used against segments included.

> **Warning:** running out does not stop your texts. Past the allowance, messages keep sending and each extra segment is added to your next bill at ${Math.round(SMS_OVERAGE_GBP_PER_MESSAGE * 100)}p. There is no cut-off, so check the Plan tab after you turn SMS on for a busy message.

On **Appointments Light**, texts only start going out once you have a card on file. Until then a blue **SMS on Appointments Light** note sits at the top of the Communications tab, and ResNeo quietly sends the email and skips the text. Add a card under **Settings → Plan** to switch texts on.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| Clients are not getting texts | No mobile number on the booking, **SMS** is not ticked on that card, or you are on Light with no card on file | Check the client's phone number, tick **SMS**, and add a card under **Settings → Plan** |
| Every switch is greyed out | You are signed in with a team member login | Ask an admin to make the change |
| My text bill is higher than expected | Long messages split into several segments, and emoji drop the limit to 70 | Shorten your extra line and drop emoji. Check **SMS usage** under **Settings → Plan** |
| A red **Save failed, retrying next change** appears | Your connection dropped mid-change | Check your internet, then change something again to start a fresh save |
| I cannot untick the last channel | Every message that is on needs at least one way to reach the client | Turn the whole card off instead |
| I cannot find where to edit the wording | The main body is fixed and cannot be edited | Add your own line in **Email optional message** or **SMS optional message** |
| Messages my team sends by hand are not arriving | The **Custom message** card is off, or its **SMS** box is unticked | Switch the card back on and tick the channels you want |
| No review button in the thank you email | The **Google review link** is missing or is a Maps search link, or that client was asked in the last six months | Paste the proper review link and use **Test this link** |
| There is no **Waitlist invite** card | **Appointment waitlist** is switched off | Turn it on under **Settings → Booking Settings → Optional Booking features** |

## Next steps

- [Reading your reports](/help/getting-started/reports)
- [Using the bookings list](/help/getting-started/bookings-list)
- [Your contacts (CRM)](/help/getting-started/contacts)
- [Using the waitlist](/help/getting-started/waitlist)`,
};
