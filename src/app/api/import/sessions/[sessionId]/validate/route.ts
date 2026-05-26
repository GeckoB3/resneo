import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { requireImportAdmin } from '@/lib/import/auth';
import { SEND_IMPORT_REMINDERS_SESSION_KEY } from '@/lib/import/booking-import-comms';
import { runImportValidation } from '@/lib/import/run-validation';
import { getSupabaseAdminClient } from '@/lib/supabase';

const bodySchema = z.object({
  session_settings: z
    .object({
      ambiguous_date_format: z.enum(['dd/MM/yyyy', 'MM/dd/yyyy']).optional().nullable(),
      [SEND_IMPORT_REMINDERS_SESSION_KEY]: z.boolean().optional(),
    })
    .optional(),
});

/** Lightweight status for polling while validation runs (avoids loading issues/mappings each tick). */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const ctx = await requireImportAdmin();
  if ('response' in ctx) return ctx.response;
  const { staff } = ctx;
  const { sessionId } = await params;

  const { data: row, error } = await staff.db
    .from('import_sessions')
    .select(
      'validation_job_id, validation_job_status, validation_job_error, status, validation_rows_processed, validation_rows_total',
    )
    .eq('id', sessionId)
    .eq('venue_id', staff.venue_id)
    .maybeSingle();

  if (error) {
    console.error('[import validate GET]', error);
    return NextResponse.json({ error: 'Failed to load session' }, { status: 500 });
  }
  if (!row) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const r = row as {
    validation_job_id: string | null;
    validation_job_status: string | null;
    validation_job_error: string | null;
    status: string;
    validation_rows_processed: number;
    validation_rows_total: number;
  };

  const total = r.validation_rows_total ?? 0;
  const processed = r.validation_rows_processed ?? 0;
  const percent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;

  return NextResponse.json({
    validation_job_id: r.validation_job_id,
    validation_job_status: r.validation_job_status,
    validation_job_error: r.validation_job_error,
    status: r.status,
    validation_rows_processed: processed,
    validation_rows_total: total,
    percent,
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const ctx = await requireImportAdmin();
  if ('response' in ctx) return ctx.response;
  const { staff } = ctx;
  const { sessionId } = await params;

  const body = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  const { data: session } = await staff.db
    .from('import_sessions')
    .select('session_settings, has_booking_file, references_resolved')
    .eq('id', sessionId)
    .eq('venue_id', staff.venue_id)
    .maybeSingle();

  if (!session) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const s = session as {
    session_settings?: Record<string, unknown>;
    has_booking_file?: boolean | null;
    references_resolved?: boolean | null;
  };
  if (s.has_booking_file && s.references_resolved !== true) {
    return NextResponse.json(
      {
        error: 'Booking references are not resolved',
        message:
          'Complete Step 3b (Match Booking References) before validation. Open the References step in the import wizard.',
        code: 'REFERENCES_UNRESOLVED',
      },
      { status: 400 },
    );
  }

  const prev = s.session_settings ?? {};
  const merged = {
    ...prev,
    ...(parsed.data.session_settings ?? {}),
  };

  const jobId = randomUUID();

  await staff.db
    .from('import_sessions')
    .update({
      status: 'validating',
      session_settings: merged,
      validation_job_id: jobId,
      validation_job_status: 'queued',
      validation_job_error: null,
      validation_rows_processed: 0,
      validation_rows_total: 0,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId);

  const venueId = staff.venue_id;

  after(async () => {
    const admin = getSupabaseAdminClient();
    await admin
      .from('import_sessions')
      .update({ validation_job_status: 'running', updated_at: new Date().toISOString() })
      .eq('id', sessionId);
    try {
      await runImportValidation(admin, sessionId, venueId);
    } catch (e) {
      console.error('[validate]', e);
      await admin
        .from('import_sessions')
        .update({
          validation_job_status: 'failed',
          validation_job_error: e instanceof Error ? e.message : 'Validation failed',
          status: 'failed',
          error_message: e instanceof Error ? e.message : 'Validation failed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', sessionId);
    }
  });

  return NextResponse.json({
    ok: true,
    jobId,
    jobStatus: 'queued',
    message:
      'Validation queued. Poll GET /api/import/sessions/[sessionId]/validate until validation_job_status is complete.',
  });
}
