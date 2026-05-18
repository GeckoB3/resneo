import { NextRequest, NextResponse } from 'next/server';
import { resolveLinkAdmin } from '@/lib/linked-accounts/route-helpers';
import { reduceLinkSchema } from '@/lib/linked-accounts/validation';
import { loadLinkViewsForVenue } from '@/lib/linked-accounts/queries';
import { describeGrant, isReductionOnly, normaliseGrant } from '@/lib/linked-accounts/permissions';
import type { AccountLinkRow, LinkGrant } from '@/lib/linked-accounts/types';
import { notifyPermissionReduced } from '@/lib/linked-accounts/notifications';
import { reconcileCollectivesAfterLinkChange } from '@/lib/linked-accounts/collectives';

/**
 * POST /api/venue/account-links/[id]/reduce — unilaterally reduce the access my
 * venue grants the other venue (§6.5). No consent from the other venue is
 * required; an increase is rejected.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
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
        'id, venue_low_id, venue_high_id, status, ' +
          'low_grants_calendar, low_grants_pii, low_grants_act, ' +
          'high_grants_calendar, high_grants_pii, high_grants_act',
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
        { error: 'Access can only be reduced on an active link.' },
        { status: 409 },
      );
    }

    // What my venue currently grants the other venue.
    const current: LinkGrant = iAmLow
      ? { calendar: link.low_grants_calendar, pii: link.low_grants_pii, act: link.low_grants_act }
      : {
          calendar: link.high_grants_calendar,
          pii: link.high_grants_pii,
          act: link.high_grants_act,
        };
    const next = normaliseGrant(parsed.data.grant);

    if (!isReductionOnly(current, next)) {
      return NextResponse.json(
        {
          error:
            'This control can only reduce access. To grant more access, use Edit permissions, which the other venue must accept.',
        },
        { status: 400 },
      );
    }

    const column = iAmLow
      ? {
          low_grants_calendar: next.calendar,
          low_grants_pii: next.pii,
          low_grants_act: next.act,
        }
      : {
          high_grants_calendar: next.calendar,
          high_grants_pii: next.pii,
          high_grants_act: next.act,
        };

    await ctx.admin.from('account_links').update(column).eq('id', id);

    // Reducing visibility below full_details invalidates any collective that
    // depends on this link (§7.5).
    await reconcileCollectivesAfterLinkChange(ctx.admin, [
      link.venue_low_id,
      link.venue_high_id,
    ]);

    const otherVenueId = iAmLow ? link.venue_high_id : link.venue_low_id;
    await notifyPermissionReduced(
      ctx.admin,
      otherVenueId,
      ctx.venue.name,
      describeGrant(next).map((s) => `Your venue can now ${s}`),
    );

    const views = await loadLinkViewsForVenue(ctx.admin, ctx.venueId);
    return NextResponse.json({ link: views.find((v) => v.id === id) ?? null });
  } catch (err) {
    console.error('POST /api/venue/account-links/[id]/reduce failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
