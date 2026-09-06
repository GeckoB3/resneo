import type { HelpArticle } from '../../types';
import { APPOINTMENTS_LIGHT_PRICE, APPOINTMENTS_PLUS_PRICE, APPOINTMENTS_PRO_PRICE } from '@/lib/pricing-constants';
import { REFERRAL_MAX_UNREDEEMED_CREDITS, REFERRAL_REFEREE_BONUS_DAYS } from '@/lib/referrals/constants';
import { SIGNUP_TRIAL_DAYS } from '@/lib/signup-trial-copy';

export const article: HelpArticle = {
  slug: "refer-and-earn",
  helpSection: "gs-grow",
  title: "Refer and earn",
  description: "Share ResNeo with other business owners and earn credit toward your own bill when they join.",
  tags: ["refer","referral","refer and earn","credit","rewards","share","invite"],
  verified: '2026-09-06',
  content: `# Refer and earn

Recommend ResNeo to another business and you both get something: they get an extra free month on top of their trial, you get a free month's credit off your bill.

## Before you start

- Refer and earn is admin only, under **Settings**, then the **Refer & Earn** tab. The tab is headed **Refer a venue, get a free month**.
- Your credit is added to your ResNeo billing account and Stripe takes it off your next invoice, so your venue needs to be on a paid plan with billing set up. A venue with no billing record (for example, one still on a Founding Partner plan) cannot be credited automatically.
- Your code only works while your own plan is active or in its trial (or cancelling with time left). If your plan is past due or has ended, new sign-ups cannot use it.

## How it works

1. You share your code or link.
2. They sign up through it and get the usual ${SIGNUP_TRIAL_DAYS}-day free trial, plus another ${REFERRAL_REFEREE_BONUS_DAYS} free days on top.
3. When they pay their first bill, you get a credit worth one month of **your own** plan: £${APPOINTMENTS_LIGHT_PRICE} on Light, £${APPOINTMENTS_PLUS_PRICE} on Plus, £${APPOINTMENTS_PRO_PRICE} on Pro. The tab shows the exact figure for your plan, and you get an email when the credit lands.
4. Stripe takes the credit off your next ResNeo invoice automatically.

:::help-figure refer-flow

> **Good to know:** the credit matches your plan at the time it is issued, not theirs. Only their first paid invoice counts, so a business that never moves onto a paid plan earns nothing, and a £0 invoice does not count.

## Step 1: Get your code

1. Open **Settings**, then **Refer & Earn**.
2. Under **Your referral code**, click **Copy** for the code on its own. Codes look like GREENWAY-X4F2: your venue name plus four characters.
3. Or under **Shareable link**, click **Copy** for a link that fills the code in for them. The button reads **Copied** for a moment.

Your link opens the **Choose your plan** page with a **Referred by** banner naming your venue. If they type the code instead, they click **Have a referral or sales code?** on the **Create your account** page and enter it in the **Referral or sales code** field. The same **Referred by** banner confirms it worked.

> **Tip:** the link is safer. A mistyped code shows **We couldn't find that code. You can still sign up without it.** A referral only counts if the code was in place when the account was created.

## Step 2: Track what you have earned

Three cards sit at the top of the tab:

- **Credits earned**: the total credited so far, with the number of referrals it came from.
- **Credit on next invoice**: what is waiting on your billing account right now. Applied automatically by Stripe.
- **In progress**: businesses that have signed up but not yet paid. Trialling now, credits when they pay.

:::help-figure refer-tracking

**Your referrals** lists each business with its **Status**, **Credit** and **Updated** date. Until someone signs up it reads **No referrals yet. Share your code above to get started.**

| Status | What it means |
| --- | --- |
| **Pending** | The referral was recorded but the new venue has not finished signing up |
| **Signed up, trialling** | They joined through your code but have not paid a bill yet |
| **Credited** | They paid, and your credit has been issued |
| **Did not convert** | They never moved onto a paid plan, or cancelled before their first paid invoice, so there is no credit |
| **Void** | A safety check stopped the credit |

When a referral is **Void** or **Did not convert**, the row is greyed out and ResNeo prints the reason under the venue's name. Read that first.

Referrals are voided when the new venue signed up on the same business email domain as yours (ordinary addresses like gmail.com are ignored), when they paid with the same card as your venue, or when your venue had no billing record at the time they paid.

> **Good to know:** there is a cap of ${REFERRAL_MAX_UNREDEEMED_CREDITS} credits per venue. Beyond that, a referral still shows as **Credited** with its amount, but the credit is held back rather than added to your billing account, so **Credit on next invoice** does not rise. Contact support to claim it.

## What the business you refer sees

- At sign-up: **Referred by** your venue, and **Your first month is free after your 14-day trial.**
- On their dashboard while trialling: **Your referral month is active.** with the trial length and their first charge date.
- Under **Settings**, then **Plan**: a trial breakdown showing the standard trial plus the days from referral by your venue.

## Common problems & fixes

| Problem | Likely cause | Fix |
| --- | --- | --- |
| There is no **Refer & Earn** tab | You are not an admin (the sidebar shows **Account** instead of **Settings**), or the referral programme is switched off at the moment | Ask an admin to check, or contact support |
| A referral says **Void** | A safety check flagged it | Read the reason under the venue name. If the businesses really are separate, contact support |
| A referral says **Did not convert** | They never paid a first invoice, or cancelled before it | Nothing to do. Credit only lands on a first paid bill |
| My credit has not reached my bill | Credit lands on the next invoice, not right away | Check **Credit on next invoice**. If you already have ${REFERRAL_MAX_UNREDEEMED_CREDITS} credits, the newest is held back; contact support |
| They signed up but nothing shows in **Your referrals** | The code was not in place when the account was created: they did not use your link, mistyped the code, or a sales code was applied, which takes precedence over a referral | Referrals only attach to brand-new sign-ups made with your code. Ask them to check the **Referred by** banner next time |
| Their sign-up said **We couldn't find that code** | The code was mistyped, or your own plan is not active or trialling | Check the code on your tab, and check **Settings**, then **Plan** |

## Next steps

- [Your plan and billing](/help/settings/plan-billing)
- [A tour of your dashboard](/help/getting-started/dashboard-overview)`,
};
