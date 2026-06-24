/**
 * Post-import QA spot-check: pull a sample of imported guests, re-read the
 * exact source rows they came from (via the import_file_id / import_row_number
 * breadcrumbs stored at insert), re-apply the session's mappings and
 * normalisers, and compare field by field.
 *
 * The comparison is fully deterministic; AI only writes the human summary
 * (with a deterministic fallback). The report is stored on the session and
 * shown on the completion screen.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { applyMappingsToDataRow, type DbMappingRow } from '@/lib/import/apply-mappings';
import { downloadAndParseCsv } from '@/lib/import/parse-storage-csv';
import { normaliseEmail, normalisePhone, splitFullName } from '@/lib/import/normalize';
import { defaultPhoneCountryFromCurrency } from '@/lib/phone/e164';
import { runImportAiJson } from '@/lib/import/openai-client';

export interface QaMismatch {
  guest_id: string;
  row_number: number;
  field: string;
  expected: string | null;
  actual: string | null;
}

export interface QaReport {
  checked: number;
  matched: number;
  mismatches: QaMismatch[];
  summary: string;
  generated_at: string;
}

const SAMPLE_SIZE = 15;

function norm(v: string | null | undefined): string | null {
  const t = v?.trim();
  return t ? t.toLowerCase() : null;
}

export async function runImportQaSpotCheck(
  admin: SupabaseClient,
  sessionId: string,
  venueId: string,
): Promise<QaReport> {
  const { data: venueRow } = await admin
    .from('venues')
    .select('currency')
    .eq('id', venueId)
    .maybeSingle();
  const defaultPhoneCountry = defaultPhoneCountryFromCurrency(
    (venueRow as { currency?: string | null } | null)?.currency,
  );

  const { data: records } = await admin
    .from('import_records')
    .select('record_id')
    .eq('session_id', sessionId)
    .eq('venue_id', venueId)
    .eq('record_type', 'guest')
    .eq('action', 'created')
    .limit(200);

  const guestIds = (records ?? []).map((r) => (r as { record_id: string }).record_id);
  if (!guestIds.length) {
    return emptyReport('No newly created clients to check (existing clients were updated in place).');
  }

  // Spread the sample across the whole import rather than the first N.
  const step = Math.max(1, Math.floor(guestIds.length / SAMPLE_SIZE));
  const sampleIds = guestIds.filter((_, i) => i % step === 0).slice(0, SAMPLE_SIZE);

  const { data: guests } = await admin
    .from('guests')
    .select('id, first_name, last_name, email, phone, custom_fields')
    .in('id', sampleIds)
    .eq('venue_id', venueId);

  const traceable = (guests ?? [])
    .map((g) => {
      const row = g as {
        id: string;
        first_name: string | null;
        last_name: string | null;
        email: string | null;
        phone: string | null;
        custom_fields?: Record<string, unknown> | null;
      };
      const cf = row.custom_fields ?? {};
      const fileId = typeof cf.import_file_id === 'string' ? cf.import_file_id : null;
      const rowNumber = typeof cf.import_row_number === 'number' ? cf.import_row_number : null;
      return fileId && rowNumber ? { guest: row, fileId, rowNumber } : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (!traceable.length) {
    return emptyReport('Imported clients could not be traced back to file rows for spot-checking.');
  }

  const fileIds = [...new Set(traceable.map((t) => t.fileId))];
  const [{ data: files }, { data: mappingRows }] = await Promise.all([
    admin.from('import_files').select('id, storage_path').in('id', fileIds),
    admin.from('import_column_mappings').select('*').eq('session_id', sessionId),
  ]);

  const pathByFile = new Map(
    ((files ?? []) as Array<{ id: string; storage_path: string }>).map((f) => [f.id, f.storage_path]),
  );
  const mappingsByFile = new Map<string, DbMappingRow[]>();
  for (const m of mappingRows ?? []) {
    const fid = (m as { file_id: string }).file_id;
    const list = mappingsByFile.get(fid) ?? [];
    list.push(m as DbMappingRow);
    mappingsByFile.set(fid, list);
  }

  const rowsByFile = new Map<string, Record<string, string>[]>();
  for (const fid of fileIds) {
    const path = pathByFile.get(fid);
    if (!path) continue;
    try {
      const parsed = await downloadAndParseCsv(admin, path);
      rowsByFile.set(fid, parsed.rows);
    } catch (e) {
      console.error('[import qa] could not re-read source file', { fid, e });
    }
  }

  let checked = 0;
  let matched = 0;
  const mismatches: QaMismatch[] = [];

  for (const t of traceable) {
    const rows = rowsByFile.get(t.fileId);
    const maps = mappingsByFile.get(t.fileId);
    const source = rows?.[t.rowNumber - 1];
    if (!source || !maps) continue;

    const { targets } = applyMappingsToDataRow(source, maps);
    let expectedFirst = targets.first_name?.trim() || null;
    let expectedLast = targets.last_name?.trim() || null;
    if (!expectedFirst && !expectedLast && targets.full_name) {
      const s = splitFullName(targets.full_name);
      expectedFirst = s.first || null;
      expectedLast = s.last || null;
    }
    const expectedEmail = normaliseEmail(targets.email ?? null);
    const expectedPhone = normalisePhone(targets.phone ?? null, defaultPhoneCountry);

    checked += 1;
    const rowMismatches: QaMismatch[] = [];
    const compare = (field: string, expected: string | null, actual: string | null) => {
      // Only flag when the source had a value and the import disagrees —
      // enrichment/merge from other rows is not a mismatch.
      if (expected && norm(expected) !== norm(actual)) {
        rowMismatches.push({
          guest_id: t.guest.id,
          row_number: t.rowNumber,
          field,
          expected,
          actual,
        });
      }
    };
    compare('first_name', expectedFirst, t.guest.first_name);
    compare('last_name', expectedLast, t.guest.last_name);
    compare('email', expectedEmail, t.guest.email);
    if (!expectedPhone.warning) compare('phone', expectedPhone.e164, t.guest.phone);

    if (rowMismatches.length === 0) matched += 1;
    else mismatches.push(...rowMismatches);
  }

  const summary = await buildSummary(checked, matched, mismatches);
  return {
    checked,
    matched,
    mismatches: mismatches.slice(0, 20),
    summary,
    generated_at: new Date().toISOString(),
  };
}

function emptyReport(summary: string): QaReport {
  return { checked: 0, matched: 0, mismatches: [], summary, generated_at: new Date().toISOString() };
}

const SUMMARY_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['summary'],
  properties: {
    summary: { type: 'string', description: '1–2 plain-English sentences for a business owner.' },
  },
};

async function buildSummary(checked: number, matched: number, mismatches: QaMismatch[]): Promise<string> {
  const deterministic =
    mismatches.length === 0
      ? `We spot-checked ${checked} imported client${checked === 1 ? '' : 's'} against your original file — every field matched.`
      : `We spot-checked ${checked} imported clients against your original file: ${matched} matched fully, with ${mismatches.length} field difference${mismatches.length === 1 ? '' : 's'} worth a look.`;

  if (mismatches.length === 0) return deterministic;

  const ai = await runImportAiJson<{ summary: string }>({
    callSite: 'qa-spot-check',
    system: 'You summarise data-import quality checks for a non-technical business owner. Be factual and brief.',
    user: `
Spot-check result: ${checked} sampled records, ${matched} fully matched.
Field differences found:
${JSON.stringify(mismatches.slice(0, 10), null, 1)}

Write 1–2 sentences saying what was checked and what kind of differences exist.`,
    schemaName: 'qa_summary',
    schema: SUMMARY_SCHEMA,
  });
  return ai?.data.summary ?? deterministic;
}
