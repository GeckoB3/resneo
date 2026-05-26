import { SMS_OVERAGE_GBP_PER_MESSAGE } from '@/lib/pricing-constants';

/** Free trial length for new paid-plan signups only (not upgrades or resubscribes). */
export const SIGNUP_TRIAL_DAYS = 14;

export const SIGNUP_TRIAL_SHORT_LABEL = `${SIGNUP_TRIAL_DAYS}-day free trial`;

export function signupTrialThenPrice(monthlyPrice: number): string {
  return `${SIGNUP_TRIAL_SHORT_LABEL}, then £${monthlyPrice}/month`;
}

export const SIGNUP_TRIAL_CARD_NOTICE =
  'Add your card at checkout. Your subscription is free for 14 days; the first monthly charge is after the trial.';

export function signupTrialSmsDuringTrialNotice(): string {
  const overagePence = Math.round(SMS_OVERAGE_GBP_PER_MESSAGE * 100);
  return `Your included SMS allowance applies during the trial. Additional messages are ${overagePence}p each.`;
}

export const SIGNUP_TRIAL_NO_REPEAT_NOTICE =
  'Free trial applies to new signups only (not plan upgrades or resubscribes).';

export const SIGNUP_TRIAL_PAYMENT_FAILURE_NOTICE =
  'If your card cannot be charged when the trial ends, your subscription is paused until you update payment.';

export const SIGNUP_TRIAL_FOOTER_NOTICE = `${SIGNUP_TRIAL_SHORT_LABEL} on all paid plans for new customers. ${SIGNUP_TRIAL_CARD_NOTICE} ${signupTrialSmsDuringTrialNotice()} ${SIGNUP_TRIAL_NO_REPEAT_NOTICE}`;

/** Homepage pricing section — trial, SMS, fees, and cancellation in one concise block. */
export function publicPricingFooterDisclaimer(): string {
  const overagePence = Math.round(SMS_OVERAGE_GBP_PER_MESSAGE * 100);
  return (
    `New signups: ${SIGNUP_TRIAL_DAYS}-day free trial on paid plans (card required; first monthly charge after the trial). ` +
    `Included SMS applies during the trial; extra messages ${overagePence}p each. ` +
    `Not for upgrades or resubscribes. No per-booking fees or commission. ` +
    `Standard payment provider fees may apply. ` +
    `Cancel with 30 days\u2019 notice\u2014subscription stays active until the notice period ends.`
  );
}
