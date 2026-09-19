import { NextResponse } from 'next/server';
import { requireImportAdmin } from '@/lib/import/auth';
import { runImportUndo } from '@/lib/import/run-undo';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const ctx = await requireImportAdmin();
  if ('response' in ctx) return ctx.response;
  const { staff } = ctx;
  const { sessionId } = await params;

  try {
    await runImportUndo(staff.db, sessionId, staff.venue_id, staff.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Undo failed';
    const status = msg.includes('expired') || msg.includes('already') ? 403 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
