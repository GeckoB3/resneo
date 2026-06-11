import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireImportAdmin } from '@/lib/import/auth';
import { SEND_IMPORT_REMINDERS_SESSION_KEY } from '@/lib/import/booking-import-comms';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const ctx = await requireImportAdmin();
  if ('response' in ctx) return ctx.response;
  const { staff } = ctx;
  const { sessionId } = await params;

  const { data: session, error: sErr } = await staff.db
    .from('import_sessions')
    .select('*')
    .eq('id', sessionId)
    .eq('venue_id', staff.venue_id)
    .maybeSingle();

  if (sErr || !session) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const [{ data: files }, { data: mappings }, { data: issues }, { data: bookingReferences }, { data: bookingRows }] =
    await Promise.all([
      staff.db.from('import_files').select('*').eq('session_id', sessionId).order('created_at'),
      staff.db.from('import_column_mappings').select('*').eq('session_id', sessionId).order('sort_order'),
      staff.db.from('import_validation_issues').select('*').eq('session_id', sessionId).order('row_number'),
      staff.db.from('import_booking_references').select('*').eq('session_id', sessionId).order('reference_type'),
      staff.db
        .from('import_booking_rows')
        .select('id, row_number, file_id, is_future_booking, import_status')
        .eq('session_id', sessionId)
        .order('file_id', { ascending: true })
        .order('row_number', { ascending: true }),
    ]);

  return NextResponse.json({
    session,
    files: files ?? [],
    mappings: mappings ?? [],
    issues: issues ?? [],
    booking_references: bookingReferences ?? [],
    booking_rows_preview: bookingRows ?? [],
  });
}

const patchBodySchema = z.object({
  session_settings: z
    .object({
      ambiguous_date_format: z.enum(['dd/MM/yyyy', 'MM/dd/yyyy']).optional().nullable(),
      [SEND_IMPORT_REMINDERS_SESSION_KEY]: z.boolean().optional(),
      /** Free-text guidance from the user that steers the AI mapping stages. */
      ai_instructions: z.string().max(2000).optional().nullable(),
    })
    .optional(),
});

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const ctx = await requireImportAdmin();
  if ('response' in ctx) return ctx.response;
  const { staff } = ctx;
  const { sessionId } = await params;

  const body = await request.json().catch(() => ({}));
  const parsed = patchBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }
  if (!parsed.data.session_settings) {
    return NextResponse.json({ error: 'session_settings required' }, { status: 400 });
  }

  const { data: session, error: loadErr } = await staff.db
    .from('import_sessions')
    .select('id, status, session_settings')
    .eq('id', sessionId)
    .eq('venue_id', staff.venue_id)
    .maybeSingle();

  if (loadErr) {
    console.error('[import session PATCH] load', loadErr);
    return NextResponse.json({ error: 'Failed to load session' }, { status: 500 });
  }
  if (!session) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const st = (session as { status: string }).status;
  if (st === 'importing' || st === 'complete') {
    return NextResponse.json(
      { error: 'Cannot change import settings while importing or after completion.' },
      { status: 409 },
    );
  }

  const prev = ((session as { session_settings?: Record<string, unknown> }).session_settings ??
    {}) as Record<string, unknown>;
  const merged = { ...prev, ...parsed.data.session_settings };

  const { data: updated, error: updateErr } = await staff.db
    .from('import_sessions')
    .update({
      session_settings: merged,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId)
    .eq('venue_id', staff.venue_id)
    .select('id, session_settings')
    .maybeSingle();

  if (updateErr) {
    console.error('[import session PATCH]', updateErr);
    return NextResponse.json({ error: 'Failed to update session' }, { status: 500 });
  }

  return NextResponse.json({ session: updated });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const ctx = await requireImportAdmin();
  if ('response' in ctx) return ctx.response;
  const { staff } = ctx;
  const { sessionId } = await params;

  const { data: existing, error: findErr } = await staff.db
    .from('import_sessions')
    .select('id')
    .eq('id', sessionId)
    .eq('venue_id', staff.venue_id)
    .maybeSingle();

  if (findErr) {
    console.error('[import session DELETE] lookup', findErr);
    return NextResponse.json({ error: 'Failed to load session' }, { status: 500 });
  }
  if (!existing) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const { data: fileRows, error: filesErr } = await staff.db
    .from('import_files')
    .select('storage_path')
    .eq('session_id', sessionId)
    .eq('venue_id', staff.venue_id);

  if (filesErr) {
    console.error('[import session DELETE] files', filesErr);
    return NextResponse.json({ error: 'Failed to list session files' }, { status: 500 });
  }

  const paths = (fileRows ?? [])
    .map((r) => (r as { storage_path: string }).storage_path)
    .filter((p): p is string => Boolean(p?.trim()));

  if (paths.length > 0) {
    const { error: storageErr } = await staff.db.storage.from('imports').remove(paths);
    if (storageErr) {
      console.error('[import session DELETE] storage', storageErr);
      return NextResponse.json({ error: 'Failed to remove uploaded files from storage' }, { status: 500 });
    }
  }

  const { error: delErr } = await staff.db
    .from('import_sessions')
    .delete()
    .eq('id', sessionId)
    .eq('venue_id', staff.venue_id);

  if (delErr) {
    console.error('[import session DELETE]', delErr);
    return NextResponse.json({ error: 'Failed to delete session' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
