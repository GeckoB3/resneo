import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { isPlatformAuthFailure, requirePlatformSuperuserAuth } from '@/lib/platform-api-auth';

const PAGE_SIZE = 50;

/**
 * GET /api/platform/audit-events?page=1&action=&search=
 * Paginated platform audit events (superuser actions outside support sessions).
 */
export async function GET(req: NextRequest) {
  const auth = await requirePlatformSuperuserAuth();
  if (isPlatformAuthFailure(auth)) return auth;

  const { searchParams } = req.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const action = searchParams.get('action')?.trim() ?? '';
  const search = searchParams.get('search')?.trim() ?? '';

  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const admin = getSupabaseAdminClient();
  let query = admin
    .from('platform_audit_events')
    .select('id, superuser_email, action, target_type, target_id, summary, metadata, created_at', {
      count: 'exact',
    })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (action) {
    query = query.like('action', `${action}%`);
  }
  if (search) {
    query = query.or(`summary.ilike.%${search}%,superuser_email.ilike.%${search}%`);
  }

  const { data, count, error } = await query;
  if (error) {
    console.error('[platform/audit-events]', error.message);
    return NextResponse.json({ error: 'Failed to load audit events' }, { status: 500 });
  }

  return NextResponse.json({
    events: data ?? [],
    total: count ?? 0,
    page,
    totalPages: Math.ceil((count ?? 0) / PAGE_SIZE),
  });
}
