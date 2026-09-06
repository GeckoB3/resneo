import type { HelpArticle } from '../../types';

export const article: HelpArticle = {
  slug: "stripe-payments",
  helpSection: "gs-set-up",
  title: "Connect Stripe to take payments",
  description: "Take card payments from clients by connecting Stripe in two simple steps, with your money going straight to your own bank.",
  tags: ["stripe","payments","connect","card payments","onboarding","settings","subscription","charges enabled"],
  verified: '2026-09-06',
  content: `# Connect Stripe to take payments

Connecting Stripe lets clients pay a deposit or the full price when they book, or leave card details for a no-show fee. Payments go directly to your connected payment account. ResNeo does not hold booking money.

## Before you start

- Do you need this today? Only if you want clients to pay online or leave a card. If you take payment in the chair, skip this page, share your booking link, and come back when you are ready.
- Sign in as an **admin**. Team members see **Account** in the sidebar instead of **Settings**, and their page has no **Payments** tab.
- Have these handy: your business details, the bank account you want paying into, and photo ID for the person who represents the business. Stripe asks for all of it, and hunting for a document is what makes this feel long.
- Already started? The **Stripe payments** step on your dashboard setup checklist (its **Connect Stripe** button) opens the same tab, and the card picks up where you left off.

It is two steps on ResNeo's side. Stripe asks for a fair amount of detail in between, so set aside fifteen minutes.

:::help-figure stripe-plan-vs-pay

> **Good to know:** these are two different things. **Plan** is what you pay ResNeo for the software. **Payments** is how your clients pay you, through Stripe Connect. This page is about **Payments**.

## Step 1: Business and bank details

1. Open **Settings** from the sidebar, then the **Payments** tab.
2. The **Stripe payments** card lists the two steps: **Step 1: Business & bank details**, and **Step 2: Identity verification**, which is greyed out and marked **Available after Step 1 is complete**.
3. Click **Start Stripe setup**. The button reads **Redirecting to Stripe…** for a moment, then Stripe opens.
4. Stripe asks for your business information and bank account details. Work through to the end and you are returned to ResNeo.

:::help-figure stripe-steps

> **Good to know:** if you stop partway through, the card shows an amber **Step 1 incomplete** notice when you come back, and the button reads **Continue Stripe setup**. Click it to carry on with the same Stripe account. You never start over. Read the warning below before you leave it unfinished.

## Step 2: Identity verification

Once step 1 is submitted, the card shows a blue **Step 2: Identity verification required** notice. Your business and bank details are in, and Stripe now needs to verify the identity of the account representative.

1. Back on the **Payments** tab, click **Complete identity verification**.
2. Upload the ID document Stripe asks for.
3. Finish and return to ResNeo.

> **Good to know:** the card's own note says it can take a few minutes for Stripe's verification system to be ready after step 1. If the verification page is not available yet, wait a moment and click **Complete identity verification** again.

## How you know you are ready

Both steps on the **Stripe payments** card get a green tick and read **Completed**, and the card shows **Stripe connected; charges enabled**. Under it sits **Account:** followed by a long reference starting \`acct_\`. That is your Stripe account number, and support may ask for it. The **Stripe payments** step on your setup checklist ticks off at the same moment.

> **Good to know:** if you have finished both Stripe screens but the card still shows **Step 2: Identity verification required**, Stripe has not yet enabled charges on your account. Stripe sometimes reviews new accounts, which can take a few hours and occasionally a day or two. Nothing is broken and there is nothing to redo. Refresh the page later, and watch for an email from Stripe asking for another document.

> **Warning: finish both steps before you ask clients for money.** While Stripe is unfinished, any service set to a deposit, full payment or card hold fails for your client at the last step of booking. They see a payment error and nothing live lands in your diary. Until the card shows **Stripe connected; charges enabled**, either finish Stripe or set those services back to **No online payment**.

If the card shows a red message such as **Failed to check Stripe status**, click **Retry**.

## Turn on online payment for a service

Connecting Stripe does not by itself ask anyone for money. You choose that service by service.

1. Open **Services** from the sidebar.
2. Click **Edit** on the service (or **Add service** for a new one).
3. Under **Online payment when booking**, choose one:
   - **No online payment (pay at venue or arrange separately)**
   - **Custom deposit (fixed amount online)**, then enter the **Deposit amount (£)**
   - **Pay full price online at booking**
   - **Card hold**: no payment is taken when the client books. Their card is stored securely and you can charge the **No-show fee (£)** you enter (at least £1) if they do not attend
4. Click **Save Changes** (or **Create Service**).

If the service has multiple bookable options, each option can carry its own deposit or no-show fee, and the **Default deposit (£)** or **Default no-show fee (£)** fills in any option left blank.

If Stripe is not finished, the form shows **Stripe is not connected. Connect your Stripe account in Settings before guests can pay online.** The service still saves, but clients cannot pay until Stripe is done, so finish Stripe first.

## Where your money goes

Client card payments go to your own Stripe account and out to the bank account you gave Stripe.

To see it, open **Settings**, then **Payments**, and click **Open Stripe dashboard**. Stripe opens in a new tab showing your payouts, balance and transactions. Payout timing is set by Stripe, not ResNeo.

> **Good to know:** taking a client's remaining balance in person, on your phone, is set up under **Settings**, then **Booking Settings**, in the **Taking payment in person** section: tick **Allow in-person card payments from the ResNeo app**. It has no effect until Stripe is connected. Not on this tab.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| Clients get a payment error and no booking appears | Stripe is not finished but a service asks for online payment | Finish both Stripe steps, or set that service to **No online payment** |
| The card says **Step 1 incomplete** and the button reads **Continue Stripe setup** | Step 1 was not completed | Click it and work through to the end |
| **Step 2: Identity verification** is greyed out and reads **Available after Step 1 is complete** | Step 1 is not finished | Click **Continue Stripe setup** and finish step 1 first |
| **Complete identity verification** does not open a working page | Stripe's verification system is not ready yet, which can take a few minutes after step 1 | Wait a moment and click it again |
| I finished both Stripe screens but the card still says **Step 2: Identity verification required** | Stripe is reviewing your account | Refresh later, and check your email for a Stripe request |
| The card shows a red message such as **Failed to check Stripe status** | ResNeo could not reach Stripe for a moment | Click **Retry** |
| I connected Stripe but nobody is charged | Every service is set to **No online payment** | Open **Services**, click **Edit**, and choose an option under **Online payment when booking** |
| I have no **Payments** tab | You are signed in as a team member, so the sidebar shows **Account** | Only admins can connect Stripe. Ask an admin |

## Next steps

- [Set up your services](/help/getting-started/services)
- [Deposits, full payment and card holds](/help/appointments/deposits)
- [Stripe problems](/help/troubleshooting/stripe-issues)
- [Your public booking page and embed](/help/getting-started/public-booking-page)
- [Your go-live checklist](/help/getting-started/setup-checklist)`,
};
