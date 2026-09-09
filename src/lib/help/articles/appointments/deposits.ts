import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: 'deposits',
  helpSection: 'setup',
  title: 'Deposits, full payments, card holds, and refunds',
  description: 'Stripe Connect, the four online payment options, card holds and no-show fees, the guest pay page, and every money action on a booking.',
  tags: ['stripe', 'payments', 'deposits', 'refunds', 'card hold', 'no-show'],
  verified: '2026-09-09',
  content: `
# Get paid the way you promise

ResNeo never holds your money. Card payments go through **Stripe Connect** straight to your own business account. Your job is to decide **when** money is due, **what** happens if someone does not turn up, and **what** you refund when they cancel.

## Before you start

Connect Stripe first. Nothing on this page works without it.

1. Open **Settings**, then the **Payments** tab.
2. Click **Start Stripe setup** and complete **Step 1: Business & bank details** on Stripe.
3. Come back and complete **Step 2: Identity verification**. It only becomes available once Step 1 is done, and Stripe can take a few minutes to be ready.

If you leave partway through, the card shows **Step 1 incomplete** with **Continue Stripe setup**. If Stripe wants your ID, it shows **Step 2: Identity verification required** with **Complete identity verification**.

Until both steps are finished, any service set to take money online shows the amber note **Stripe is not connected. Connect your Stripe account in Settings before guests can pay online.**

## Step 1: Choose the rule for each service

:::help-figure payments-flow

Open **Services** from the sidebar and edit a service. Under **Online payment when booking** there are four choices, and every service picks exactly one:

| Option | What the client does |
| --- | --- |
| **No online payment (pay at venue or arrange separately)** | Nothing. They book and pay you in person |
| **Custom deposit (fixed amount online)** | Pays a fixed amount you set, now |
| **Pay full price online at booking** | Pays the whole price now |
| **Card hold** | Saves a card. No money is taken |

- Choose **Custom deposit** and a **Deposit amount (£)** box appears. If the service uses **Multiple bookable options**, the box is **Default deposit (£)** and it fills in for any option that leaves its own deposit blank.
- Choose **Pay full price online at booking** and every option offered online needs a price above zero.
- Choose **Card hold** and you set a **No-show fee (£)**, which must be at least £1. With multiple options it is the **Default no-show fee (£)**.

Class types, ticketed events and resources have the same four choices. For classes and events the amount is **per person**.

> **Card holds are standard.** Every venue can use them. There is nothing to turn on and no flag to ask for.

## Step 2: Set your cancellation window

Under **Guest booking rules** on the same service, **Cancellation notice (hours)** decides what is refundable. Clients who cancel at least that many hours before the start get a full refund of a deposit or online payment. Cancel later than that and there is no refund, and no-shows are never refunded.

The same setting drives card holds. The consent line the client agrees to says you may charge the fee if they do not attend, or if they cancel less than that many hours before the booking starts.

Set it once per service and let your messages quote it, rather than promising something different in an email.

## What clients see when they book

Money that is due before the booking is confirmed is taken on a Stripe page. ResNeo never shows its own card boxes and never stores card numbers.

- **Deposit or full payment.** The page is headed **Pay your deposit**, shows a **Refund policy** panel with your exact deadline, and the button reads **Pay deposit**.
- **Card hold.** The page is headed **Secure your booking**, the booking panel says **No payment is taken today** with the maximum no-show fee, and the button reads **Save card**. Above it sits the consent line they are agreeing to.

Afterwards they land on one of these screens:

| Screen | Meaning |
| --- | --- |
| **Deposit paid** | The money went through, with the amount below |
| **Card saved** | The card is on file, the booking is confirmed, nothing was charged |
| **Almost done** | Their bank is still processing. The confirmation follows by email or text when it clears |

If a link sat open too long they see plain wording instead of Stripe jargon: that the booking timed out and the slot was released with no payment taken, or that it was cancelled because it was not completed in time.

## Bookings you take by phone or at the desk

Phone and walk-in bookings follow the same catalogue rules, so nobody gets a different deal by ringing up.

- **Deposit or full payment.** Create the booking and ResNeo sends the client a secure link to pay on their own device.
- **Card hold.** A **Card hold** switch appears on the booking form, off by default. Its line says what the current position does: **Off: no card is taken, so a no-show cannot be charged.** or **On: the guest gets a link to add their card, charged only if they do not show. The booking is cancelled if no card is added within 24 hours.**

The booking stays **Pending** until the money lands or the card is saved, then confirms on its own.

- After **2 hours** ResNeo sends one reminder with a fresh link.
- After **24 hours** an unpaid phone booking, or one with no card saved, is cancelled automatically and the slot is released.

A booking abandoned on your public page is swept much sooner, about 20 minutes, because the slot is being held from everyone else.

## Money actions on a booking

Open a booking from the bookings list or the diary and expand **Payments and confirmation**. What you see depends on the rule the service uses.

**Deposit and full payment bookings**

- **Send payment link** sends a fresh link by email or text. It works right up to the visit, including on bookings you already accepted unpaid.
- **Waive** writes the deposit off for this booking.
- **Record cash** marks it paid because they handed you the money.
- **Refund deposit** appears once it is paid. On a full payment service the same button reads **Refund payment**.
- **Resend confirmation** is always there.

The first three only appear while something is genuinely owed, so you cannot mark a zero deposit as paid by mistake.

**Card hold bookings**

Card holds replace those buttons with a card-aware set, so nobody records cash against a hold. A pill tells you the state at a glance: **Card request sent**, **Card held**, **Card hold ended**, **No-show fee charged** or **No-show fee refunded**.

- While you are waiting for the card: **Resend link** and **Waive**.
- Once the card is saved and the booking is a no-show: **Charge no-show fee**.
- After a charge: **Refund no-show fee**.
- On a booking kept chargeable by a late cancellation: **Release card hold**.

## Charge a no-show fee

1. Mark the booking as a no-show.
2. Open it and click **Charge no-show fee**.
3. The dialog is pre-filled with the full fee. Change **Amount to charge** if you want to take less, then click the confirm button, which reads **Charge** and the amount.

You can charge less than the agreed fee, never more. Only **admins** can charge or refund it, and if the card is declined the booking says so in plain words, for example that the card was declined or has expired.

You have **14 days** from the end of the booking. After that the button disappears and the booking explains that the charge window has ended. Held cards are released automatically once that window passes.

## Late cancellations

Card holds respect your **Cancellation notice (hours)**.

- Cancel in good time and the card is released. Nothing can be charged, and the client is told the card hold was released.
- Cancel late and the card stays on file. The booking says the cancellation was after the deadline, so the fee can still be charged, and the client is warned before they confirm.

If you asked for the cancellation, or you would rather let it go, open the cancelled booking and click **Release card hold**. It releases the card without charging and cannot be undone.

## Accepting a booking that has not paid

If you try to confirm or complete a booking that still owes money, ResNeo stops you with a **Deposit not paid** dialog. It names the amount and offers three ways out:

- **Send payment link** to ask the client again.
- **Accept without payment** to take the booking anyway and collect later.
- **Go back** to leave it alone.

## Links your clients get

- **Confirm or cancel** messages open a page with a **Deposit Policy** panel that quotes your refund hours, and buttons to keep or cancel the booking.
- The **manage booking** link shows **Deposit paid** with the amount, or, when a card is still owed, a panel saying to add card details to secure the booking with **No payment is taken** and an **Add card details** button.

## Keep your messages honest

Five cards under **Settings**, then the **Communications** tab, do the talking:

- **Deposit payment request** and **Deposit payment reminder**
- **Deposit confirmation**
- **Card details request** and **Card details reminder**

Turn each on or off, choose email, SMS or both, and add your own line where it helps. If you change a cancellation window, read these the same day so nobody quotes the old policy.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| Clients are not asked to pay | Stripe is not connected, or the service is set to **No online payment** | Finish both Stripe steps under **Settings**, then **Payments**, and check the service |
| I cannot see **Charge no-show fee** | You are not an admin, the booking is not a no-show, no card was saved, or the 14 days have passed | The booking's own note says which. Ask an admin, or mark the booking as a no-show first |
| **Record cash** is missing on a booking | It takes a card hold, not a deposit. No money was ever due | Use **Charge no-show fee** if they did not attend |
| A phone booking cancelled itself overnight | The deposit was unpaid, or no card was saved, 24 hours after you created it | Rebook, then use **Send payment link** or leave the **Card hold** switch on |
| The client says they were charged twice | A deposit and a separate no-show fee are two different charges | Open the booking and read the payment lines, then refund whichever was wrong |
| I want the fee back for a client | Charged in error, or you changed your mind | Open the booking and click **Refund no-show fee** (admins only) |
| Someone paid but the booking still says pending | Their bank is still processing | Wait for the **Almost done** case to clear, then refresh the booking |

## Next steps

- [Troubleshooting: Stripe](/help/troubleshooting/stripe-issues)
- [Connect Stripe payments](/help/getting-started/stripe-payments)
- [Set up your services](/help/appointments/services)
- [Guest communications](/help/appointments/communications)
`.trim(),
};
