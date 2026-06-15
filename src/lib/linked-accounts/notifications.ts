/** Email notifications for Linked Accounts events (§9). Email-only; no SMS. */

import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/emails/send-email';
import { renderLinkEmail, type LinkEmailParams } from '@/lib/emails/templates/linked-account-emails';
import { loadActiveAdminStaff } from './queries';
import { formatNotificationCopy } from './notification-center';
import {
  classifyCrossVenueWrite,
  resolveLinkedNotificationPrefs,
} from './notification-prefs';

function settingsUrl(): string {
  const base = (process.env.NEXT_PUBLIC_BASE_URL || 'https://www.resneo.com').replace(/\/$/, '');
  return `${base}/dashboard/settings?tab=linked-accounts`;
}

/** Recipients for a venue: its contact email plus every active admin login. */
async function venueRecipients(admin: SupabaseClient, venueId: string): Promise<string[]> {
  const recipients = new Set<string>();
  const { data: venue } = await admin
    .from('venues')
    .select('email')
    .eq('id', venueId)
    .maybeSingle();
  const venueEmail = (venue?.email as string | null)?.trim();
  if (venueEmail) recipients.add(venueEmail.toLowerCase());

  const admins = await loadActiveAdminStaff(admin, venueId);
  for (const a of admins) {
    if (a.email?.trim()) recipients.add(a.email.trim().toLowerCase());
  }
  return [...recipients];
}

async function venueName(admin: SupabaseClient, venueId: string): Promise<string> {
  const { data } = await admin.from('venues').select('name').eq('id', venueId).maybeSingle();
  return (data?.name as string | null)?.trim() || 'Your venue';
}

/** In-app notification metadata for a lifecycle event (§17 Phase 4). */
export interface LinkInAppMeta {
  type?: string;
  category?: string;
  linkId?: string | null;
  collectiveId?: string | null;
  actorVenueId?: string | null;
  payload?: Record<string, unknown>;
}

/**
 * Send one Linked Accounts email to every recipient of a venue, and (by default)
 * record an in-app notification for that venue so the event also appears in the
 * notification bell (§17.2). The notification carries the email's subject as its
 * title and the first paragraph as its body, so in-app and email copy stay in
 * sync. Pass `inApp: false` to suppress the in-app row — used by the cross-venue
 * booking-write email, which the DB trigger already records to avoid a duplicate.
 */
/** Result of {@link notifyVenue} — `emailFailures` feeds the cron health signal (§16.1 #8). */
export interface NotifyResult {
  emailFailures: number;
}

export async function notifyVenue(
  admin: SupabaseClient,
  venueId: string,
  subject: string,
  params: Omit<LinkEmailParams, 'recipientVenueName'>,
  inApp: LinkInAppMeta | false = {},
): Promise<NotifyResult> {
  // In-app notification — independent of email recipients (any staff sees the bell).
  if (inApp !== false) {
    try {
      await admin.from('account_link_notifications').insert({
        venue_id: venueId,
        type: inApp.type ?? 'link_lifecycle',
        category: inApp.category ?? 'lifecycle',
        link_id: inApp.linkId ?? null,
        collective_id: inApp.collectiveId ?? null,
        actor_venue_id: inApp.actorVenueId ?? null,
        payload: {
          title: subject,
          body: params.paragraphs?.[0] ?? null,
          ...(inApp.payload ?? {}),
        },
      });
    } catch (err) {
      console.error('[linked-accounts] notifyVenue in-app insert failed:', err);
    }
  }

  try {
    const [recipients, name] = await Promise.all([
      venueRecipients(admin, venueId),
      venueName(admin, venueId),
    ]);
    if (recipients.length === 0) return { emailFailures: 0 };
    const { html, text } = renderLinkEmail({ ...params, recipientVenueName: name });
    const settled = await Promise.allSettled(
      recipients.map((to) => sendEmail({ to, subject, html, text })),
    );
    // §16.1 #8 — surface delivery failures rather than swallowing them, so the
    // cron health signal (and any caller that cares) can see them.
    const emailFailures = settled.filter((s) => s.status === 'rejected').length;
    if (emailFailures > 0) {
      console.error(
        `[linked-accounts] notifyVenue: ${emailFailures}/${recipients.length} sends failed for venue ${venueId}`,
      );
    }
    return { emailFailures };
  } catch (err) {
    console.error('[linked-accounts] notifyVenue failed:', err);
    // Couldn't even attempt delivery (recipient/render failure) — count as one failure.
    return { emailFailures: 1 };
  }
}

export async function notifyLinkRequestReceived(
  admin: SupabaseClient,
  recipientVenueId: string,
  requesterVenueName: string,
  permissionBullets: string[],
): Promise<void> {
  await notifyVenue(admin, recipientVenueId, `${requesterVenueName} wants to link with you`, {
    heading: 'New linked-account request',
    paragraphs: [
      `${requesterVenueName} has asked to link their ResNeo venue with yours.`,
      'Linking lets you share calendar visibility and booking access while keeping all client and booking data separate. You can accept, adjust the permissions, or reject the request.',
    ],
    bullets: permissionBullets,
    ctaLabel: 'Review request',
    ctaUrl: settingsUrl(),
  });
}

export async function notifyLinkAccepted(
  admin: SupabaseClient,
  requesterVenueId: string,
  recipientVenueName: string,
  withChanges: boolean,
  changeBullets: string[],
  bulletsAreDiff = false,
): Promise<void> {
  const secondParagraph = !withChanges
    ? null
    : bulletsAreDiff
      ? 'The link is now active. Here is what changed from the permissions you proposed:'
      : 'The link is now active. Your venue’s access is shown below.';
  await notifyVenue(
    admin,
    requesterVenueId,
    `${recipientVenueName} accepted your link request`,
    {
      heading: withChanges ? 'Link request accepted with changes' : 'Link request accepted',
      paragraphs: withChanges
        ? [
            `${recipientVenueName} accepted your linked-account request, with some changes to the permissions you proposed.`,
            secondParagraph as string,
          ]
        : [
            `${recipientVenueName} accepted your linked-account request. The link is now active.`,
          ],
      bullets: changeBullets,
      ctaLabel: 'View linked accounts',
      ctaUrl: settingsUrl(),
    },
    { type: 'link_accepted' },
  );
}

export async function notifyLinkRejected(
  admin: SupabaseClient,
  requesterVenueId: string,
  recipientVenueName: string,
): Promise<void> {
  await notifyVenue(admin, requesterVenueId, `${recipientVenueName} declined your link request`, {
    heading: 'Link request declined',
    paragraphs: [
      `${recipientVenueName} declined your linked-account request.`,
      'You can send a fresh request after a short cooldown if you would still like to link.',
    ],
    ctaLabel: 'View linked accounts',
    ctaUrl: settingsUrl(),
  });
}

export async function notifyLinkExpired(
  admin: SupabaseClient,
  venueId: string,
  otherVenueName: string,
): Promise<NotifyResult> {
  return notifyVenue(admin, venueId, 'A linked-account request expired', {
    heading: 'Link request expired',
    paragraphs: [
      `The linked-account request between your venue and ${otherVenueName} expired without a response.`,
      'Requests expire 30 days after they are sent. You can send a fresh request at any time.',
    ],
    ctaLabel: 'View linked accounts',
    ctaUrl: settingsUrl(),
  });
}

export async function notifyLinkUnlinked(
  admin: SupabaseClient,
  venueId: string,
  otherVenueName: string,
): Promise<void> {
  await notifyVenue(admin, venueId, `${otherVenueName} unlinked from your venue`, {
    heading: 'Linked account ended',
    paragraphs: [
      `${otherVenueName} has ended the link with your venue.`,
      'All cross-venue calendar and booking access has stopped immediately. Your bookings and client data are unchanged — breaking a link only removes access, never ownership.',
    ],
    ctaLabel: 'View linked accounts',
    ctaUrl: settingsUrl(),
  });
}

/**
 * §6.6 — a link was terminated because one of the venues moved to a product that
 * is no longer eligible for linked accounts (e.g. the restaurant table-reservation
 * product). The §6.6 termination table requires both venues to be emailed.
 */
export async function notifyLinkTerminatedIneligible(
  admin: SupabaseClient,
  venueId: string,
  otherVenueName: string,
): Promise<NotifyResult> {
  return notifyVenue(admin, venueId, `Your link with ${otherVenueName} has ended`, {
    heading: 'Linked account ended',
    paragraphs: [
      `The link between your venue and ${otherVenueName} has ended because one of the venues is no longer on a ResNeo plan that supports linked accounts.`,
      'All cross-venue calendar and booking access has stopped immediately. Your bookings and client data are unchanged — ending a link only removes access, never ownership. You can link again with a fresh request once both venues are on an eligible plan.',
    ],
    ctaLabel: 'View linked accounts',
    ctaUrl: settingsUrl(),
  });
}

/**
 * §6.7 — a suspended link reached the 30-day limit without the lapsed
 * subscription being restored, so it has now expired. A fresh request is
 * required to relink.
 */
export async function notifyLinkLapseExpired(
  admin: SupabaseClient,
  venueId: string,
  otherVenueName: string,
): Promise<NotifyResult> {
  return notifyVenue(admin, venueId, `Your suspended link with ${otherVenueName} has ended`, {
    heading: 'Linked account ended',
    paragraphs: [
      `The link between your venue and ${otherVenueName} was suspended for more than 30 days because a subscription stayed inactive, so it has now ended.`,
      'Cross-venue access remains stopped and your bookings and client data are unchanged. To link again, send a fresh request once both venues have an active subscription.',
    ],
    ctaLabel: 'View linked accounts',
    ctaUrl: settingsUrl(),
  });
}

/** §6.6 — a linked venue was removed from ResNeo; the surviving partner is notified. */
export async function notifyLinkPartnerVenueDeleted(
  admin: SupabaseClient,
  survivorVenueId: string,
  deletedVenueName: string,
): Promise<void> {
  await notifyVenue(
    admin,
    survivorVenueId,
    `${deletedVenueName} is no longer on ResNeo`,
    {
      heading: 'Linked venue removed',
      paragraphs: [
        `${deletedVenueName} has been removed from ResNeo. Your link with that venue has ended and all cross-venue calendar and booking access has stopped immediately.`,
        'Your bookings and client data are unchanged. You can view the historical audit log for past links in Linked Accounts settings.',
      ],
      ctaLabel: 'View linked accounts',
      ctaUrl: settingsUrl(),
    },
  );
}

export async function notifyPermissionChangeProposed(
  admin: SupabaseClient,
  venueId: string,
  otherVenueName: string,
  changeBullets: string[],
): Promise<void> {
  await notifyVenue(admin, venueId, `${otherVenueName} proposed a permission change`, {
    heading: 'Permission change proposed',
    paragraphs: [
      `${otherVenueName} has proposed changes to your linked-account permissions.`,
      'The current permissions stay in force until you accept the change.',
    ],
    bullets: changeBullets,
    ctaLabel: 'Review change',
    ctaUrl: settingsUrl(),
  });
}

export async function notifyPermissionReduced(
  admin: SupabaseClient,
  venueId: string,
  otherVenueName: string,
  changeBullets: string[],
): Promise<void> {
  await notifyVenue(admin, venueId, `${otherVenueName} reduced your linked-account access`, {
    heading: 'Linked-account access reduced',
    paragraphs: [
      `${otherVenueName} has reduced the access granted to your venue on your shared link.`,
      'A venue can reduce the access it grants at any time. Your updated access is shown below.',
    ],
    bullets: changeBullets,
    ctaLabel: 'View linked accounts',
    ctaUrl: settingsUrl(),
  });
}

export async function notifyPermissionIncreased(
  admin: SupabaseClient,
  venueId: string,
  otherVenueName: string,
  changeBullets: string[],
): Promise<void> {
  await notifyVenue(admin, venueId, `${otherVenueName} expanded your linked-account access`, {
    heading: 'Linked-account access expanded',
    paragraphs: [
      `${otherVenueName} has expanded the access granted to your venue on your shared link.`,
      'Your updated access is shown below and is effective immediately.',
    ],
    bullets: changeBullets,
    ctaLabel: 'View linked accounts',
    ctaUrl: settingsUrl(),
  });
}

export async function notifyPermissionChangeAccepted(
  admin: SupabaseClient,
  proposerVenueId: string,
  responderVenueName: string,
): Promise<void> {
  await notifyVenue(
    admin,
    proposerVenueId,
    `${responderVenueName} accepted your permission change`,
    {
      heading: 'Permission change accepted',
      paragraphs: [
        `${responderVenueName} accepted the permission change you proposed. The new permissions are now active.`,
      ],
      ctaLabel: 'View linked accounts',
      ctaUrl: settingsUrl(),
    },
  );
}

export async function notifyPermissionChangeDeclined(
  admin: SupabaseClient,
  proposerVenueId: string,
  responderVenueName: string,
): Promise<void> {
  await notifyVenue(
    admin,
    proposerVenueId,
    `${responderVenueName} declined your permission change`,
    {
      heading: 'Permission change declined',
      paragraphs: [
        `${responderVenueName} declined the permission change you proposed. The existing permissions remain in force.`,
      ],
      ctaLabel: 'View linked accounts',
      ctaUrl: settingsUrl(),
    },
  );
}

/**
 * §6.7 foreseeable-lapse warning: sent ~7 days before a linked venue's
 * subscription is expected to lapse, to every venue linked to it.
 */
export async function notifyLinkLapseWarning(
  admin: SupabaseClient,
  venueId: string,
  lapsingVenueName: string,
  effectiveDateLabel: string,
): Promise<NotifyResult> {
  return notifyVenue(admin, venueId, 'A linked account may be suspended soon', {
    heading: 'Linked account at risk of suspension',
    paragraphs: [
      `${lapsingVenueName}'s ResNeo subscription is due to lapse on ${effectiveDateLabel}.`,
      `If it is not renewed, the link with your venue will be suspended and cross-venue calendar and booking access will pause. The link resumes automatically if ${lapsingVenueName}'s subscription is restored within 30 days.`,
    ],
    ctaLabel: 'View linked accounts',
    ctaUrl: settingsUrl(),
  });
}

export async function notifyLinkSuspended(
  admin: SupabaseClient,
  venueId: string,
  lapsedVenueName: string,
): Promise<NotifyResult> {
  return notifyVenue(admin, venueId, 'A linked account was suspended', {
    heading: 'Linked account suspended',
    paragraphs: [
      `The link between your venue and ${lapsedVenueName} has been suspended because ${lapsedVenueName}'s ResNeo subscription is inactive.`,
      'Cross-venue access is paused. If the subscription is restored within 30 days the link resumes automatically with its original permissions.',
    ],
    ctaLabel: 'View linked accounts',
    ctaUrl: settingsUrl(),
  });
}

export async function notifyLinkResumed(
  admin: SupabaseClient,
  venueId: string,
  restoredVenueName: string,
): Promise<NotifyResult> {
  return notifyVenue(admin, venueId, 'A linked account resumed', {
    heading: 'Linked account resumed',
    paragraphs: [
      `${restoredVenueName}'s subscription is active again, so your link has resumed with its original permissions.`,
    ],
    ctaLabel: 'View linked accounts',
    ctaUrl: settingsUrl(),
  });
}

export async function notifyCollectiveInvitation(
  admin: SupabaseClient,
  venueId: string,
  collectiveName: string,
  hostVenueName: string,
): Promise<void> {
  await notifyVenue(admin, venueId, `${hostVenueName} invited you to a venue collective`, {
    heading: 'Venue collective invitation',
    paragraphs: [
      `${hostVenueName} has invited your venue to join the "${collectiveName}" venue collective.`,
      'A venue collective is a combined public booking page that shows your services alongside other linked venues, under shared branding. Your booking and client data stay fully separate.',
    ],
    ctaLabel: 'Review invitation',
    ctaUrl: settingsUrl(),
  });
}

export async function notifyCollectiveRemoval(
  admin: SupabaseClient,
  venueId: string,
  collectiveName: string,
): Promise<void> {
  await notifyVenue(admin, venueId, `Removed from the ${collectiveName} collective`, {
    heading: 'Removed from venue collective',
    paragraphs: [
      `Your venue is no longer a member of the "${collectiveName}" venue collective.`,
      'Your own public booking page is unaffected.',
    ],
    ctaLabel: 'View linked accounts',
    ctaUrl: settingsUrl(),
  });
}

export async function notifyCollectiveDissolved(
  admin: SupabaseClient,
  venueId: string,
  collectiveName: string,
): Promise<void> {
  await notifyVenue(admin, venueId, `The ${collectiveName} collective was dissolved`, {
    heading: 'Venue collective dissolved',
    paragraphs: [
      `The "${collectiveName}" venue collective has been dissolved and its combined booking page is no longer live.`,
      'Each venue keeps its own booking page and data.',
    ],
    ctaLabel: 'View linked accounts',
    ctaUrl: settingsUrl(),
  });
}

/**
 * Combined booking page (plan §7) — the host added one of a member's calendars
 * to the shared catalogue, so that service is now live on the combined page at
 * the member's own price/duration. Informational; sent to the member for
 * transparency (no approval step — joining the collective is the consent).
 */
export async function notifyCombinedProviderProposed(
  admin: SupabaseClient,
  memberVenueId: string,
  collectiveName: string,
  hostVenueName: string,
  offeringName: string,
  collectiveId?: string,
): Promise<void> {
  await notifyVenue(
    admin,
    memberVenueId,
    `“${offeringName}” is now on the ${collectiveName} combined page`,
    {
      heading: 'Added to the combined booking page',
      paragraphs: [
        `${hostVenueName} added your “${offeringName}” to the “${collectiveName}” combined booking page. It’s now bookable there at your own service’s price and duration.`,
        'Manage that service — including its price, duration and availability — from your own Services settings.',
      ],
      ctaLabel: 'Open settings',
      ctaUrl: settingsUrl(),
    },
    { type: 'combined_provider_proposed', category: 'lifecycle', collectiveId },
  );
}

/**
 * Combined booking page — the host switched the collective to a combined
 * catalogue. Sent to each active member so they know to curate their listing.
 */
export async function notifyCombinedPageEnabled(
  admin: SupabaseClient,
  memberVenueId: string,
  collectiveName: string,
  collectiveId?: string,
): Promise<void> {
  await notifyVenue(
    admin,
    memberVenueId,
    `${collectiveName} now has a combined booking page`,
    {
      heading: 'Combined booking page enabled',
      paragraphs: [
        `The “${collectiveName}” collective now offers a single combined booking page with a merged service menu.`,
        'When the host adds one of your calendars to an offering, you’ll be asked to approve the price and duration shown for it.',
      ],
      ctaLabel: 'View combined page',
      ctaUrl: settingsUrl(),
    },
    { type: 'combined_page_enabled', category: 'lifecycle', collectiveId },
  );
}

/**
 * §17.3 — email the owning venue when a linked venue creates / reschedules /
 * cancels / edits a booking in its calendar, gated by the owning venue's
 * per-category email preferences (§17.4). The matching in-app notification is
 * created separately by the DB trigger and is unaffected by these prefs.
 * Best-effort: never throws into the caller (a booking write must not fail
 * because an email could not be sent).
 */
export async function notifyCrossVenueBookingWrite(params: {
  admin: SupabaseClient;
  owningVenueId: string;
  actingVenueId: string;
  actionType: 'created_booking' | 'edited_booking' | 'cancelled_booking' | 'deleted_booking';
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}): Promise<void> {
  const { admin, owningVenueId, actingVenueId, actionType, before = null, after = null } = params;
  try {
    const category = classifyCrossVenueWrite(actionType, before, after);
    if (!category) return; // hard delete / non-emailing action

    const { data: venueRow } = await admin
      .from('venues')
      .select('linked_notification_prefs')
      .eq('id', owningVenueId)
      .maybeSingle();
    const prefs = resolveLinkedNotificationPrefs(venueRow?.linked_notification_prefs);
    if (!prefs[category]) return; // owning venue has email off for this category

    const { data: actorRow } = await admin
      .from('venues')
      .select('name')
      .eq('id', actingVenueId)
      .maybeSingle();

    const notifType =
      actionType === 'created_booking'
        ? 'cross_venue_booking_created'
        : actionType === 'cancelled_booking'
          ? 'cross_venue_booking_cancelled'
          : 'cross_venue_booking_edited';
    // Cancels read the pre-change snapshot; creates/edits read the resulting row.
    const state = (actionType === 'cancelled_booking' ? before ?? after : after ?? before) ?? {};
    const payload = {
      actor_venue_name: (actorRow?.name as string | null) ?? null,
      booking_date: (state as Record<string, unknown>).booking_date ?? null,
      booking_time: (state as Record<string, unknown>).booking_time ?? null,
      old_booking_date:
        actionType === 'edited_booking' ? (before as Record<string, unknown> | null)?.booking_date ?? null : null,
      old_booking_time:
        actionType === 'edited_booking' ? (before as Record<string, unknown> | null)?.booking_time ?? null : null,
    };

    const { title, body } = formatNotificationCopy(notifType, payload);
    await notifyVenue(
      admin,
      owningVenueId,
      title,
      {
        heading: title,
        paragraphs: [
          body,
          'You can choose which linked-venue activity emails you in Settings → Linked Accounts.',
        ],
        ctaLabel: 'View linked accounts',
        ctaUrl: settingsUrl(),
      },
      false, // the DB trigger already created the in-app notification for this write
    );
  } catch (err) {
    console.error('[linked-accounts] notifyCrossVenueBookingWrite failed:', err);
  }
}

/**
 * §7.4 — hosting transferred automatically because the previous host was removed
 * from the collective (e.g. it lost a full-mutual link). The new host is told it
 * has inherited host responsibilities.
 */
export async function notifyCollectiveHostTransferred(
  admin: SupabaseClient,
  newHostVenueId: string,
  collectiveName: string,
): Promise<void> {
  await notifyVenue(
    admin,
    newHostVenueId,
    `You are now the host of the ${collectiveName} collective`,
    {
      heading: 'You are now the collective host',
      paragraphs: [
        `The previous host of the "${collectiveName}" venue collective is no longer a member, so hosting has transferred to your venue to keep the collective running.`,
        'As host you control the collective’s branding, membership and settings, and you can transfer hosting to another member or dissolve the collective from Linked Accounts settings.',
      ],
      ctaLabel: 'Manage collective',
      ctaUrl: settingsUrl(),
    },
  );
}
