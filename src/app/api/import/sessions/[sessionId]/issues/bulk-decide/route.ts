import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireImportAdmin } from '@/lib/import/auth';

const bodySchema = z.object({
  issue_type: z.string().min(1),
  user_decision: z.enum(['skip', 'import_anyway', 'update_existing']),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const ctx = await requireImportAdmin();
  if ('response' in ctx) return ctx.response;
  const { staff } = ctx;
  const { sessionId } = await params;

  const body = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  // staff.db is the service-role client (RLS bypassed), so verify the session
  // belongs to the caller's venue before touching its issues.
  const { data: sess } = await staff.db
    .from('import_sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('venue_id', staff.venue_id)
    .maybeSingle();

  if (!sess) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { error } = await staff.db
    .from('import_validation_issues')
    .update({ user_decision: parsed.data.user_decision })
    .eq('session_id', sessionId)
    .eq('issue_type', parsed.data.issue_type);

  if (error) {
    return NextResponse.json({ error: 'Failed to bulk update' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
