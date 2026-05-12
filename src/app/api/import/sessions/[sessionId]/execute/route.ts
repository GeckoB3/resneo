import { NextResponse } from 'next/server';
import { requireImportAdmin } from '@/lib/import/auth';
import {
  createInitialImportExecuteState,
  IMPORT_EXECUTE_STATE_KEY,
  type ImportExecuteStateV1,
} from '@/lib/import/import-execute-state';
import { runImportExecuteBatch } from '@/lib/import/run-execute';
import { getSupabaseAdminClient } from '@/lib/supabase';

export const maxDuration = 300;

/** Per-request row budget so each invocation stays under serverless limits; importer resumes across POSTs. */
const IMPORT_BATCH_MAX_ROWS = 300;

function isImportExecuteStateV1(x: unknown): x is ImportExecuteStateV1 {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return (
    o.phase === 'clients' || o.phase === 'staged_bookings' || o.phase === 'csv_bookings'
  );
}

function progressTotalFromFiles(
  files: { file_type?: string | null; row_count?: number | null }[] | null,
): number {
  return (files ?? []).reduce((acc, f) => {
    if (f.file_type === 'staff') return acc;
    return acc + (f.row_count ?? 0);
  }, 0);
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const ctx = await requireImportAdmin();
  if ('response' in ctx) return ctx.response;
  const { staff } = ctx;
  const { sessionId } = await params;

  const { data: session } = await staff.db
    .from('import_sessions')
    .select('id, status, has_booking_file, references_resolved, session_settings, total_rows')
    .eq('id', sessionId)
    .eq('venue_id', staff.venue_id)
    .maybeSingle();

  if (!session) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const sess = session as {
    status: string;
    has_booking_file?: boolean | null;
    references_resolved?: boolean | null;
    session_settings?: Record<string, unknown> | null;
    total_rows?: number | null;
  };
  if (sess.has_booking_file && sess.references_resolved !== true) {
    return NextResponse.json(
      {
        error: 'Booking references are not resolved',
        message:
          'Complete Step 3b (Match Booking References) before importing. Open the References step in the import wizard.',
        code: 'REFERENCES_UNRESOLVED',
      },
      { status: 400 },
    );
  }

  const st = sess.status;
  if (st === 'complete') {
    return NextResponse.json({ ok: true, done: true, alreadyComplete: true });
  }

  const venueId = staff.venue_id;
  const staffId = staff.id;
  const admin = getSupabaseAdminClient();

  const { data: importFiles } = await staff.db
    .from('import_files')
    .select('file_type, row_count')
    .eq('session_id', sessionId);
  const progressTotal =
    progressTotalFromFiles(importFiles ?? []) || (typeof sess.total_rows === 'number' ? sess.total_rows : 0) || 0;

  try {
    if (st === 'importing') {
      const rawCheckpoint = sess.session_settings?.[IMPORT_EXECUTE_STATE_KEY];
      if (!isImportExecuteStateV1(rawCheckpoint)) {
        return NextResponse.json(
          {
            error: 'Import checkpoint missing',
            message: 'Cannot resume this import. Reset the session or contact support.',
          },
          { status: 409 },
        );
      }

      const result = await runImportExecuteBatch(admin, sessionId, venueId, staffId, {
        maxRows: IMPORT_BATCH_MAX_ROWS,
        state: rawCheckpoint,
      });

      if (!result.finished) {
        const prev = (sess.session_settings ?? {}) as Record<string, unknown>;
        await admin
          .from('import_sessions')
          .update({
            session_settings: { ...prev, [IMPORT_EXECUTE_STATE_KEY]: result.state },
            updated_at: new Date().toISOString(),
          })
          .eq('id', sessionId);
      }

      return NextResponse.json({ ok: true, done: result.finished });
    }

    if (st !== 'ready') {
      return NextResponse.json(
        { error: 'Run validation first — session must be in "ready" state before import.' },
        { status: 409 },
      );
    }

    const { data: unresolved } = await staff.db
      .from('import_validation_issues')
      .select('id')
      .eq('session_id', sessionId)
      .eq('issue_type', 'existing_client')
      .is('user_decision', null)
      .limit(1);
    if ((unresolved ?? []).length > 0) {
      return NextResponse.json(
        {
          error: 'Existing-client decisions required',
          message:
            'Some rows match an existing client. Choose Update existing or Skip for each before starting the import.',
          code: 'EXISTING_CLIENT_DECISIONS_REQUIRED',
        },
        { status: 400 },
      );
    }

    const { data: blockingDefaults } = await staff.db
      .from('import_validation_issues')
      .select('id, message')
      .eq('session_id', sessionId)
      .eq('issue_type', 'booking_defaults_missing')
      .limit(1);
    if ((blockingDefaults ?? []).length > 0) {
      const msg = (blockingDefaults![0] as { message?: string }).message;
      return NextResponse.json(
        {
          error: 'Venue is missing required defaults',
          message:
            msg ?? 'Configure the venue before importing bookings (default area, calendar, service, or practitioner).',
          code: 'BOOKING_DEFAULTS_MISSING',
        },
        { status: 400 },
      );
    }

    const initialState = createInitialImportExecuteState();
    const prevSettings = (sess.session_settings ?? {}) as Record<string, unknown>;
    const mergedSettings = { ...prevSettings, [IMPORT_EXECUTE_STATE_KEY]: initialState };

    const { data: locked, error: lockErr } = await staff.db
      .from('import_sessions')
      .update({
        status: 'importing',
        started_at: new Date().toISOString(),
        error_message: null,
        progress_total: progressTotal,
        progress_processed: 0,
        imported_clients: 0,
        imported_bookings: 0,
        skipped_rows: 0,
        updated_existing: 0,
        session_settings: mergedSettings,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId)
      .eq('venue_id', staff.venue_id)
      .eq('status', 'ready')
      .select('id')
      .maybeSingle();

    if (lockErr) {
      console.error('[import execute] lock', lockErr);
      return NextResponse.json({ error: 'Failed to start import' }, { status: 500 });
    }
    if (!locked) {
      return NextResponse.json(
        { error: 'Import could not be started — session is no longer in the ready state.' },
        { status: 409 },
      );
    }

    const result = await runImportExecuteBatch(admin, sessionId, venueId, staffId, {
      maxRows: IMPORT_BATCH_MAX_ROWS,
      state: initialState,
    });

    if (!result.finished) {
      await admin
        .from('import_sessions')
        .update({
          session_settings: { ...mergedSettings, [IMPORT_EXECUTE_STATE_KEY]: result.state },
          updated_at: new Date().toISOString(),
        })
        .eq('id', sessionId);
    }

    return NextResponse.json({ ok: true, done: result.finished });
  } catch (e) {
    console.error('[import execute]', e);
    await admin
      .from('import_sessions')
      .update({
        status: 'failed',
        error_message: e instanceof Error ? e.message : 'Import failed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Import failed' },
      { status: 500 },
    );
  }
}
