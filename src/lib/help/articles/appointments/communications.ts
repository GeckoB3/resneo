import { SMS_INCLUDED_APPOINTMENTS, SMS_INCLUDED_LIGHT, SMS_INCLUDED_PLUS } from '@/lib/billing/sms-allowance';
import { SMS_OVERAGE_GBP_PER_MESSAGE } from '@/lib/pricing-constants';
import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: 'communications',
  helpSection: 'growth',
  title: 'Automated messages, channels, and timing',
  description: 'Every message card under Settings, Communications: when each one sends, which channels it offers, what starts switched on, the timing boxes, previews, business notifications, and what texts cost.',
  tags: ['sms', 'email', 'templates', 'reminders', 'custom message', 'bulk message', 'marketing permission', 'marketing consent', 'opt out', 'skipped'],
  verified: '2026-09-12',
  content: `
# Automated messages, channels, and timing

Every message ResNeo sends your clients is a card under **Settings → Communications**. You choose which cards are on, whether each goes by email or text, when the timed ones send, and one extra line in your own words. The body of each message is written for you and cannot be edited.

## Before you start

- Only an admin can change these settings. A team member can open the tab, but every switch and box is greyed out.
- Set your business email under **Settings → Profile** first. It is the address clients reply to, and the fallback for your own alerts.
- Open **Settings → Communications**. The panel is headed **Guest communications**.
- Changes save on their own. A **Saving…**, then **Saved** note appears at the top right. A red **Save failed, retrying next change** means the last change did not save: check your connection, then change something again to start a fresh save.

## One list, not two lanes

On an Appointments plan (Light, Plus or Pro) there is a single list of message cards covering appointments, classes, events and resources. The **Table bookings** and **Appointments & other** lane tabs belong to the Restaurant plan, where table wording is kept separate. If you have read about picking a lane, that is the restaurant product, not yours.

:::help-figure comms-lanes

:::help-video communications-setup

## The message cards

Fourteen cards sit in this order, each with a one-line description and a switch on the right.

| Card | Sends when | Channels offered | New venue starts | Timing box |
| --- | --- | --- | --- | --- |
| **Booking confirmation** | The booking is confirmed | Email, SMS | On, email | None |
| **Confirm or cancel prompt** | Before the visit, asking the client to confirm or cancel | Email, SMS | On, email | **Send hours before**, 24 |
| **Pre-visit reminder** | Shortly before the booking starts | Email, SMS | On, email | **Send hours before**, 2 |
| **Deposit payment request** | A booking needs a separate deposit payment link | Email, SMS | On, both | None |
| **Deposit confirmation** | A deposit has been paid | Email | On | None |
| **Deposit payment reminder** | An unpaid deposit booking is close to being released | Email, SMS | On, both | **Send hours before**, 2 |
| **Card details request** | A booking with a no-show fee needs card details | Email, SMS | On, both | None |
| **Card details reminder** | A booking still has no card details | Email, SMS | On, both | None |
| **Booking modification** | The booking details change | Email, SMS | On, email | None |
| **Cancellation confirmation** | A booking is cancelled | Email, SMS | On, email | None |
| **Auto-cancel notification** | An unpaid booking is cancelled automatically | Email, SMS | On, both | None |
| **No-show notification** | Staff mark a booking as a no-show | Email | Off | None |
| **Post-visit thank you** | After the booking has taken place | Email | On | **Send hours after**, 4 |
| **Custom message** | Your team writes to a client by hand | Email, SMS | On, both | None |

A fifteenth card, **Waitlist invite**, sits under its own **Waitlist invites** heading below the list. It starts switched off, and it only appears when **Appointment waitlist** is on under **Settings → Booking Settings → Optional Booking features**.

> **Tip:** two hours is the default for the pre-visit reminder, and it is usually too late to save the slot. Most salons and clinics move it to 24, so a client who has forgotten can still cancel and let someone else in.

## Choose the channels

Switch a card on and its options appear underneath.

1. Tick **Email**, **SMS**, or both. The tickbox is the only thing that decides whether that channel is used.
2. Three cards are email only, so no SMS box is offered: **Deposit confirmation**, **No-show notification** and **Post-visit thank you**.
3. You cannot untick the last remaining channel. Every message that is on needs at least one way to reach the client, so switch the whole card off instead.
4. A text only goes out when the booking has a mobile number on it.

## Set the timing

Only the four cards marked in the table above have a timing box, and the label tells you which way it counts. Enter any whole number from 1 to 168 hours, which is up to a week. Every other card fires off the back of something happening, such as a booking being made, changed or cancelled, so there is nothing to time.

## Add your own line, then preview

You cannot rewrite the standard wording, but you can add to it.

1. With the card switched on, find **Email optional message**, and **SMS optional message** on cards that allow texts.
2. Type your line, for example "Any problems, just reply to this text or call the shop."
3. Watch the character count under the box, which matters most for texts.
4. Click **Preview** above the box. A window opens headed **Preview:** with the card name and channel, showing the finished message built from a sample booking, and a line naming the sample used.

Previews are built from sample data, so after a change that really matters, make a real test booking and read what arrives.

> **Bookings with more than one service:** a text names all of them, so a cut and a colour booked together read "Cut and Colour", and four services read "Cut, Colour and 2 more". The time in the message is the start of the first service, not whichever one happened to trigger the send. Several people booked together instead read "3 appointments". The staff member is named only when the whole booking is with one person.

## Business notifications

Below the guest cards, **Business notifications** covers the alerts that come to you rather than to your clients.

**New booking alert** emails the business whenever a booking is made. Switch it on and a **Notification email** box appears. Leave it blank to use the email on your **Settings → Profile** tab, or type another address, such as a shared inbox. This one is email only.

**Ask for a Google review** adds a review button to your post-visit thank you email.

1. Paste your review link from your Google Business Profile, or your Place ID, into **Google review link**. A Maps search link will not work, because it does not open the review box.
2. Click away from the box to save it, then use **Test this link** to check it opens the review form.
3. Switch **Ask for a Google review** on.

Each customer is asked at most once every six months. Alongside the review button, the email offers an unhappy customer the chance to tell you directly instead. Walk-ins with no saved contact details are never asked, and the thank you email still goes out either way.

> **Tip:** for one daily summary of new bookings and cancellations rather than an email per booking, use the **Daily booking log email** panel under **Settings → Reports**.

## Messages your team sends by hand

The cards above are the automatic messages. Your team can also write to a client on the spot.

- **From a booking.** Open it from the bookings list or the calendar, expand **SMS / email guest**, type your note, set **Send via**, and click **Send**.
- **Several bookings at once.** Tick them in the bookings list, then click **Message** in the bar that appears. Anyone without the contact method you chose is skipped. Marketing permission is not needed here: these are notices about a booking those people have already made.
- **From one contact.** Open the client in **Contacts** and use **Send a message**. This always sends.
- **Several contacts at once.** Tick them in the **Contacts** list and click **Message**. This one counts as a broadcast, so it only reaches contacts who have given marketing permission, and the rest are skipped with a count in the confirmation. If none of them has permission, nothing is sent.

Everything sent shows in that client's **Message log**.

Under the box you type in, a line reminds you that **Enter** starts a new line and a blank line starts a new paragraph, and counts your characters. When SMS is one of the channels it also says roughly how many texts it will take, and turns amber with **(SMS will be cut short)** as you approach the limit. A custom text can run to three segments, about 459 characters including your venue name at the front. Email has no such limit.

A custom message email is its own plain design: your logo and venue name, "Hi Sam,", your words with the paragraphs you typed, and your address, phone and website underneath. It never carries booking details, even when you started it from a booking.

> **Marketing permission** means **Marketing consent** is recorded and **Opt out of marketing** is not, both on the contact's **Preferences**. An old consent never outlives an unsubscribe: if someone opts out, they stay out until they opt in again.

> **Note:** all of these ride on the **Custom message** card. Switch that card off, or untick its **SMS** box, and your hand-written messages stop going out by that channel too.

## What texts cost

Email is included on every plan and is never charged. Texts come out of a monthly allowance.

| Your plan | Texts included each month |
| --- | --- |
| Appointments Light | ${SMS_INCLUDED_LIGHT} segments |
| Appointments Plus | ${SMS_INCLUDED_PLUS} segments |
| Appointments Pro | ${SMS_INCLUDED_APPOINTMENTS} segments |

A segment is up to 160 characters. Longer messages are split and each part counts. Emoji and accented characters drop the limit to 70 per segment, so one emoji can double what a message costs.

Running out does not stop your texts. Past the allowance they keep sending, and each extra segment is added to your next bill at ${Math.round(SMS_OVERAGE_GBP_PER_MESSAGE * 100)}p. Check **SMS usage** under **Settings → Plan**, or **SMS segments this period** at the top of **Settings → Reports**.

On **Appointments Light**, texts only start going out once you have a card on file. Until then a blue **SMS on Appointments Light** note sits at the top of the Communications tab, and ResNeo quietly sends the email and skips the text.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| Every switch is greyed out | You are signed in with a team member login | Ask an admin to make the change |
| Clients are not getting texts | No mobile number on the booking, **SMS** is not ticked on that card, or you are on Light with no card on file | Check the number, tick **SMS**, and add a card under **Settings → Plan** |
| A red **Save failed, retrying next change** appears | The last save did not reach ResNeo | Check your connection, then change something again |
| I cannot untick the last channel | Every message that is on needs one way to reach the client | Switch the whole card off instead |
| I cannot find where to edit the wording | The body of each message is fixed | Add your line in **Email optional message** or **SMS optional message** |
| Messages my team sends by hand are not arriving | The **Custom message** card is off, or its **SMS** box is unticked | Switch it back on and tick the channels you want |
| There is no **Waitlist invite** card | **Appointment waitlist** is switched off | Turn it on under **Settings → Booking Settings → Optional Booking features** |
| No review button in the thank you email | The **Google review link** is missing or is a Maps search link, or that client was asked in the last six months | Paste the proper review link and use **Test this link** |
| My text bill is higher than expected | Long messages split into several segments, and emoji drop the limit to 70 | Shorten your extra line, drop emoji, and watch **SMS usage** under **Settings → Plan** |

## Next steps

- [Guest communications (email and SMS)](/help/getting-started/communications)
- [SMS messages not sending](/help/troubleshooting/sms-issues)
- [Reports, exports, and the Clients directory](/help/appointments/reports)
- [Managing your plan and billing](/help/settings/plan-billing)
`.trim(),
};
