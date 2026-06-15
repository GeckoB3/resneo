/**
 * Stage 5 "Import Plan": one plain-English summary of everything the import is
 * about to do, assembled deterministically from session state, with an
 * AI-written narrative on top (deterministic template fallback when AI is
 * unavailable). The user's job collapses to reading this and pressing Approve.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { runImportAiJson } from '@/lib/import/openai-client';
import { readValueRepairs } from '@/lib/import/value-repair';

export interface ImportPlanStats {
  files: Array<{ filename: string; file_type: string; row_count: number }>;
  total_client_rows: number;
  total_booking_rows: number;
  mappings: { mapped: number; ignored: number; custom: number; split: number };
  references: { resolved: number; skipped: number; pending: number };
  issues: Array<{ issue_type: string; severity: string; count: number; decided: number }>;
  blocked_rows: number;
  date_format: string | null;
  date_format_source: string | null;
  value_repairs: number;
  detected_platform: string | null;
}

export async function buildImportPlanStats(
  admin: SupabaseClient,
  sessionId: string,
  venueId: string,
): Promise<ImportPlanStats | null> {
  const [{ data: session }, { data: files }, { data: mappings }, { data: refs }, { data: issues }] =
    await Promise.all([
      admin
        .from('import_sessions')
        .select('detected_platform, session_settings')
        .eq('id', sessionId)
        .eq('venue_id', venueId)
        .maybeSingle(),
      admin
        .from('import_files')
        .select('filename, file_type, row_count')
        .eq('session_id', sessionId)
        .order('created_at'),
      admin.from('import_column_mappings').select('action').eq('session_id', sessionId),
      admin
        .from('import_booking_references')
        .select('resolution_action, is_resolved')
        .eq('session_id', sessionId),
      admin
        .from('import_validation_issues')
        .select('issue_type, severity, user_decision')
        .eq('session_id', sessionId),
    ]);

  if (!session) return null;

  const settings = ((session as { session_settings?: Record<string, unknown> | null })
    .session_settings ?? {}) as Record<string, unknown>;
  const repairs = readValueRepairs(settings);

  const fileRows = (files ?? []) as Array<{ filename: string; file_type: string; row_count: number | null }>;
  const mappingRows = (mappings ?? []) as Array<{ action: string }>;
  const refRows = (refs ?? []) as Array<{ resolution_action: string | null; is_resolved: boolean }>;
  const issueRows = (issues ?? []) as Array<{
    issue_type: string;
    severity: string;
    user_decision: string | null;
  }>;

  const issueGroups = new Map<string, { severity: string; count: number; decided: number }>();
  let blockedRows = 0;
  for (const i of issueRows) {
    const g = issueGroups.get(i.issue_type) ?? { severity: i.severity, count: 0, decided: 0 };
    g.count += 1;
    if (i.user_decision) g.decided += 1;
    issueGroups.set(i.issue_type, g);
    if (i.severity === 'error' && !i.user_decision) blockedRows += 1;
  }

  return {
    files: fileRows.map((f) => ({
      filename: f.filename,
      file_type: f.file_type,
      row_count: f.row_count ?? 0,
    })),
    total_client_rows: fileRows
      .filter((f) => f.file_type === 'clients')
      .reduce((a, f) => a + (f.row_count ?? 0), 0),
    total_booking_rows: fileRows
      .filter((f) => f.file_type === 'bookings')
      .reduce((a, f) => a + (f.row_count ?? 0), 0),
    mappings: {
      mapped: mappingRows.filter((m) => m.action === 'map').length,
      ignored: mappingRows.filter((m) => m.action === 'ignore').length,
      custom: mappingRows.filter((m) => m.action === 'custom').length,
      split: mappingRows.filter((m) => m.action === 'split').length,
    },
    references: {
      resolved: refRows.filter((r) => r.is_resolved && r.resolution_action !== 'skip').length,
      skipped: refRows.filter((r) => r.resolution_action === 'skip').length,
      pending: refRows.filter((r) => !r.is_resolved).length,
    },
    issues: [...issueGroups.entries()].map(([issue_type, g]) => ({ issue_type, ...g })),
    blocked_rows: blockedRows,
    date_format: (settings.ambiguous_date_format as string | undefined) ?? null,
    date_format_source: (settings.ambiguous_date_format_source as string | undefined) ?? null,
    value_repairs:
      Object.values(repairs.dates).filter(Boolean).length +
      Object.values(repairs.times).filter(Boolean).length,
    detected_platform:
      (session as { detected_platform?: string | null }).detected_platform ?? null,
  };
}

const NARRATIVE_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['headline', 'narrative'],
  properties: {
    headline: { type: 'string', description: 'One short sentence, e.g. "Ready to import 512 clients and 2,048 bookings."' },
    narrative: {
      type: 'string',
      description: '3–6 short sentences of plain English a non-technical business owner understands.',
    },
  },
};

/** Deterministic narrative used when AI is unavailable. */
export function fallbackPlanNarrative(stats: ImportPlanStats): { headline: string; narrative: string } {
  const parts: string[] = [];
  if (stats.total_client_rows > 0) parts.push(`${stats.total_client_rows.toLocaleString()} client rows`);
  if (stats.total_booking_rows > 0) parts.push(`${stats.total_booking_rows.toLocaleString()} booking rows`);
  const headline = `Ready to import ${parts.join(' and ') || 'your data'}.`;
  const lines: string[] = [
    `${stats.mappings.mapped} columns are mapped to ResNeo fields (${stats.mappings.ignored} ignored, ${stats.mappings.custom} kept as custom fields).`,
  ];
  if (stats.references.resolved > 0 || stats.references.skipped > 0) {
    lines.push(
      `${stats.references.resolved} service/staff names are matched to your catalogue${stats.references.skipped ? `, ${stats.references.skipped} skipped at your request` : ''}.`,
    );
  }
  if (stats.value_repairs > 0) {
    lines.push(`${stats.value_repairs} hard-to-read dates or times were repaired automatically.`);
  }
  if (stats.blocked_rows > 0) {
    lines.push(`${stats.blocked_rows} rows still need a decision below before they can import.`);
  } else {
    lines.push('Nothing is blocking the import.');
  }
  return { headline, narrative: lines.join(' ') };
}

export async function generatePlanNarrative(
  stats: ImportPlanStats,
): Promise<{ headline: string; narrative: string; model: string | null }> {
  const result = await runImportAiJson<{ headline: string; narrative: string }>({
    callSite: 'import-plan',
    system:
      'You summarise a data-import plan for a small-business owner with no technical background. Be specific with numbers, reassuring in tone, and never invent figures that are not in the data.',
    user: `
Write a headline and a 3–6 sentence summary of this import plan. Mention what will be
imported, anything that was fixed automatically (header rows skipped, dates repaired,
names matched), and what — if anything — still needs the user's attention.

Plan data:
${JSON.stringify(stats, null, 1)}
`,
    schemaName: 'import_plan_narrative',
    schema: NARRATIVE_SCHEMA,
  });
  if (!result) {
    const fb = fallbackPlanNarrative(stats);
    return { ...fb, model: null };
  }
  return { ...result.data, model: result.model };
}
