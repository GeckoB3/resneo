import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { isPlatformAuthFailure, requirePlatformSuperuserAuth } from '@/lib/platform-api-auth';
import { recordPlatformAuditEvent } from '@/lib/platform/audit';
import { retrySupportLink } from '@/lib/platform/collective-support';

const bodySchema = z.object({ link_id: z.string().uuid() });

/**
 * POST /api/platform/collectives/[id]/retry { link_id }: the support console's one action, "Retry
 * now" on a replica link (plan §6.16). It runs the engine's apply as the cron does; the engine
 * audits the attempt and the platform audit log records who asked.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePlatformSuperuserAuth();
  if (isPlatformAuthFailure(auth)) return auth;
  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'A link to retry is required.' }, { status: 400 });

  const admin = getSupabaseAdminClient();
  const outcome = await retrySupportLink(admin, id, parsed.data.link_id);
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  await recordPlatformAuditEvent(admin, {
    superuser: auth.user,
    action: 'collective.retry_link',
    targetType: 'collective',
    targetId: id,
    summary: outcome.applied ? 'retried a collective replica link, which applied' : 'retried a collective replica link, which failed again',
    metadata: { link_id: parsed.data.link_id, applied: outcome.applied, error: outcome.error },
  });
  return NextResponse.json(outcome);
}
