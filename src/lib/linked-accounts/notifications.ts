/** Email notifications for Linked Accounts events (§9). Email-only; no SMS. */

import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/emails/send-email';
import { renderLinkEmail, type LinkEmailParams } from '@/lib/emails/templates/linked-account-emails';
import { loadActiveAdminStaff } from './queries';

function settingsUrl(): string {
  const base = (process.env.NEXT_PUBLIC_BASE_URL || 'https://www.reserveni.com').replace(/\/$/, '');
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

/** Send one Linked Accounts email to every recipient of a venue. */
export async function notifyVenue(
  admin: SupabaseClient,
  venueId: string,
  subject: string,
  params: Omit<LinkEmailParams, 'recipientVenueName'>,
): Promise<void> {
  try {
    const [recipients, name] = await Promise.all([
      venueRecipients(admin, venueId),
      venueName(admin, venueId),
    ]);
    if (recipients.length === 0) return;
    const { html, text } = renderLinkEmail({ ...params, recipientVenueName: name });
    await Promise.allSettled(
      recipients.map((to) => sendEmail({ to, subject, html, text })),
    );
  } catch (err) {
    console.error('[linked-accounts] notifyVenue failed:', err);
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
      `${requesterVenueName} has asked to link their ReserveNI venue with yours.`,
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
): Promise<void> {
  await notifyVenue(
    admin,
    requesterVenueId,
    `${recipientVenueName} accepted your link request`,
    {
      heading: withChanges ? 'Link request accepted with changes' : 'Link request accepted',
      paragraphs: withChanges
        ? [
            `${recipientVenueName} accepted your linked-account request, with some changes to the permissions you proposed.`,
            'The link is now active. The agreed permissions are shown below.',
          ]
        : [
            `${recipientVenueName} accepted your linked-account request. The link is now active.`,
          ],
      bullets: changeBullets,
      ctaLabel: 'View linked accounts',
      ctaUrl: settingsUrl(),
    },
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
): Promise<void> {
  await notifyVenue(admin, venueId, 'A linked-account request expired', {
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

export async function notifyLinkSuspended(
  admin: SupabaseClient,
  venueId: string,
  lapsedVenueName: string,
): Promise<void> {
  await notifyVenue(admin, venueId, 'A linked account was suspended', {
    heading: 'Linked account suspended',
    paragraphs: [
      `The link between your venue and ${lapsedVenueName} has been suspended because ${lapsedVenueName}'s ReserveNI subscription is inactive.`,
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
): Promise<void> {
  await notifyVenue(admin, venueId, 'A linked account resumed', {
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
