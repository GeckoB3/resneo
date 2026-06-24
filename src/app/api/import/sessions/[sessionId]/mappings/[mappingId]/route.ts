import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireImportAdmin } from '@/lib/import/auth';
import { isCanonicalValueFor, isValueMapTarget } from '@/lib/import/value-map';

const patchSchema = z.object({
  target_field: z.string().nullable().optional(),
  action: z.enum(['map', 'ignore', 'custom', 'split']).optional(),
  custom_field_name: z.string().nullable().optional(),
  custom_field_type: z.enum(['text', 'number', 'date', 'boolean']).nullable().optional(),
  split_config: z.record(z.string(), z.unknown()).nullable().optional(),
  /** Reviewed raw->canonical enum map ({ "CXL": "Cancelled", ... }). */
  value_map: z.record(z.string(), z.string()).nullable().optional(),
  user_overridden: z.boolean().optional(),
});

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string; mappingId: string }> },
) {
  const ctx = await requireImportAdmin();
  if ('response' in ctx) return ctx.response;
  const { staff } = ctx;
  const { sessionId, mappingId } = await params;

  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  const patch: Record<string, unknown> = { ...parsed.data, updated_at: new Date().toISOString() };

  // Validate an edited value map against the mapping's target vocabulary: keep only
  // entries whose canonical value is allowed for the field, drop the rest.
  if ('value_map' in parsed.data) {
    const { data: row } = await staff.db
      .from('import_column_mappings')
      .select('target_field')
      .eq('id', mappingId)
      .eq('session_id', sessionId)
      .maybeSingle();
    const target = (row as { target_field?: string | null } | null)?.target_field ?? null;
    const vm = parsed.data.value_map;
    if (!vm || !isValueMapTarget(target)) {
      patch.value_map = null;
    } else {
      const clean: Record<string, string> = {};
      for (const [from, to] of Object.entries(vm)) {
        if (from.trim() && isCanonicalValueFor(target, to)) clean[from] = to;
      }
      patch.value_map = Object.keys(clean).length ? clean : null;
    }
  }

  const { error } = await staff.db
    .from('import_column_mappings')
    .update(patch)
    .eq('id', mappingId)
    .eq('session_id', sessionId);

  if (error) {
    return NextResponse.json({ error: 'Failed to update mapping' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
