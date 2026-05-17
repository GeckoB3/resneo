import { NextRequest, NextResponse } from 'next/server';
import { resolveLinkAdmin } from '@/lib/linked-accounts/route-helpers';
import { loadVenueLookup } from '@/lib/linked-accounts/queries';
import { auditActionLabel } from '@/lib/linked-accounts/audit';
import type { AccountLinkAuditRow } from '@/lib/linked-accounts/types';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const CSV_ROW_LIMIT = 10000;

const KNOWN_ACTIONS = new Set([
  'viewed_calendar',
  'viewed_booking',
  'created_booking',
  'edited_booking',
  'cancelled_booking',
]);

function csvCell(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** GET /api/venue/account-links/[id]/audit — paginated, filterable audit log. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const resolved = await resolveLinkAdmin();
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  const { id } = await params;
  const sp = request.nextUrl.searchParams;

  try {
    // Confirm the current venue is a member of this link.
    const { data: link } = await ctx.admin
      .from('account_links')
      .select('id, venue_low_id, venue_high_id')
      .eq('id', id)
      .maybeSingle();
    if (
      !link ||
      (link.venue_low_id !== ctx.venueId && link.venue_high_id !== ctx.venueId)
    ) {
      return NextResponse.json({ error: 'Link not found.' }, { status: 404 });
    }

    const isCsv = sp.get('format') === 'csv';
    const actionFilter = sp.get('action');
    const fromDate = sp.get('from');
    const toDate = sp.get('to');
    const actingUserId = sp.get('actingUserId');

    const buildQuery = () => {
      let q = ctx.admin
        .from('account_link_audit_log')
        .select(
          'id, link_id, acting_venue_id, acting_user_id, owning_venue_id, action_type, ' +
            'resource_type, resource_id, before_state, after_state, created_at',
          { count: 'exact' },
        )
        .eq('link_id', id)
        .order('created_at', { ascending: false });
      if (actionFilter && KNOWN_ACTIONS.has(actionFilter)) {
        q = q.eq('action_type', actionFilter);
      }
      if (fromDate) q = q.gte('created_at', `${fromDate}T00:00:00.000Z`);
      if (toDate) q = q.lte('created_at', `${toDate}T23:59:59.999Z`);
      if (actingUserId) q = q.eq('acting_user_id', actingUserId);
      return q;
    };

    const page = Math.max(1, Number(sp.get('page') ?? '1') || 1);
    const pageSize = isCsv
      ? CSV_ROW_LIMIT
      : Math.min(MAX_PAGE_SIZE, Math.max(1, Number(sp.get('pageSize') ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE));
    const offset = isCsv ? 0 : (page - 1) * pageSize;

    const { data, count, error } = await buildQuery().range(offset, offset + pageSize - 1);
    if (error) {
      console.error('audit log query failed:', error.message);
      return NextResponse.json({ error: 'Failed to load audit log.' }, { status: 500 });
    }
    const rows = (data ?? []) as unknown as AccountLinkAuditRow[];

    // Resolve venue names and acting-user names for display.
    const venueIds = new Set<string>();
    const userIds = new Set<string>();
    for (const r of rows) {
      venueIds.add(r.acting_venue_id);
      venueIds.add(r.owning_venue_id);
      if (r.acting_user_id) userIds.add(r.acting_user_id);
    }
    const venueLookup = await loadVenueLookup(ctx.admin, [...venueIds]);
    const userLookup: Record<string, string> = {};
    if (userIds.size > 0) {
      const { data: staffRows } = await ctx.admin
        .from('staff')
        .select('user_id, name, email')
        .in('user_id', [...userIds]);
      for (const s of staffRows ?? []) {
        const uid = s.user_id as string | null;
        if (uid) userLookup[uid] = (s.name as string) || (s.email as string) || 'Unknown user';
      }
    }

    const enriched = rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      actionType: r.action_type,
      actionLabel: auditActionLabel(r.action_type),
      actingVenue: venueLookup[r.acting_venue_id]?.name ?? 'Unknown venue',
      owningVenue: venueLookup[r.owning_venue_id]?.name ?? 'Unknown venue',
      actingUser: r.acting_user_id ? userLookup[r.acting_user_id] ?? 'Unknown user' : null,
      resourceType: r.resource_type,
      resourceId: r.resource_id,
      beforeState: r.before_state,
      afterState: r.after_state,
    }));

    if (isCsv) {
      const header = [
        'Timestamp',
        'Action',
        'Acting venue',
        'Acting user',
        'Affected venue',
        'Resource type',
        'Resource id',
      ];
      const lines = [header.map(csvCell).join(',')];
      for (const e of enriched) {
        lines.push(
          [
            e.createdAt,
            e.actionLabel,
            e.actingVenue,
            e.actingUser ?? '',
            e.owningVenue,
            e.resourceType ?? '',
            e.resourceId ?? '',
          ]
            .map((c) => csvCell(String(c)))
            .join(','),
        );
      }
      return new NextResponse(lines.join('\r\n'), {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="linked-account-audit-${id}.csv"`,
        },
      });
    }

    return NextResponse.json({
      entries: enriched,
      page,
      pageSize,
      total: count ?? 0,
    });
  } catch (err) {
    console.error('GET /api/venue/account-links/[id]/audit failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
