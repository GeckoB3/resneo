import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: "payments-in-the-app",
  title: "Taking payments in person",
  description: "Collect the balance at the end of an appointment with Tap to Pay, a Bluetooth card reader, cash or another method, and handle deposits, card holds and refunds from your phone.",
  tags: ["app","mobile","payments","tap to pay","card reader","stripe","cash","refund","deposit","card hold","in-person"],
  verified: '2026-09-12',
  content: `# Taking payments in person

The app can take the money at the end of an appointment. Your client taps their card, you record cash, or you note a bank transfer, and the booking's balance updates on the spot.

The money goes **straight into your own Stripe account**, the same one your online deposits are paid into. ResNeo never holds it.

Taking a payment is always optional. Nothing nags you, nothing opens by itself, and an appointment can be completed with a balance still outstanding.

## Before you start

- **Connect Stripe on the web first.** In-person card payments are paid into your connected Stripe account, so the switch below does nothing until that is set up. See [Connect Stripe to take payments](/help/getting-started/stripe-payments).
- **An admin turns the feature on.** Team members cannot.
- **Check which phone you have.** Tap to Pay, where the phone itself is the card reader, is **Android only** in this release. On iPhone and iPad the app takes cards through a **Bluetooth card reader** instead. This is not a ResNeo limitation: Apple grants the Tap to Pay entitlement for development only at the moment, so it cannot ship in the store build.

## Step 1: Switch on card payments at your venue

1. Sign in as an **admin** and open the **More** tab.
2. Scroll to **In-person payments**.
3. Turn on **Take card payments at your venue**. The description reads "Let your team collect an appointment's balance in person by tapping the client's card or phone. Money goes straight to your Stripe account."
4. A toast confirms **In-person payments turned on.**

If Stripe is not connected yet, an amber note appears asking you to connect Stripe first and pointing at **Plan & payments** on the web dashboard. Finish Stripe, and the card options start working.

> **Good to know:** team members do not see this switch. Once it is on, they see the **Card reader** row only, so anyone can pair hardware but only an admin decides whether the venue takes cards at all.

## Step 2: Pair a card reader (or use the phone)

On **Android**, you can charge a card with no hardware at all: the **Tap to Pay on this phone** button appears inside the payment sheet, and your client holds their card or phone near the top of yours.

For a Bluetooth reader (needed on iPhone and iPad, and optional on Android):

1. Open **More**, then tap **Card reader** under **In-person payments**.
2. The sheet explains: "Pair a Bluetooth card reader to take chip and contactless payments, including PIN."
3. Tap **Find a reader**. Keep the reader switched on and nearby.
4. Tap your reader in the list to connect it. Once connected the sheet shows **Connected:** and the reader's name, and its battery level.
5. Tap **Close**.

The app remembers the reader and reconnects to it next time. **Scan again** looks for another one, and **Forget this reader** unpairs it.

> **Good to know:** if the sheet says the reader is updating, leave it alone. The message reads "Updating your reader. Keep it nearby and switched on. This can take a few minutes." A low battery shows **charge it soon** beside the percentage.

## Step 3: Take the payment

1. Open the appointment from the **Calendar** or the bookings list.
2. Tap **Take payment**. It sits in the row of buttons at the top of the booking, beside **Arrived** and the confirm action, and again inside **Payments & confirmation**.
3. The sheet opens showing what is due, for example **£30.00 due**, with the client's name underneath.
4. Check the **Amount (£)** field. It is filled in with the full balance. Leave it to take everything, or change it to take part of it. On an appointment with no set price the field reads **Amount to charge (£)** and you type what the client is paying.
5. Choose how they are paying:
   - **Card payment**, then **Tap to Pay on this phone** (Android) or **Use card reader**. The screen tells you what to do: "Hold the client's card near the top of your phone", or "Hold the card to the reader, or insert the chip."
   - **Record cash**, then confirm with **Record £30.00 cash**.
   - **Record other payment** for a bank transfer, gift card or anything else. Add a **Note (optional)** and tap **Record £30.00**.
6. The sheet confirms **£30.00 collected**. If you took part of it, it also says how much is still outstanding. Tap **Done**.

> **Good to know:** card payments email the client a receipt automatically, and the sheet says so. Cash and other payments do not.

> **Warning:** recording cash writes a payment straight onto the booking, and only an admin can reverse it. The app makes you confirm for that reason.

### On a visit with several services

If the client is having more than one service in one visit, the balance covers the whole visit, not just the service you opened. The sheet says so under the amount, so a £30 service showing £90.00 due is not a mistake.

### If a card payment is still going through

Sometimes a card payment has not been confirmed by the time you look. The booking shows **Card payment processing** and the sheet offers **Wait and close**. Do not take another payment until it clears, or the client may be charged twice.

If it has been sitting there a while it changes to **Card payment unconfirmed**. Check the **Payment history** on the booking, or that payment in your Stripe dashboard, before collecting again. Nothing in the app can force a stuck payment through.

## Payment history

Every appointment keeps a **Payment history** inside **Payments & confirmation**: the amount, the method, the time and how it ended up. It deliberately includes failed and still-processing attempts, not just money taken, which is what makes it useful at the end of the day. Three rows show at first, and **Show N more** opens the rest.

## Refunds

Refunds are **admin only**.

1. Open the booking and tap **Refund a payment**, next to the payment history. On a settled booking the top button reads **Paid**, and that opens the same sheet.
2. The sheet lists what can be refunded, one button per payment, showing the amount and the method.
3. Tap the payment, then tap again to confirm. The button changes to **Tap again to refund £30.00** for a few seconds. **Cancel refund** backs out.

Refunds are for the full payment, and card refunds go back to the client's card.

## Deposits and card holds

Deposits taken when the client booked online are handled separately from in-person payments, on the same booking screen.

- Where a deposit is still owed or has been paid, a **Deposit actions** button appears. It offers **Send payment link**, **Record cash payment** and **Waive deposit** while the deposit is outstanding, and **Refund** once it is paid.
- Where the booking holds the client's card for a no-show fee, the button reads **Card hold actions** instead, and offers **Resend link**, **Waive**, **Charge no-show fee**, **Refund no-show fee** and **Release card hold**, depending on the state of the hold. Charging asks for an **Amount to charge (£)** first, and will not take more than the fee you set.
- A cancelled booking that still holds a paid deposit shows a **Deposit refund** card with a **Refund deposit** button.

There is more on how deposits and card holds work in [Deposits, full payment and card holds](/help/appointments/deposits).

## Accepting a booking whose deposit is unpaid

If you try to confirm or mark a client arrived on a booking whose deposit has not been paid, the app stops and shows **Deposit not paid**, with what is owed. You then have three choices:

- **Send payment link** to chase the money.
- **Accept without payment** to let the booking through anyway. The deposit stays collectable afterwards: the payment link keeps working, and the client gets their confirmation.
- **Go back**.

Accepting without payment is not the same as waiving. Waiving forgives the money; accepting keeps it owed.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| There is no **Take payment** button | The venue switch is off, the booking is cancelled, or it is already settled | An admin turns on **Take card payments at your venue** in **More**. A settled booking shows **Paid** instead |
| **Card payment** is missing but **Record cash** is there | Stripe is not connected for this venue | Finish Stripe on the web, under **Settings → Payments** |
| I cannot find **Tap to Pay on this phone** | You are on an iPhone or iPad | Use a Bluetooth card reader. Tap to Pay is Android only in this release |
| **Card reader** says in-person payments are not available on this version | An old app build | Update the app from the App Store or Google Play |
| The reader does not appear when scanning | It is off, out of range, or already connected to another phone | Switch it on, keep it close, and tap **Scan again** |
| The app asks for location permission | Stripe requires location for card-present payments on both platforms | Allow location for Resneo in your phone's settings, then try again |
| The amount will not save | Amounts above £1,000 are refused, and you cannot charge more than the balance | Enter an amount within the balance, or take it in stages |
| The payment sheet is stuck on "Getting the card reader ready" | The reader is still waking up | Tap **Cancel**, which always works, then try again or record cash instead |
| I recorded cash by mistake | Only an admin can reverse it | An admin opens the booking and uses **Refund a payment** |
| No **Refund a payment** button | Refunds are admin only, and need a settled payment to act on | Ask an admin |

## Next steps

- [Connect Stripe to take payments](/help/getting-started/stripe-payments)
- [Deposits, full payment and card holds](/help/appointments/deposits)
- [Finding and updating bookings](/help/resneo-app/bookings-in-the-app)
- [What you can only do on the web dashboard](/help/resneo-app/web-only-features)
- [Stripe problems](/help/troubleshooting/stripe-issues)`,
};
