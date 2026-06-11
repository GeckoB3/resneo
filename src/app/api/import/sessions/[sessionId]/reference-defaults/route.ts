import { NextRequest, NextResponse } from 'next/server';
import { requireImportAdmin } from '@/lib/import/auth';
import { parseCurrencyPence } from '@/lib/import/normalize';
import { getSupabaseAdminClient } from '@/lib/supabase';

/**
 * Suggested setup values for services that will be CREATED from the import:
 * the most common duration and price seen across that service's booking rows.
 * Lets the wizard prefill "Gel Nails — 45 min, £28" instead of asking the user
 * to fill everything in cold.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const ctx = await requireImportAdmin();
  if ('response' in ctx) return ctx.response;
  const { staff } = ctx;
  const { sessionId } = await params;
  const admin = getSupabaseAdminClient();
  const venueId = staff.venue_id;

  const { data: refs } = await admin
    .from('import_booking_references')
    .select('id, reference_type, raw_value, is_resolved')
    .eq('session_id', sessionId)
    .eq('venue_id', venueId)
    .eq('reference_type', 'service');

  const serviceRefs = (refs ?? []) as Array<{
    id: string;
    raw_value: string;
    is_resolved: boolean;
  }>;
  if (!serviceRefs.length) {
    return NextResponse.json({ suggestions: [] });
  }

  // Aggregate duration/price evidence per service name across booking rows.
  type Acc = { durations: Map<number, number>; prices: Map<number, number>; count: number };
  const byName = new Map<string, Acc>();
  const PAGE_SIZE = 1000;
  let offset = 0;
  while (true) {
    const { data, error } = await admin
      .from('import_booking_rows')
      .select('raw_service_name, duration_minutes, raw_price, raw_booking_end_time, raw_duration_minutes')
      .eq('session_id', sessionId)
      .eq('venue_id', venueId)
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      console.error('[reference-defaults] booking rows page failed', error.message);
      break;
    }
    const rows = (data ?? []) as Array<{
      raw_service_name: string | null;
      duration_minutes: number | null;
      raw_price: string | null;
      raw_booking_end_time: string | null;
      raw_duration_minutes: string | null;
    }>;
    for (const r of rows) {
      const name = r.raw_service_name?.trim().toLowerCase();
      if (!name) continue;
      const acc = byName.get(name) ?? { durations: new Map(), prices: new Map(), count: 0 };
      acc.count += 1;
      // duration_minutes defaults to 60 when the file had no end time/duration —
      // only treat it as evidence when the file actually provided one.
      const fileHadDuration = Boolean(r.raw_booking_end_time?.trim() || r.raw_duration_minutes?.trim());
      if (fileHadDuration && r.duration_minutes && r.duration_minutes > 0) {
        acc.durations.set(r.duration_minutes, (acc.durations.get(r.duration_minutes) ?? 0) + 1);
      }
      const pence = parseCurrencyPence(r.raw_price);
      if (pence != null && pence > 0) {
        acc.prices.set(pence, (acc.prices.get(pence) ?? 0) + 1);
      }
      byName.set(name, acc);
    }
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  const modeOf = (m: Map<number, number>): number | null => {
    let best: number | null = null;
    let bestCount = 0;
    for (const [v, c] of m) {
      if (c > bestCount) {
        best = v;
        bestCount = c;
      }
    }
    return best;
  };

  const suggestions = serviceRefs.map((ref) => {
    const acc = byName.get(ref.raw_value.trim().toLowerCase());
    return {
      reference_id: ref.id,
      raw_value: ref.raw_value,
      is_resolved: ref.is_resolved,
      suggested_duration_minutes: acc ? modeOf(acc.durations) : null,
      suggested_price_pence: acc ? modeOf(acc.prices) : null,
      sample_count: acc?.count ?? 0,
    };
  });

  return NextResponse.json({ suggestions });
}
