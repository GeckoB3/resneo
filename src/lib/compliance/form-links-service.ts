import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizePublicBaseUrl } from '@/lib/public-base-url';
import { writeComplianceAuditEvent } from '@/lib/compliance/audit';
import { generateComplianceFormCode } from '@/lib/compliance/short-code';
import { resolveFormLinkExpiryDays, type ComplianceConfig } from '@/lib/compliance/config';
import type { ComplianceLinkSentVia } from '@/lib/compliance/constants';
import type { ServiceResult } from '@/lib/compliance/types-service';
import { COMPLIANCE_BUCKET } from '@/lib/compliance/files';
import { removeStoragePrefix } from '@/lib/venue/venue-storage-cleanup';

/** Public URL for a form-link code (spec §3.4 / §4.6). */
export function complianceFormPublicUrl(code: string): string {
  const base = normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL);
  return `${base}/p/forms/${code}`;
}

interface GuestPrefillSource {
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
  phone?: string | null;
}

/** Build the prefill object from a guest row — only fields that exist on guests (§4.6). */
export function buildPrefillFromGuest(guest: GuestPrefillSource): Record<string, string> {
  const prefill: Record<string, string> = {};
  if (guest.first_name?.trim()) prefill.first_name = guest.first_name.trim();
  if (guest.last_name?.trim()) prefill.last_name = guest.last_name.trim();
  if (guest.email?.trim()) prefill.email = guest.email.trim();
  if (guest.phone?.trim()) prefill.phone = guest.phone.trim();
  return prefill;
}

export interface IssuedFormLink {
  link: Record<string, unknown>;
  reused: boolean;
  publicUrl: string;
}

/**
 * Issue a form link for a (guest, type) pair, or reuse the existing unconsumed
 * one (spec §5.2 — never send a guest two links for the same form). Writes a
 * `link.issued` audit event when a new link is created. Does NOT dispatch the
 * message; the caller dispatches and records `link.sent` (see comms, §12).
 */
export async function issueOrReuseFormLink(
  admin: SupabaseClient,
  params: {
    venueId: string;
    staffId: string | null;
    guestId: string;
    complianceTypeId: string;
    bookingId?: string | null;
    config: ComplianceConfig;
  },
): Promise<ServiceResult<IssuedFormLink>> {
  // Reuse an existing pending, unexpired link for this (guest, type).
  const nowIso = new Date().toISOString();
  const { data: existing } = await admin
    .from('compliance_form_links')
    .select('*')
    .eq('venue_id', params.venueId)
    .eq('guest_id', params.guestId)
    .eq('compliance_type_id', params.complianceTypeId)
    .eq('status', 'pending')
    .gt('expires_at', nowIso)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) {
    const code = (existing as { code: string }).code;
    return { ok: true, value: { link: existing as Record<string, unknown>, reused: true, publicUrl: complianceFormPublicUrl(code) } };
  }

  // Load the type: current version to bind + expiry override + guest prefill source.
  const { data: type } = await admin
    .from('compliance_types')
    .select('id, current_version_id, form_link_expiry_days, is_active')
    .eq('id', params.complianceTypeId)
    .eq('venue_id', params.venueId)
    .maybeSingle();
  if (!type) return { ok: false, error: 'Compliance type not found.', status: 404 };
  if ((type as { is_active?: boolean }).is_active === false) {
    return { ok: false, error: 'Cannot issue a link for an archived type.', status: 400 };
  }

  let versionId = (type as { current_version_id: string | null }).current_version_id;
  if (!versionId) {
    const { data: latest } = await admin
      .from('compliance_type_versions')
      .select('id')
      .eq('compliance_type_id', params.complianceTypeId)
      .order('version_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    versionId = (latest as { id?: string } | null)?.id ?? null;
  }
  if (!versionId) return { ok: false, error: 'Compliance type has no form version.', status: 409 };

  const { data: guest } = await admin
    .from('guests')
    .select('first_name, last_name, email, phone')
    .eq('id', params.guestId)
    .eq('venue_id', params.venueId)
    .maybeSingle();
  if (!guest) return { ok: false, error: 'Guest not found.', status: 404 };

  const expiryDays = resolveFormLinkExpiryDays(
    (type as { form_link_expiry_days: number | null }).form_link_expiry_days,
    params.config,
  );
  const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString();
  const prefill = buildPrefillFromGuest(guest as GuestPrefillSource);

  // Insert with a unique code, retrying on collision.
  for (let attempt = 0; attempt < 12; attempt++) {
    const code = generateComplianceFormCode(10);
    const { data: inserted, error } = await admin
      .from('compliance_form_links')
      .insert({
        venue_id: params.venueId,
        code,
        guest_id: params.guestId,
        compliance_type_id: params.complianceTypeId,
        compliance_type_version_id: versionId,
        booking_id: params.bookingId ?? null,
        status: 'pending',
        prefill,
        expires_at: expiresAt,
        created_by_staff_id: params.staffId,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        // The pending-link uniqueness index fired: a concurrent caller already issued
        // a link for this (guest, type). Re-select and reuse it (spec §5.2). Any other
        // 23505 is a code collision — retry with a fresh code.
        const conflict = `${error.message ?? ''} ${error.details ?? ''}`;
        if (conflict.includes('uq_compliance_form_links_pending')) {
          const { data: raced } = await admin
            .from('compliance_form_links')
            .select('*')
            .eq('venue_id', params.venueId)
            .eq('guest_id', params.guestId)
            .eq('compliance_type_id', params.complianceTypeId)
            .eq('status', 'pending')
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (raced) {
            const racedCode = (raced as { code: string }).code;
            return {
              ok: true,
              value: { link: raced as Record<string, unknown>, reused: true, publicUrl: complianceFormPublicUrl(racedCode) },
            };
          }
        }
        continue; // code collision; retry
      }
      console.error('[issueOrReuseFormLink] insert failed:', error.message);
      return { ok: false, error: 'Failed to issue form link.', status: 500 };
    }

    await writeComplianceAuditEvent(admin, {
      venueId: params.venueId,
      eventType: 'link.issued',
      actorType: params.staffId ? 'staff' : 'system',
      actorStaffId: params.staffId,
      guestId: params.guestId,
      complianceFormLinkId: (inserted as { id: string }).id,
      complianceTypeId: params.complianceTypeId,
    });

    return { ok: true, value: { link: inserted as Record<string, unknown>, reused: false, publicUrl: complianceFormPublicUrl(code) } };
  }

  return { ok: false, error: 'Could not allocate a unique link code. Please retry.', status: 409 };
}

/** Mark a link sent via a channel and write `link.sent` (called after dispatch). */
export async function markFormLinkSent(
  admin: SupabaseClient,
  params: { venueId: string; staffId: string | null; linkId: string; sentVia: ComplianceLinkSentVia; guestId: string; complianceTypeId: string },
): Promise<void> {
  await admin
    .from('compliance_form_links')
    .update({ sent_via: params.sentVia, sent_at: new Date().toISOString() })
    .eq('id', params.linkId)
    .eq('venue_id', params.venueId);
  await writeComplianceAuditEvent(admin, {
    venueId: params.venueId,
    eventType: 'link.sent',
    actorType: params.staffId ? 'staff' : 'system',
    actorStaffId: params.staffId,
    guestId: params.guestId,
    complianceFormLinkId: params.linkId,
    complianceTypeId: params.complianceTypeId,
    metadata: { sent_via: params.sentVia },
  });
}

export async function revokeFormLink(
  admin: SupabaseClient,
  params: { venueId: string; staffId: string; linkId: string },
): Promise<ServiceResult<Record<string, unknown>>> {
  const { data: existing } = await admin
    .from('compliance_form_links')
    .select('id, status, guest_id, compliance_type_id, code')
    .eq('id', params.linkId)
    .eq('venue_id', params.venueId)
    .maybeSingle();
  if (!existing) return { ok: false, error: 'Form link not found.', status: 404 };
  if ((existing as { status: string }).status !== 'pending') {
    return { ok: false, error: 'Only pending links can be revoked.', status: 409 };
  }

  const { data: updated, error } = await admin
    .from('compliance_form_links')
    .update({ status: 'revoked', revoked_at: new Date().toISOString() })
    .eq('id', params.linkId)
    .eq('venue_id', params.venueId)
    .select()
    .single();
  if (error) {
    console.error('[revokeFormLink] failed:', error.message);
    return { ok: false, error: 'Failed to revoke link.', status: 500 };
  }

  await writeComplianceAuditEvent(admin, {
    venueId: params.venueId,
    eventType: 'link.revoked',
    actorType: 'staff',
    actorStaffId: params.staffId,
    guestId: (existing as { guest_id: string }).guest_id,
    complianceFormLinkId: params.linkId,
    complianceTypeId: (existing as { compliance_type_id: string }).compliance_type_id,
  });

  // A revoked link was never consumed, so any uploads under its temp prefix are orphaned
  // (no record references them). Reap them so they do not accumulate (audit M8). Best-effort.
  const revokedCode = (existing as { code?: string | null }).code;
  if (revokedCode) {
    try {
      await removeStoragePrefix(admin, COMPLIANCE_BUCKET, `venues/${params.venueId}/uploads/${revokedCode}`);
    } catch (e) {
      console.error('[revokeFormLink] upload cleanup failed:', e instanceof Error ? e.message : e);
    }
  }

  return { ok: true, value: updated as Record<string, unknown> };
}

/**
 * Retire any still-pending links for a (guest, type) when a record has just been
 * captured in venue, so they stop nagging in "awaiting client submission" and can't be
 * opened later to create a duplicate record. Marks them consumed against the new record.
 * Best-effort: never throws (a logging/update hiccup must not fail the capture).
 */
export async function consumePendingLinksForCapture(
  admin: SupabaseClient,
  params: { venueId: string; staffId: string | null; guestId: string; complianceTypeId: string; recordId: string },
): Promise<void> {
  try {
    const { data: links } = await admin
      .from('compliance_form_links')
      .select('id')
      .eq('venue_id', params.venueId)
      .eq('guest_id', params.guestId)
      .eq('compliance_type_id', params.complianceTypeId)
      .eq('status', 'pending');
    const ids = ((links ?? []) as Array<{ id: string }>).map((l) => l.id);
    if (ids.length === 0) return;

    // Only audit the links this call actually consumed: a concurrent capture/submit may
    // have flipped some out of 'pending' between the select and here, so re-read the
    // updated rows rather than trusting the pre-update id list.
    const { data: updated } = await admin
      .from('compliance_form_links')
      .update({ status: 'consumed', consumed_record_id: params.recordId, consumed_at: new Date().toISOString() })
      .in('id', ids)
      .eq('status', 'pending')
      .select('id');
    const consumedIds = ((updated ?? []) as Array<{ id: string }>).map((l) => l.id);

    for (const id of consumedIds) {
      await writeComplianceAuditEvent(admin, {
        venueId: params.venueId,
        eventType: 'link.consumed',
        actorType: 'staff',
        actorStaffId: params.staffId,
        guestId: params.guestId,
        complianceFormLinkId: id,
        complianceTypeId: params.complianceTypeId,
        metadata: { via: 'in_venue_capture', record_id: params.recordId },
      });
    }
  } catch (e) {
    console.error('[consumePendingLinksForCapture] failed:', e instanceof Error ? e.message : e);
  }
}

/**
 * Outstanding (pending, unexpired) form links for a booking, as {name, url} — for
 * the guest-facing confirmation/manage surfaces (Phase 1, G2). Defensive: returns
 * [] on any error (e.g. feature/table absent) so it never breaks the manage page.
 */
export async function loadOutstandingBookingFormLinks(
  admin: SupabaseClient,
  venueId: string,
  bookingId: string,
): Promise<Array<{ name: string; url: string }>> {
  try {
    const { data, error } = await admin
      .from('compliance_form_links')
      .select('code, compliance_types!inner(name)')
      .eq('venue_id', venueId)
      .eq('booking_id', bookingId)
      .eq('status', 'pending')
      .gt('expires_at', new Date().toISOString());
    if (error || !data) return [];
    return data.map((row) => {
      const r = row as { code: string; compliance_types: { name?: string } | { name?: string }[] | null };
      const t = Array.isArray(r.compliance_types) ? r.compliance_types[0] : r.compliance_types;
      return { name: t?.name ?? 'Form', url: complianceFormPublicUrl(r.code) };
    });
  } catch (err) {
    console.error('[loadOutstandingBookingFormLinks] failed:', err instanceof Error ? err.message : err);
    return [];
  }
}

export async function listFormLinks(
  admin: SupabaseClient,
  venueId: string,
  filters: { guestId?: string | null; status?: string | null },
): Promise<Record<string, unknown>[]> {
  let query = admin
    .from('compliance_form_links')
    .select(
      'id, code, guest_id, compliance_type_id, booking_id, status, sent_via, sent_at, expires_at, consumed_at, created_at, reminder_count, last_reminded_at, compliance_types!inner(name)',
    )
    .eq('venue_id', venueId)
    .order('created_at', { ascending: false });
  if (filters.guestId) query = query.eq('guest_id', filters.guestId);
  if (filters.status) query = query.eq('status', filters.status);
  const { data, error } = await query;
  if (error) {
    console.error('[listFormLinks] failed:', error.message);
    return [];
  }
  return (data ?? []) as Record<string, unknown>[];
}
