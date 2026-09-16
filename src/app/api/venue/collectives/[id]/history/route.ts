import { NextRequest, NextResponse } from 'next/server';
import { resolveLinkAdmin, enforceLinkRateLimit } from '@/lib/linked-accounts/route-helpers';
import { historyCsv, loadHistory, type HistoryFilter } from '@/lib/linked-accounts/replicas/history';

const FILTERS: HistoryFilter[] = ['all', 'services', 'calendars', 'members'];

/**
 * GET /api/venue/collectives/[id]/history — the collective's history, one sentence per change
 * (plan Appendix E contract 3).
 *
 * `?filter=all|services|calendars|members&venue_id=&from=&to=&cursor=&limit=50`, newest first, with
 * `next_cursor` for the next page. `?format=csv` returns the same rows as a download, up to 5,000 of
 * them. A host admin reads everything; a member admin reads what was done to its venue and what was
 * done to the whole collective, and never what happened at another member.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  const { id } = await params;

  const limited = enforceLinkRateLimit(ctx.venueId, 'collective-history', 120, 60_000);
  if (limited) return limited;

  const { data: collective } = await ctx.admin
    .from('venue_collectives')
    .select('id, name, host_venue_id')
    .eq('id', id)
    .maybeSingle();
  if (!collective) {
    return NextResponse.json({ error: 'Collective not found.' }, { status: 404 });
  }
  const isHost = collective.host_venue_id === ctx.venueId;
  if (!isHost) {
    // A member reads its own collective's history; a venue that has left, or never joined, does not.
    const { data: membership } = await ctx.admin
      .from('venue_collective_members')
      .select('id')
      .eq('collective_id', id)
      .eq('venue_id', ctx.venueId)
      .eq('status', 'active')
      .maybeSingle();
    if (!membership) {
      return NextResponse.json({ error: 'Only venues in this collective can read its history.' }, { status: 403 });
    }
  }

  const search = request.nextUrl.searchParams;
  const filterParam = search.get('filter') as HistoryFilter | null;
  const filter = filterParam && FILTERS.includes(filterParam) ? filterParam : 'all';
  const asCsv = search.get('format') === 'csv';
  const limit = asCsv ? 5_000 : Math.min(Number(search.get('limit') ?? 50) || 50, 100);

  try {
    const page = await loadHistory(ctx.admin, {
      collectiveId: id,
      viewerVenueId: ctx.venueId,
      isHost,
      filter,
      venueId: search.get('venue_id'),
      from: search.get('from'),
      to: search.get('to'),
      cursor: asCsv ? null : search.get('cursor'),
      limit,
    });

    if (asCsv) {
      const safeName = String(collective.name ?? 'collective').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      return new NextResponse(historyCsv(page.events), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${safeName}-history.csv"`,
          'Cache-Control': 'no-store',
        },
      });
    }
    return NextResponse.json(page, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error('[collective] history read failed:', err);
    return NextResponse.json({ error: 'Could not load the history.' }, { status: 500 });
  }
}
