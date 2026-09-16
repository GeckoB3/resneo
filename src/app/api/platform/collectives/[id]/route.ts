import { NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { isPlatformAuthFailure, requirePlatformSuperuserAuth } from '@/lib/platform-api-auth';
import { loadSupportCollective } from '@/lib/platform/collective-support';

/**
 * GET /api/platform/collectives/[id]: one collective's venues, its last 50 audit events and every
 * replica link with its revisions and last error. Read-only (plan §6.16).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformSuperuserAuth();
  if (isPlatformAuthFailure(auth)) return auth;
  const { id } = await params;
  const detail = await loadSupportCollective(getSupabaseAdminClient(), id);
  if (!detail) return NextResponse.json({ error: 'Collective not found' }, { status: 404 });
  return NextResponse.json(detail, { headers: { 'Cache-Control': 'no-store' } });
}
