import { NextResponse } from 'next/server';
import { requireImportAdmin } from '@/lib/import/auth';

/** Import progress must never be cached (stale status caused the UI to sit on "Checking status…"). */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const ctx = await requireImportAdmin();
  if ('response' in ctx) return ctx.response;
  const { staff } = ctx;
  const { sessionId } = await params;

  const { data: session, error } = await staff.db
    .from('import_sessions')
    .select(
      'status, started_at, progress_processed, progress_total, imported_clients, imported_bookings, skipped_rows, updated_existing, error_message, completed_at',
    )
    .eq('id', sessionId)
    .eq('venue_id', staff.venue_id)
    .maybeSingle();

  if (error || !session) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const s = session as {
    progress_processed: number;
    progress_total: number;
    status: string;
  };
  const pct =
    s.progress_total > 0 ? Math.min(100, Math.round((s.progress_processed / s.progress_total) * 100)) : 0;

  return NextResponse.json({ ...session, percent: pct });
}
