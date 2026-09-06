import { SMS_INCLUDED_APPOINTMENTS, SMS_INCLUDED_LIGHT, SMS_INCLUDED_PLUS } from '@/lib/billing/sms-allowance';
import { SMS_OVERAGE_GBP_PER_MESSAGE } from '@/lib/pricing-constants';
import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: 'sms-issues',
  title: 'SMS messages not sending',
  description: 'Why a text did not arrive: no mobile number, the SMS tickbox, the Light card requirement, and where to read the failure.',
  tags: ['sms', 'texts', 'twilio', 'communications'],
  verified: '2026-09-06',
  content: `
# SMS not sending

The email arriving while the text does not is nearly always one of four things. Work down them in order.

## 1. No mobile number on the client

A text needs a mobile number on the client's record. A UK number starting 0 is turned into +44 for you, but a landline or a mistyped number is refused by the network, and the email still goes out on its own. Check the number in **Contacts**, or on the booking.

## 2. SMS is not ticked on that message

Open **Settings**, then **Communications**. Find the card for the message you expected, check its switch is on, and tick **SMS**. Three cards are email only and never offer SMS: **Deposit confirmation**, **No-show notification** and **Post-visit thank you**, as is the **New booking alert** further down.

Messages your team writes by hand ride on the **Custom message** card. Untick its **SMS** box and those stop going by text too.

## 3. Appointments Light with no card on file

On **Appointments Light**, texts do not start until you have a card on file for your ResNeo subscription. Until then a blue **SMS on Appointments Light** note sits at the top of the Communications tab, and ResNeo quietly sends the email and skips the text, with nothing recorded as failed. Add a card under **Settings → Plan**.

## 4. It did send, and failed at the network

Open the booking and expand **SMS / email guest**. Under **Sent for this booking**, every attempt is listed with its channel, the message name, who it went to, and a status of **sent**, **delivered**, **failed** or **bounced**. A failed row shows the reason underneath. Copy that line into your Support ticket.

## Allowances, and a bill that surprised you

| Your plan | Segments included each month |
| --- | --- |
| Appointments Light | ${SMS_INCLUDED_LIGHT} |
| Appointments Plus | ${SMS_INCLUDED_PLUS} |
| Appointments Pro | ${SMS_INCLUDED_APPOINTMENTS} |

A segment is up to 160 characters, or 70 once a message contains an emoji or an accented character, so one emoji can double what a message costs. Running out does not stop your texts: each extra segment is added to your next bill at ${Math.round(SMS_OVERAGE_GBP_PER_MESSAGE * 100)}p. Check **SMS usage** on **Settings → Plan**, or **SMS segments this period** under **Settings → Reports**, which adds an **Overage** note once you are past the allowance. A venue on **Complimentary access** is the exception: sends simply stop at the cap instead of being billed.

## Nothing saves on the Communications tab

Either you are signed in as a team member, so every control is greyed out, or your subscription is past due, which blocks saving on every plan with **Billing is past due. Add or update your payment method under Settings → Plan to continue editing.** A red **Save failed, retrying next change** instead means the connection dropped: change something again to start a fresh save.

## Next steps

- [Guest communications (email and SMS)](/help/getting-started/communications)
- [Plan and billing](/help/settings/plan-billing)
- [Login, staff access and permissions](/help/troubleshooting/access-issues)
`.trim(),
  markdownRestaurant: `
# SMS not sending (Restaurant and Founding Partner)

## Communications

**Settings → Communications** uses the same lane and per message **SMS** toggles as on Appointments venues. Enable SMS only where you intend to text guests.

## Allowances

Restaurant tiers use the bundled SMS model with **£0.06** overage per segment beyond the included monthly count (see **Settings → Plan** for live figures). **Complimentary** venues cap sends without paid overage.

## Light banner does not apply

The **Appointments Light** “add a card before SMS” banner only appears for venues on that tier.

## Phone numbers and templates

Confirm the guest record has a mobile and that the relevant template still has **SMS** checked.

## Booking timeline

Inspect the booking **communication** timeline for failure reasons before escalating.

## Past due subscription

**Past due** blocks saving many venue settings, including Communications, until billing is repaired in the Stripe portal. Fix **Plan** first, then retest SMS.
`.trim(),
};
