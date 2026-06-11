import { NextResponse } from 'next/server';
import { requireImportAdmin } from '@/lib/import/auth';
import { runAiMapReferences, REF_COMPATIBLE_KINDS } from '@/lib/import/ai-map-references';
import { FUZZY_AUTO_RESOLVE_THRESHOLD, fuzzyNameScore } from '@/lib/import/fuzzy-match';
import { denormalizeReferenceOntoBookingRows } from '@/lib/import/denormalize-booking-rows';
import { refreshImportReferencesResolved } from '@/lib/import/refresh-references-resolved';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { resolveVenueMode } from '@/lib/venue-mode';

/** Candidate kind → import_booking_references.resolved_entity_type. */
function entityTypeForKind(referenceType: string, kind: string): string | null {
  if (referenceType === 'service' && kind === 'service_item') return 'service_item';
  if (referenceType === 'service' && kind === 'appointment_service') return 'appointment_service';
  if (referenceType === 'staff' && kind === 'calendar') return 'unified_calendar';
  if (referenceType === 'staff' && kind === 'practitioner') return 'practitioner';
  if (referenceType === 'event' && kind === 'event_session') return 'event_session';
  if (referenceType === 'class' && kind === 'class_instance') return 'class_instance';
  if (referenceType === 'resource' && kind === 'resource_calendar') return 'unified_calendar';
  return null;
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const ctx = await requireImportAdmin();
  if ('response' in ctx) return ctx.response;
  const { staff } = ctx;
  const { sessionId } = await params;
  const admin = getSupabaseAdminClient();
  const venueId = staff.venue_id;

  const venueMode = await resolveVenueMode(admin, venueId);
  const bm = venueMode.bookingModel;

  const { data: sessionRow } = await admin
    .from('import_sessions')
    .select('session_settings')
    .eq('id', sessionId)
    .eq('venue_id', venueId)
    .maybeSingle();
  const sessionSettings =
    ((sessionRow as { session_settings?: Record<string, unknown> | null } | null)?.session_settings ??
      {}) as Record<string, unknown>;
  const userInstructions =
    typeof sessionSettings.ai_instructions === 'string' && sessionSettings.ai_instructions.trim()
      ? sessionSettings.ai_instructions.trim()
      : null;

  const { data: refs } = await admin
    .from('import_booking_references')
    .select('id, reference_type, raw_value, is_resolved')
    .eq('session_id', sessionId)
    .eq('venue_id', venueId);

  const pending = (refs ?? []).filter((r) => !(r as { is_resolved?: boolean }).is_resolved) as Array<{
    id: string;
    reference_type: string;
    raw_value: string;
  }>;
  if (!pending.length) {
    return NextResponse.json({ ok: true, updated: 0, auto_resolved: 0, message: 'Nothing to map' });
  }

  const candidates: Array<{ id: string; name: string; kind: string }> = [];

  if (bm === 'unified_scheduling') {
    const [{ data: sis }, { data: cals }] = await Promise.all([
      admin.from('service_items').select('id, name').eq('venue_id', venueId).eq('is_active', true),
      admin.from('unified_calendars').select('id, name').eq('venue_id', venueId).eq('is_active', true),
    ]);
    for (const s of sis ?? []) {
      candidates.push({ id: (s as { id: string }).id, name: (s as { name: string }).name, kind: 'service_item' });
    }
    for (const c of cals ?? []) {
      candidates.push({ id: (c as { id: string }).id, name: (c as { name: string }).name, kind: 'calendar' });
    }
  } else if (bm === 'practitioner_appointment') {
    const [{ data: ppl }, { data: svcs }] = await Promise.all([
      admin.from('practitioners').select('id, name').eq('venue_id', venueId).eq('is_active', true),
      admin.from('appointment_services').select('id, name').eq('venue_id', venueId).eq('is_active', true),
    ]);
    for (const p of ppl ?? []) {
      candidates.push({ id: (p as { id: string }).id, name: (p as { name: string }).name, kind: 'practitioner' });
    }
    for (const s of svcs ?? []) {
      candidates.push({ id: (s as { id: string }).id, name: (s as { name: string }).name, kind: 'appointment_service' });
    }
  } else if (bm === 'event_ticket') {
    const { data: sessions } = await admin
      .from('event_sessions')
      .select('id, session_date, start_time')
      .eq('venue_id', venueId)
      .eq('is_cancelled', false)
      .limit(300);
    for (const es of sessions ?? []) {
      const x = es as { id: string; session_date: string; start_time: string };
      candidates.push({
        id: x.id,
        name: `${x.session_date} ${String(x.start_time).slice(0, 5)}`,
        kind: 'event_session',
      });
    }
  } else if (bm === 'class_session') {
    const { data: typeRows } = await admin.from('class_types').select('id').eq('venue_id', venueId);
    const typeIds = (typeRows ?? []).map((t) => (t as { id: string }).id);
    if (typeIds.length) {
      const { data: inst } = await admin
        .from('class_instances')
        .select('id, instance_date, start_time, class_types(name)')
        .in('class_type_id', typeIds)
        .eq('is_cancelled', false)
        .limit(300);
      for (const ci of inst ?? []) {
        const row = ci as {
          id: string;
          instance_date: string;
          start_time: string;
          class_types: { name?: string } | { name?: string }[] | null;
        };
        const tn = Array.isArray(row.class_types) ? row.class_types[0]?.name : row.class_types?.name;
        candidates.push({
          id: row.id,
          name: `${tn ?? 'Class'} · ${row.instance_date} ${String(row.start_time).slice(0, 5)}`,
          kind: 'class_instance',
        });
      }
    }
  } else if (bm === 'resource_booking') {
    const { data: resCals } = await admin
      .from('unified_calendars')
      .select('id, name')
      .eq('venue_id', venueId)
      .eq('is_active', true)
      .eq('calendar_type', 'resource');
    for (const c of resCals ?? []) {
      candidates.push({ id: (c as { id: string }).id, name: (c as { name: string }).name, kind: 'resource_calendar' });
    }
  }

  // ── Tier 1: deterministic auto-resolve ─────────────────────────────────────
  // A reference whose name is a normalised-exact / containment match for exactly
  // one catalogue entity needs no AI and no user click — resolve it outright.
  let autoResolved = 0;
  const stillPending: typeof pending = [];

  for (const ref of pending) {
    const compatible = REF_COMPATIBLE_KINDS[ref.reference_type] ?? [];
    const scored = candidates
      .filter((c) => compatible.includes(c.kind))
      .map((c) => ({ c, score: fuzzyNameScore(ref.raw_value, c.name) }))
      .sort((a, b) => b.score - a.score);

    const best = scored[0];
    const runnerUp = scored[1];
    const uniqueWinner =
      best &&
      best.score >= FUZZY_AUTO_RESOLVE_THRESHOLD &&
      (!runnerUp || runnerUp.score < FUZZY_AUTO_RESOLVE_THRESHOLD);

    if (!uniqueWinner) {
      stillPending.push(ref);
      continue;
    }

    const entityType = entityTypeForKind(ref.reference_type, best.c.kind);
    if (!entityType) {
      stillPending.push(ref);
      continue;
    }

    const { error: upErr } = await admin
      .from('import_booking_references')
      .update({
        resolution_action: 'map',
        resolved_entity_id: best.c.id,
        resolved_entity_type: entityType,
        is_resolved: true,
        ai_suggested_entity_id: best.c.id,
        ai_suggested_entity_name: best.c.name,
        ai_confidence: 'high',
        ai_reasoning: 'Name matches this catalogue entry exactly.',
        updated_at: new Date().toISOString(),
      })
      .eq('id', ref.id)
      .eq('session_id', sessionId)
      .eq('venue_id', venueId);

    if (upErr) {
      console.error('[ai-map-references] auto-resolve update failed', upErr);
      stillPending.push(ref);
      continue;
    }

    await denormalizeReferenceOntoBookingRows(
      admin,
      sessionId,
      venueId,
      {
        reference_type: ref.reference_type,
        raw_value: ref.raw_value,
        resolution_action: 'map',
        resolved_entity_id: best.c.id,
        resolved_entity_type: entityType,
      },
      bm,
    );
    autoResolved += 1;
  }

  // ── Tier 2: AI suggestions for the residue ─────────────────────────────────
  let updated = 0;
  let modelUsed: string | null = null;

  if (stillPending.length > 0) {
    const ai = await runAiMapReferences({
      references: stillPending.map((r) => ({
        id: r.id,
        reference_type: r.reference_type,
        raw_value: r.raw_value,
      })),
      candidates,
      userInstructions,
    });

    modelUsed = ai?.model ?? null;

    if (ai?.suggestions?.length) {
      for (const s of ai.suggestions) {
        const sugId = s.suggested_entity_id;
        if (!sugId) continue;
        const match = candidates.find((c) => c.id === sugId);
        if (!match) continue;

        const refRow = stillPending.find((r) => r.id === s.reference_id);
        if (!refRow) continue;

        const entityType = entityTypeForKind(refRow.reference_type, match.kind);
        if (!entityType) continue;

        const label = s.suggested_entity_label ?? match.name ?? '';

        const { error } = await admin
          .from('import_booking_references')
          .update({
            ai_suggested_entity_id: sugId,
            ai_suggested_entity_name: label,
            ai_confidence: s.confidence,
            ai_reasoning: s.reasoning,
            updated_at: new Date().toISOString(),
          })
          .eq('id', s.reference_id)
          .eq('session_id', sessionId)
          .eq('venue_id', venueId);

        if (!error) updated += 1;
      }
    }
  }

  if (autoResolved > 0) {
    await refreshImportReferencesResolved(admin, sessionId, venueId);
  }

  if (modelUsed) {
    await admin
      .from('import_sessions')
      .update({
        ai_mapping_used: true,
        ai_model_used: modelUsed,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sessionId)
      .eq('venue_id', venueId);
  }

  return NextResponse.json({
    ok: true,
    updated,
    auto_resolved: autoResolved,
    model: modelUsed,
  });
}
