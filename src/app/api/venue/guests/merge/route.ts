import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getVenueStaff, requireAdmin } from '@/lib/venue-auth';
import { runMergeGuestsTransaction } from '@/lib/guests/merge-guests';
import { insertContactAuditEvent } from '@/lib/guests/contact-audit';
import { normalizeToE164 } from '@/lib/phone/e164';
import { normaliseGuestTagsInput } from '@/lib/guests/tags';
import { validateAndCoerceCustomFields, mergeCustomFieldsJson } from '@/lib/guests/custom-field-validation';
import type { CustomClientFieldDefinition } from '@/types/contacts';

const mergeSchema = z.object({
  target_guest_id: z.string().uuid(),
  source_guest_ids: z.array(z.string().uuid()).min(1).max(20),
  merged_profile: z
    .object({
      name: z.string().min(1).max(200).optional(),
      email: z.string().email().max(255).optional().or(z.literal('')),
      phone: z.string().max(24).optional().or(z.literal('')),
      tags: z.array(z.string()).optional(),
      custom_fields: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  field_map: z.record(z.string(), z.unknown()).optional(),
});

/**
 * POST /api/venue/guests/merge — admin-only duplicate merge.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const staff = await getVenueStaff(supabase);
    if (!staff) {
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    }
    if (!requireAdmin(staff)) {
      return NextResponse.json({ error: 'Forbidden: admin only' }, { status: 403 });
    }

    const parsed = mergeSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const { target_guest_id: targetId, source_guest_ids: rawSources, merged_profile, field_map } = parsed.data;
    const sourceIds = [...new Set(rawSources)].filter((id) => id !== targetId);
    if (sourceIds.length === 0) {
      return NextResponse.json({ error: 'No source guests to merge' }, { status: 400 });
    }

    const { data: target, error: tErr } = await staff.db
      .from('guests')
      .select('id, venue_id, custom_fields')
      .eq('id', targetId)
      .eq('venue_id', staff.venue_id)
      .maybeSingle();

    if (tErr || !target) {
      return NextResponse.json({ error: 'Target guest not found' }, { status: 404 });
    }

    const { data: sources, error: sErr } = await staff.db
      .from('guests')
      .select('id')
      .eq('venue_id', staff.venue_id)
      .in('id', sourceIds);

    if (sErr || !sources || sources.length !== sourceIds.length) {
      return NextResponse.json({ error: 'One or more source guests not found' }, { status: 404 });
    }

    if (merged_profile) {
      const profileUpdate: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (merged_profile.name !== undefined) profileUpdate.name = merged_profile.name.trim();
      if (merged_profile.email !== undefined) {
        const e = merged_profile.email.trim();
        profileUpdate.email = e === '' ? null : e.toLowerCase();
      }
      if (merged_profile.phone !== undefined) {
        const raw = merged_profile.phone.trim();
        if (raw === '') {
          profileUpdate.phone = null;
        } else {
          const e164 = normalizeToE164(raw);
          if (!e164) {
            return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
          }
          profileUpdate.phone = e164;
        }
      }
      if (merged_profile.tags !== undefined) {
        profileUpdate.tags = normaliseGuestTagsInput(merged_profile.tags);
      }
      if (merged_profile.custom_fields !== undefined) {
        const { data: defs, error: defErr } = await staff.db
          .from('custom_client_fields')
          .select('id, venue_id, field_name, field_key, field_type, is_active, created_at')
          .eq('venue_id', staff.venue_id);
        if (defErr) {
          return NextResponse.json({ error: 'Failed to load custom field definitions' }, { status: 500 });
        }
        const definitions = (defs ?? []) as CustomClientFieldDefinition[];
        const existingCf =
          (target as { custom_fields?: unknown }).custom_fields &&
          typeof (target as { custom_fields?: unknown }).custom_fields === 'object' &&
          !Array.isArray((target as { custom_fields?: unknown }).custom_fields)
            ? ((target as { custom_fields: Record<string, unknown> }).custom_fields as Record<string, unknown>)
            : {};
        const validated = validateAndCoerceCustomFields(merged_profile.custom_fields, definitions);
        if (!validated.ok) {
          return NextResponse.json({ error: validated.error }, { status: 400 });
        }
        profileUpdate.custom_fields = mergeCustomFieldsJson(existingCf, validated.value);
      }

      const { error: puErr } = await staff.db.from('guests').update(profileUpdate).eq('id', targetId).eq('venue_id', staff.venue_id);
      if (puErr) {
        console.error('merge: profile update failed:', puErr);
        return NextResponse.json({ error: 'Failed to apply merged profile' }, { status: 500 });
      }
    }

    const mergeResult = await runMergeGuestsTransaction(staff.db, {
      venueId: staff.venue_id,
      targetGuestId: targetId,
      sourceGuestIds: sourceIds,
    });

    if (!mergeResult.ok) {
      return NextResponse.json({ error: mergeResult.error }, { status: 400 });
    }

    let mergeEventId: string | null = null;
    const { data: mergeRow, error: meErr } = await staff.db
      .from('guest_merge_events')
      .insert({
        venue_id: staff.venue_id,
        target_guest_id: targetId,
        source_guest_ids: sourceIds,
        field_map: field_map ?? merged_profile ?? {},
        actor_staff_id: staff.id,
      })
      .select('id')
      .single();

    if (meErr) {
      console.error('guest_merge_events insert failed:', meErr);
    } else if (mergeRow && typeof mergeRow === 'object' && 'id' in mergeRow) {
      mergeEventId = (mergeRow as { id: string }).id;
    }

    await insertContactAuditEvent(staff.db, {
      venue_id: staff.venue_id,
      guest_id: targetId,
      actor_staff_id: staff.id,
      event_type: 'guests_merged',
      metadata: { source_guest_ids: sourceIds, merge_event_id: mergeEventId },
    });

    return NextResponse.json({ success: true, target_guest_id: targetId, merged_sources: sourceIds });
  } catch (err) {
    console.error('POST /api/venue/guests/merge failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
