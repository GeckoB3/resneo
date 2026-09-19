import { NextResponse } from 'next/server';
import { resolveLinkAdmin } from '@/lib/linked-accounts/route-helpers';
import { loadJoinPreview } from '@/lib/linked-accounts/replicas/join';

/**
 * GET /api/venue/collectives/[id]/join: what an invited venue has to decide before it joins a
 * shared-services collective (plan contract 6; UX spec `join.*`). The same-name list is computed
 * here, with the one normaliser the engine uses, so the dialog and the join never disagree.
 *
 * Only a venue with an open invitation to this collective may read it.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  const { id } = await params;

  const { data: invitation } = await ctx.admin
    .from('venue_collective_members')
    .select('id')
    .eq('collective_id', id)
    .eq('venue_id', ctx.venueId)
    .eq('status', 'invited')
    .maybeSingle();
  if (!invitation) {
    return NextResponse.json({ error: 'There is no open invitation for your venue.' }, { status: 404 });
  }

  // Reviewing the link request and this invitation together (plan L4): a pending full-access link
  // from the host stands in for the mesh, because accepting it comes first.
  const preview = await loadJoinPreview(ctx.admin, id, ctx.venueId, {
    allowPendingLink: new URL(request.url).searchParams.get('with_pending_link') === '1',
  });
  if (!preview) {
    return NextResponse.json({ error: 'This collective does not use shared services yet.' }, { status: 409 });
  }
  return NextResponse.json(preview, { headers: { 'Cache-Control': 'no-store' } });
}
