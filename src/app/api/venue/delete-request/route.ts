import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { stripe } from '@/lib/stripe';
import {
  subscriptionCancelAtIso,
  subscriptionPeriodEndIso,
  subscriptionPeriodStartIso,
} from '@/lib/stripe/subscription-fields';
import { sendEmail } from '@/lib/emails/send-email';
import { normalizePublicBaseUrl } from '@/lib/public-base-url';

const GRACE_DAYS = 30;

interface VenueDeletionRow {
  id: string;
  name: string;
  stripe_subscription_id: string | null;
  deletion_scheduled_at: string | null;
}

/** GET /api/venue/delete-request — current scheduled-deletion state for the admin's venue. */
export async function GET(request: NextRequest) {
  const supabase = await createVenueRouteClient(request);
  const staff = await getVenueStaff(supabase);
  if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  if (!requireAdmin(staff)) return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });

  const { data: venue, error } = await staff.db
    .from('venues')
    .select('id, name, deletion_scheduled_at')
    .eq('id', staff.venue_id)
    .maybeSingle();
  if (error || !venue) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });

  return NextResponse.json({
    venue_name: (venue as { name: string }).name,
    deletion_scheduled_at: (venue as { deletion_scheduled_at: string | null }).deletion_scheduled_at ?? null,
  });
}

/**
 * POST /api/venue/delete-request — schedule a 30-day grace-period hard deletion (admin only).
 * Sets venues.deletion_scheduled_at; the `venue-hard-delete` cron erases the venue once it elapses.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const staff = await getVenueStaff(supabase);
    if (!staff) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    if (!requireAdmin(staff)) return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });
    // A platform superuser acting through a support session must not be able to schedule
    // the destruction of a customer's venue.
    if (staff.support) {
      return NextResponse.json(
        { error: 'Venue deletion is unavailable during a support session.' },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as { confirmation?: unknown };
    const confirmation = typeof body.confirmation === 'string' ? body.confirmation.trim() : '';

    const { data, error: vErr } = await staff.db
      .from('venues')
      .select('id, name, stripe_subscription_id, deletion_scheduled_at')
      .eq('id', staff.venue_id)
      .maybeSingle();
    if (vErr || !data) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    const venue = data as VenueDeletionRow;

    if (venue.deletion_scheduled_at) {
      return NextResponse.json(
        { error: 'Deletion is already scheduled.', deletion_scheduled_at: venue.deletion_scheduled_at },
        { status: 409 },
      );
    }

    // Require the admin to type the exact venue name (case-insensitive).
    if (confirmation.toLowerCase() !== venue.name.trim().toLowerCase()) {
      return NextResponse.json({ error: 'Type the venue name exactly to confirm deletion.' }, { status: 400 });
    }

    const now = new Date();
    const scheduledAt = new Date(now.getTime() + GRACE_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // Stop future billing: cancel at period end (mirrors Plan → Cancel). Best-effort — a
    // Stripe outage must not prevent the user from exercising their deletion right.
    let note: string | null = null;
    const subId = venue.stripe_subscription_id?.trim();
    if (subId) {
      try {
        const sub = await stripe.subscriptions.update(subId, { cancel_at_period_end: true });
        await staff.db
          .from('venues')
          .update({
            plan_status: 'cancelling',
            subscription_current_period_start: subscriptionPeriodStartIso(sub),
            subscription_current_period_end: subscriptionPeriodEndIso(sub) ?? subscriptionCancelAtIso(sub),
          })
          .eq('id', venue.id);
      } catch (e) {
        note = 'We could not automatically schedule your subscription to cancel. Please cancel billing manually.';
        console.error('[venue/delete-request] stripe cancel_at_period_end:', e instanceof Error ? e.message : e);
      }
    }

    const { error: updErr } = await staff.db
      .from('venues')
      .update({
        deletion_scheduled_at: scheduledAt,
        deletion_requested_at: now.toISOString(),
        deletion_requested_by: staff.id,
        deletion_requested_by_email: staff.email,
        updated_at: now.toISOString(),
      })
      .eq('id', venue.id);

    if (updErr) {
      console.error('[venue/delete-request] schedule update:', updErr.message);
      return NextResponse.json({ error: 'Failed to schedule deletion' }, { status: 500 });
    }

    // Confirmation email to the requesting admin.
    if (staff.email) {
      const base = normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL ?? '');
      const manageUrl = base ? `${base}/dashboard/settings?tab=plan` : null;
      const scheduledDate = scheduledAt.slice(0, 10);
      try {
        await sendEmail({
          to: staff.email,
          subject: `Deletion scheduled for ${venue.name}`,
          text: [
            `We have received a request to delete "${venue.name}" on ResNeo.`,
            '',
            `The venue and all of its data will be permanently deleted on ${scheduledDate}.`,
            note ?? 'Your subscription is set to cancel at the end of the current billing period.',
            '',
            'To cancel this and keep your venue, sign in before that date and use',
            '"Delete this venue" → "Cancel scheduled deletion" on Settings → Plan:',
            manageUrl ?? '(sign in to your ResNeo dashboard → Settings → Plan)',
            '',
            'If you did not request this, cancel it immediately and contact ResNeo support.',
          ].join('\n'),
          html: `
            <p>We have received a request to delete <strong>${venue.name}</strong> on ResNeo.</p>
            <p>The venue and all of its data will be permanently deleted on <strong>${scheduledDate}</strong>.</p>
            <p>${note ?? 'Your subscription is set to cancel at the end of the current billing period.'}</p>
            <p>To cancel this and keep your venue, sign in before that date and use
            <strong>"Delete this venue" → "Cancel scheduled deletion"</strong> on Settings → Plan${
              manageUrl ? `: <a href="${manageUrl}">${manageUrl}</a>` : '.'
            }</p>
            <p>If you did not request this, cancel it immediately and contact ResNeo support.</p>
          `,
          disableTracking: true,
        });
      } catch (emailErr) {
        console.error(
          '[venue/delete-request] confirmation email:',
          emailErr instanceof Error ? emailErr.message : emailErr,
        );
      }
    }

    return NextResponse.json({ deletion_scheduled_at: scheduledAt, note });
  } catch (e) {
    console.error('[venue/delete-request]', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
