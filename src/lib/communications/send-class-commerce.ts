/**
 * Phase 2 §5.5 — class-commerce communications dispatcher.
 *
 * The existing `sendPolicyMessage` framework is keyed on a single booking
 * (`BookingEmailData`). The class-commerce keys here are emitted from non-booking
 * paths (PI fulfilment, cron, subscription sync), so we read the venue policy
 * directly to honour enabled/channels toggles in the Communications settings UI,
 * then render canonical bodies and send via SendGrid. v1 has no per-venue
 * customisation of these bodies.
 */

import { getSupabaseAdminClient } from '@/lib/supabase';
import { sendEmail } from '@/lib/emails/send-email';
import {
  CLASS_COMMERCE_MESSAGE_KEYS,
  getVenueCommunicationPolicies,
  type CommunicationMessageKey,
} from './policies';

interface VenueRowForComms {
  name: string | null;
  reply_to_email: string | null;
}

async function loadVenueAndUserEmail(opts: { venueId: string; userId: string }): Promise<{
  venue: VenueRowForComms | null;
  userEmail: string | null;
}> {
  const admin = getSupabaseAdminClient();
  const [{ data: venue }, { data: authUser }] = await Promise.all([
    admin.from('venues').select('name, reply_to_email').eq('id', opts.venueId).maybeSingle(),
    admin.auth.admin.getUserById(opts.userId),
  ]);
  return {
    venue: venue as VenueRowForComms | null,
    userEmail: authUser.user?.email?.trim().toLowerCase() ?? null,
  };
}

async function policyAllowsEmail(
  venueId: string,
  key: CommunicationMessageKey,
): Promise<boolean> {
  const policies = await getVenueCommunicationPolicies(venueId);
  const policy = policies.appointments_other[key];
  if (!policy?.enabled) return false;
  return policy.channels.includes('email');
}

function escapeHtmlForCommsBody(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function htmlParas(...paragraphs: string[]): string {
  return paragraphs
    .map((p) => `<p style="margin:0 0 14px 0">${escapeHtmlForCommsBody(p)}</p>`)
    .join('\n');
}

function moneyGbp(pence: number | null | undefined): string {
  if (pence == null || pence <= 0) return '£0.00';
  return `£${(pence / 100).toFixed(2)}`;
}

function formatLongDate(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

// ---------------------------------------------------------------------------
// Per-key body builders.
// ---------------------------------------------------------------------------

interface PurchasedVars {
  venueName: string;
  packName: string;
  creditsCount: number;
  expiresAtIso: string | null;
}
function bodyPurchased(v: PurchasedVars) {
  const subject = `Your ${v.creditsCount} class credit${v.creditsCount === 1 ? '' : 's'} at ${v.venueName}`;
  const expires = formatLongDate(v.expiresAtIso);
  const lines: string[] = [
    `Thanks for buying the ${v.packName} at ${v.venueName}.`,
    `${v.creditsCount} class credit${v.creditsCount === 1 ? '' : 's'} ${v.creditsCount === 1 ? 'is' : 'are'} now on your account.`,
  ];
  if (expires) lines.push(`They expire on ${expires}.`);
  lines.push('Sign in to your account to book a class.');
  return { subject, text: lines.join('\n\n'), html: htmlParas(...lines) };
}

interface ExpiringVars {
  venueName: string;
  creditsRemaining: number;
  expiresAtIso: string;
  daysUntilExpiry: number;
}
function bodyExpiring(v: ExpiringVars) {
  const subject = `Your class credits expire in ${v.daysUntilExpiry} day${v.daysUntilExpiry === 1 ? '' : 's'}`;
  const lines = [
    `You have ${v.creditsRemaining} class credit${v.creditsRemaining === 1 ? '' : 's'} at ${v.venueName} expiring on ${formatLongDate(v.expiresAtIso) ?? v.expiresAtIso.slice(0, 10)}.`,
    'Sign in to your account to book a class and use them before they expire.',
  ];
  return { subject, text: lines.join('\n\n'), html: htmlParas(...lines) };
}

interface RestoredVars {
  venueName: string;
  creditsRestored: number;
}
function bodyRestored(v: RestoredVars) {
  const subject = `Your class credits at ${v.venueName} have been restored`;
  const lines = [
    `We've restored ${v.creditsRestored} class credit${v.creditsRestored === 1 ? '' : 's'} to your account at ${v.venueName} following the cancellation of a booking.`,
    'Sign in to use them on another class.',
  ];
  return { subject, text: lines.join('\n\n'), html: htmlParas(...lines) };
}

interface CourseEnrolledVars {
  venueName: string;
  courseName: string;
  sessionCount: number;
  firstSessionDate: string | null;
}
function bodyCourseEnrolled(v: CourseEnrolledVars) {
  const subject = `You're enrolled in ${v.courseName} at ${v.venueName}`;
  const lines: string[] = [
    `You're enrolled in ${v.courseName} at ${v.venueName}.`,
    `Sessions in this course: ${v.sessionCount}.`,
  ];
  if (v.firstSessionDate) lines.push(`The first session is on ${formatLongDate(v.firstSessionDate)}.`);
  return { subject, text: lines.join('\n\n'), html: htmlParas(...lines) };
}

interface CourseRefundedVars {
  venueName: string;
  courseName: string;
  refundAmountPence: number;
}
function bodyCourseRefunded(v: CourseRefundedVars) {
  const subject = `Refund for ${v.courseName} at ${v.venueName}`;
  const refund = moneyGbp(v.refundAmountPence);
  const lines = [
    `Your enrollment in ${v.courseName} at ${v.venueName} has been cancelled.`,
    v.refundAmountPence > 0
      ? `A refund of ${refund} is being processed to your original payment method.`
      : 'No refund was issued (cancellation outside the refund window).',
  ];
  return { subject, text: lines.join('\n\n'), html: htmlParas(...lines) };
}

interface MembershipBaseVars {
  venueName: string;
  planName: string;
  periodEndIso: string | null;
}
function bodyMembershipStarted(v: MembershipBaseVars) {
  const subject = `Welcome to ${v.planName} at ${v.venueName}`;
  const periodEnd = formatLongDate(v.periodEndIso);
  const lines = [
    `You're now a member of ${v.planName} at ${v.venueName}.`,
    periodEnd ? `Your first renewal is on ${periodEnd}.` : 'Your subscription is active.',
  ];
  return { subject, text: lines.join('\n\n'), html: htmlParas(...lines) };
}
function bodyMembershipRenewed(v: MembershipBaseVars) {
  const subject = `Your ${v.planName} membership has renewed`;
  const periodEnd = formatLongDate(v.periodEndIso);
  const lines = [
    `Your ${v.planName} membership at ${v.venueName} has renewed.`,
    periodEnd ? `Next renewal: ${periodEnd}.` : 'You will be reminded again next renewal.',
  ];
  return { subject, text: lines.join('\n\n'), html: htmlParas(...lines) };
}
function bodyMembershipCancelling(v: MembershipBaseVars) {
  const subject = `Your ${v.planName} membership is scheduled to end`;
  const periodEnd = formatLongDate(v.periodEndIso);
  const lines = [
    `Your ${v.planName} membership at ${v.venueName} will end at the end of the current period${periodEnd ? ` (${periodEnd})` : ''}.`,
    'You will keep access until then. You can reactivate from your account.',
  ];
  return { subject, text: lines.join('\n\n'), html: htmlParas(...lines) };
}
function bodyMembershipEnded(v: { venueName: string; planName: string }) {
  const subject = `Your ${v.planName} membership has ended`;
  const lines = [
    `Your ${v.planName} membership at ${v.venueName} has ended.`,
    'Thanks for being a member — you can subscribe again any time from your account.',
  ];
  return { subject, text: lines.join('\n\n'), html: htmlParas(...lines) };
}

// ---------------------------------------------------------------------------
// Public sender. Returns true on send, false on skip / failure.
// ---------------------------------------------------------------------------

export type ClassCommerceCommsPayload =
  | { key: 'class_credits_purchased'; vars: PurchasedVars }
  | { key: 'class_credits_expiring'; vars: ExpiringVars }
  | { key: 'class_credits_restored'; vars: RestoredVars }
  | { key: 'class_course_enrolled'; vars: CourseEnrolledVars }
  | { key: 'class_course_refunded'; vars: CourseRefundedVars }
  | { key: 'class_membership_started'; vars: MembershipBaseVars }
  | { key: 'class_membership_renewed'; vars: MembershipBaseVars }
  | { key: 'class_membership_cancelling'; vars: MembershipBaseVars }
  | { key: 'class_membership_ended'; vars: { venueName: string; planName: string } };

export async function sendClassCommerceComm(opts: {
  venueId: string;
  userId: string;
  recipientEmailOverride?: string | null;
  payload: ClassCommerceCommsPayload;
}): Promise<{ sent: boolean; reason?: string }> {
  const { venueId, userId, payload } = opts;

  if (!CLASS_COMMERCE_MESSAGE_KEYS.includes(payload.key)) {
    return { sent: false, reason: 'unknown_key' };
  }
  if (!(await policyAllowsEmail(venueId, payload.key))) {
    return { sent: false, reason: 'disabled_by_policy' };
  }

  const { venue, userEmail } = await loadVenueAndUserEmail({ venueId, userId });
  const email = opts.recipientEmailOverride?.trim() || userEmail;
  if (!email) return { sent: false, reason: 'no_email' };

  // Fill venueName from the venues row when the caller passed a blank.
  const loadedVenueName = venue?.name?.trim() || '';
  if (loadedVenueName) {
    // Mutate payload.vars in place (single dispatch — safe).
    const vars = payload.vars as { venueName?: string };
    if (vars.venueName === undefined || vars.venueName === '') {
      vars.venueName = loadedVenueName;
    }
  }

  let rendered: { subject: string; text: string; html: string };
  switch (payload.key) {
    case 'class_credits_purchased':
      rendered = bodyPurchased(payload.vars);
      break;
    case 'class_credits_expiring':
      rendered = bodyExpiring(payload.vars);
      break;
    case 'class_credits_restored':
      rendered = bodyRestored(payload.vars);
      break;
    case 'class_course_enrolled':
      rendered = bodyCourseEnrolled(payload.vars);
      break;
    case 'class_course_refunded':
      rendered = bodyCourseRefunded(payload.vars);
      break;
    case 'class_membership_started':
      rendered = bodyMembershipStarted(payload.vars);
      break;
    case 'class_membership_renewed':
      rendered = bodyMembershipRenewed(payload.vars);
      break;
    case 'class_membership_cancelling':
      rendered = bodyMembershipCancelling(payload.vars);
      break;
    case 'class_membership_ended':
      rendered = bodyMembershipEnded(payload.vars);
      break;
    default: {
      // Exhaustiveness — should never hit.
      return { sent: false, reason: 'unknown_key' };
    }
  }

  const venueName = venue?.name?.trim() || 'your venue';
  try {
    await sendEmail({
      to: email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      fromDisplayName: venueName,
      replyTo: venue?.reply_to_email ?? null,
    });
    return { sent: true };
  } catch (err) {
    console.error('[sendClassCommerceComm] send failed', {
      key: payload.key,
      venueId,
      err: err instanceof Error ? err.message : String(err),
    });
    return { sent: false, reason: 'send_error' };
  }
}
