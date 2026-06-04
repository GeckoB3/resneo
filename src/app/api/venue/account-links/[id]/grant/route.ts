import { NextRequest, NextResponse } from 'next/server';
import { resolveLinkAdmin, enforceLinkRateLimit } from '@/lib/linked-accounts/route-helpers';
import { reduceLinkSchema } from '@/lib/linked-accounts/validation';
import { loadLinkViewsForVenue } from '@/lib/linked-accounts/queries';
import {
  describeGrant,
  grantsEqual,
  isIncreaseOnly,
  normaliseGrant,
} from '@/lib/linked-accounts/permissions';
import type { AccountLinkRow, LinkGrant } from '@/lib/linked-accounts/types';
import { notifyPermissionIncreased } from '@/lib/linked-accounts/notifications';
import { reconcileCollectivesAfterLinkChange } from '@/lib/linked-accounts/collectives';

/**
 * POST /api/venue/account-links/[id]/grant — unilaterally expand the access my
 * venue grants the other venue. Voluntary sharing of your own data takes effect
 * immediately; requesting more access to the other venue's data still requires
 * the negotiated propose/accept flow (§6.5).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  const limited = enforceLinkRateLimit(ctx.venueId, 'mutate', 30, 60_000);
  if (limited) return limited;
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  const parsed = reduceLinkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid request', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  try {
    const { data } = await ctx.admin
      .from('account_links')
      .select(
        'id, venue_low_id, venue_high_id, status, pending_change, ' +
          'low_grants_calendar, low_grants_pii, low_grants_act, low_grants_calendar_ids, ' +
          'high_grants_calendar, high_grants_pii, high_grants_act, high_grants_calendar_ids',
      )
      .eq('id', id)
      .maybeSingle();
    if (!data) {
      return NextResponse.json({ error: 'Link not found.' }, { status: 404 });
    }
    const link = data as unknown as AccountLinkRow;
    const iAmLow = link.venue_low_id === ctx.venueId;
    const iAmHigh = link.venue_high_id === ctx.venueId;
    if (!iAmLow && !iAmHigh) {
      return NextResponse.json({ error: 'Link not found.' }, { status: 404 });
    }
    if (link.status !== 'accepted' && link.status !== 'suspended') {
      return NextResponse.json(
        { error: 'Access can only be expanded on an active link.' },
        { status: 409 },
      );
    }

    const current: LinkGrant = iAmLow
      ? {
          calendar: link.low_grants_calendar,
          pii: link.low_grants_pii,
          act: link.low_grants_act,
          calendarIds: link.low_grants_calendar_ids,
        }
      : {
          calendar: link.high_grants_calendar,
          pii: link.high_grants_pii,
          act: link.high_grants_act,
          calendarIds: link.high_grants_calendar_ids,
        };
    const next = normaliseGrant(parsed.data.grant);

    if (grantsEqual(current, next)) {
      return NextResponse.json({ error: 'The proposed access matches what you already grant.' }, { status: 400 });
    }

    if (!isIncreaseOnly(current, next)) {
      return NextResponse.json(
        {
          error:
            'This control can only expand access you grant. To reduce access, use Reduce access now. To request more access to their data, use Edit permissions.',
        },
        { status: 400 },
      );
    }

    const column = iAmLow
      ? {
          low_grants_calendar: next.calendar,
          low_grants_pii: next.pii,
          low_grants_act: next.act,
          low_grants_calendar_ids: next.calendarIds ?? null,
        }
      : {
          high_grants_calendar: next.calendar,
          high_grants_pii: next.pii,
          high_grants_act: next.act,
          high_grants_calendar_ids: next.calendarIds ?? null,
        };

    await ctx.admin.from('account_links').update(column).eq('id', id);

    await reconcileCollectivesAfterLinkChange(ctx.admin, [
      link.venue_low_id,
      link.venue_high_id,
    ]);

    const otherVenueId = iAmLow ? link.venue_high_id : link.venue_low_id;
    await notifyPermissionIncreased(
      ctx.admin,
      otherVenueId,
      ctx.venue.name,
      describeGrant(next).map((s) => `Your venue can now ${s}`),
    );

    const views = await loadLinkViewsForVenue(ctx.admin, ctx.venueId);
    return NextResponse.json({ link: views.find((v) => v.id === id) ?? null });
  } catch (err) {
    console.error('POST /api/venue/account-links/[id]/grant failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
