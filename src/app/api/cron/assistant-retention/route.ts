import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { requireCronAuthorisation } from '@/lib/cron-auth';
import { withCronRunLogging } from '@/lib/platform/cron-log';
import { assistantRetentionDays } from '@/lib/assistant/enabled';

/**
 * GET/POST /api/cron/assistant-retention
 * Vercel Cron uses GET; POST kept for manual triggers, matching the other cron routes.
 *
 * Deletes Ask ResNeo conversations older than `ASSISTANT_RETENTION_DAYS` (default 30,
 * Docs/help-assistant-plan.md 4.2, decision D5). Messages cascade from the conversation.
 * The weekly gap review (4.4) looks at the last seven days, so a month is ample; the
 * questions are typed by staff and may name a client, which is why they do not live longer.
 */
export async function GET(request: NextRequest) {
  return POST(request);
}

export const POST = withCronRunLogging('assistant-retention', handlePost);

export function retentionCutoffIso(days: number = assistantRetentionDays(), now: Date = new Date()): string {
  return new Date(now.getTime() - days * 24 * 3600 * 1000).toISOString();
}

async function handlePost(request: NextRequest) {
  const denied = requireCronAuthorisation(request);
  if (denied) return denied;

  try {
    const supabase = getSupabaseAdminClient();
    const cutoff = retentionCutoffIso();

    const { error, count } = await supabase
      .from('assistant_conversations')
      .delete({ count: 'exact' })
      .lt('created_at', cutoff);

    if (error) {
      console.error('[assistant-retention] delete failed:', error.message);
      return NextResponse.json({ error: 'Prune failed' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, cutoff, pruned: count ?? 0 });
  } catch (err) {
    console.error('[assistant-retention] failed:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
