/**
 * The one-call setup behind the Link with a venue wizard (Docs/link-and-collective-setup-wizard-plan.md
 * §3.1, decisions L3 and L4).
 *
 * A link request as today and, when the host asked for one, the collective with it: host active, the
 * other venue invited, page not live, exactly as the Create dialog makes it. Then one notice to the
 * other venue. If the collective is refused after the link row exists, the link is removed again so
 * the wizard can show the refusal on the step it belongs to and nothing half-made is left behind.
 */
import { NextResponse } from 'next/server';
import type { z } from 'zod';
import type { LinkAdminCtx } from '@/lib/linked-accounts/link-request';
import { createLinkRequest } from '@/lib/linked-accounts/link-request';
import { createCollectiveWithInvites } from '@/lib/linked-accounts/collective-create';
import { collectiveStandingBetween } from '@/lib/linked-accounts/collective-standing';
import { isFullAccessBothWays } from '@/lib/linked-accounts/link-levels';
import { normaliseGrant } from '@/lib/linked-accounts/permissions';
import { loadLinkViewsForVenue } from '@/lib/linked-accounts/queries';
import { notifyLinkRequestReceived, notifyLinkRequestWithCollective } from '@/lib/linked-accounts/notifications';
import { collectiveCopy } from '@/lib/linked-accounts/collective-copy';
import type { linkSetupSchema } from '@/lib/linked-accounts/validation';

export type LinkSetupInput = z.infer<typeof linkSetupSchema>;

export async function runLinkSetup(ctx: LinkAdminCtx, input: LinkSetupInput): Promise<NextResponse> {
  const mine = normaliseGrant(input.grants.mine);
  const theirs = normaliseGrant(input.grants.theirs);
  if (input.collective && !isFullAccessBothWays(mine, theirs)) {
    return NextResponse.json(
      { error: collectiveCopy('setup.level.customNote'), field: 'level' },
      { status: 400 },
    );
  }

  const link = await createLinkRequest(
    ctx,
    { targetSlug: input.targetSlug, requestMessage: input.requestMessage, grants: { mine, theirs } },
    { notify: false },
  );
  if (!link.ok) return link.response;

  const rollback = async () => {
    await ctx.admin.from('account_links').delete().eq('id', link.linkId);
  };

  let collective: { id: string; name: string; slug: string } | null = null;
  if (input.collective) {
    const standing = await collectiveStandingBetween(ctx.admin, ctx.venueId, link.target.id);
    if (standing.standing === 'blocked') {
      await rollback();
      return NextResponse.json(
        {
          error: collectiveCopy('setup.collective.blocked', {
            venue: link.target.name,
            reason: standing.reason ?? '',
          }),
          field: 'collective',
        },
        { status: 409 },
      );
    }
    const created = await createCollectiveWithInvites(
      ctx,
      { name: input.collective.name, slug: input.collective.slug, inviteVenueIds: [link.target.id] },
      { skipMeshCheck: true, notify: false },
    );
    if (!created.ok) {
      await rollback();
      return created.response;
    }
    collective = { id: created.collectiveId, name: created.name, slug: created.slug };
  }

  if (collective) {
    await notifyLinkRequestWithCollective(ctx.admin, link.target.id, ctx.venue.name, collective, link.permissionBullets);
  } else {
    await notifyLinkRequestReceived(ctx.admin, link.target.id, ctx.venue.name, link.permissionBullets);
  }

  const links = await loadLinkViewsForVenue(ctx.admin, ctx.venueId);
  return NextResponse.json(
    { link: links.find((l) => l.id === link.linkId) ?? null, collective },
    { status: 201 },
  );
}
