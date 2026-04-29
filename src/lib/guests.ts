/**
 * Guest identity matching: find or create guest by email/phone per venue.
 * Order: email match (normalised), then phone match (E.164), else create new.
 * Optional silent auth signup links `guests.user_id` for public online bookings.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'crypto';
import { normalizeToE164, normalizeToE164Lenient } from '@/lib/phone/e164';
import { ensureAuthUserForEmail } from '@/lib/auth/ensure-auth-user-for-email';
import {
  isAccountLinkedPublicMode,
  mergeVenueAuthoritativeField,
} from '@/lib/guests/guest-matching-rules';

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** E.164 for storage and matching; strict first, then lenient for legacy rows. */
function normaliseGuestPhone(phone: string): string | null {
  const t = phone.trim();
  if (!t) return null;
  return normalizeToE164(t, 'GB') ?? normalizeToE164Lenient(t, 'GB');
}

function computeGlobalGuestHash(email: string | null, phone: string | null): string | null {
  if (!email && !phone) return null;
  const base = `${email ?? ''}|${phone ?? ''}`;
  return createHash('sha256').update(base).digest('hex');
}

export interface GuestInput {
  name: string | null;
  email: string | null;
  phone: string | null;
}

export interface FindOrCreateGuestOptions {
  /**
   * When true with a normalised email, ensure `auth.users` exists and set `guests.user_id`.
   * Use only for public online/widget/booking_page flows — not staff/imports.
   */
  silentAuthSignup?: boolean;
}

export interface GuestRecord {
  id: string;
  venue_id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  visit_count: number;
  user_id?: string | null;
}

async function resolveAuthUserIdForGuest(
  admin: SupabaseClient,
  email: string,
  name: string | null,
  silentAuthSignup: boolean,
): Promise<string | null> {
  if (!silentAuthSignup) return null;
  try {
    return await ensureAuthUserForEmail(admin, email, name);
  } catch (err) {
    console.error('[findOrCreateGuest] silentAuthSignup failed; continuing without user_id', {
      message: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Find or create a guest for the venue. Match by email first, then phone, else insert.
 * visit_count is NOT incremented here - it's incremented when status changes to Seated.
 *
 * When `silentAuthSignup` is true and an email is present (public account-linked booking),
 * phone-only matching is skipped so a new email at the same venue does not attach to an unrelated phone record.
 */
export async function findOrCreateGuest(
  supabase: SupabaseClient,
  venueId: string,
  input: GuestInput,
  options?: FindOrCreateGuestOptions,
): Promise<{ guest: GuestRecord; created: boolean }> {
  const silentAuthSignup = options?.silentAuthSignup === true;
  const email = input.email ? normaliseEmail(input.email) : null;
  const phone = input.phone ? normaliseGuestPhone(input.phone) : null;
  const name = input.name?.trim() || null;

  const accountLinkedPublic = isAccountLinkedPublicMode(silentAuthSignup, email);

  let authUserId: string | null = null;
  if (email && silentAuthSignup) {
    authUserId = await resolveAuthUserIdForGuest(supabase, email, name, true);
  }

  if (email) {
    const { data: byEmail } = await supabase
      .from('guests')
      .select('id, venue_id, name, email, phone, visit_count, user_id')
      .eq('venue_id', venueId)
      .eq('email', email)
      .maybeSingle();

    if (byEmail) {
      const nextName = mergeVenueAuthoritativeField(byEmail.name, name);
      const nextPhone = mergeVenueAuthoritativeField(byEmail.phone, phone);
      let nextUserId = byEmail.user_id as string | null;
      if (authUserId && !nextUserId) {
        nextUserId = authUserId;
      } else if (authUserId && nextUserId && nextUserId !== authUserId) {
        console.warn('[findOrCreateGuest] guest already linked to different auth user; keeping existing', {
          guestId: byEmail.id,
          venueId,
        });
      }

      const { error: updErr } = await supabase
        .from('guests')
        .update({
          name: nextName,
          phone: nextPhone,
          user_id: nextUserId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', byEmail.id);

      if (!updErr) {
        return {
          guest: {
            ...byEmail,
            name: nextName,
            phone: nextPhone,
            user_id: nextUserId,
          },
          created: false,
        };
      }
    }
  }

  if (!accountLinkedPublic && phone) {
    const { data: byPhone } = await supabase
      .from('guests')
      .select('id, venue_id, name, email, phone, visit_count, user_id')
      .eq('venue_id', venueId)
      .eq('phone', phone)
      .maybeSingle();

    if (byPhone) {
      const nextName = mergeVenueAuthoritativeField(byPhone.name, name);
      const nextEmail = mergeVenueAuthoritativeField(byPhone.email, email);
      let nextUserId = byPhone.user_id as string | null;
      if (email && silentAuthSignup && authUserId) {
        if (!nextUserId) {
          nextUserId = authUserId;
        }
      }

      const { error: updErr } = await supabase
        .from('guests')
        .update({
          name: nextName,
          email: nextEmail,
          user_id: nextUserId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', byPhone.id);

      if (!updErr) {
        return {
          guest: {
            ...byPhone,
            name: nextName,
            email: nextEmail,
            user_id: nextUserId,
          },
          created: false,
        };
      }
    }
  }

  const insertUserId = email && silentAuthSignup ? authUserId : null;

  const { data: inserted, error: insertErr } = await supabase
    .from('guests')
    .insert({
      venue_id: venueId,
      name,
      email: email || null,
      phone: phone || null,
      user_id: insertUserId ?? null,
      global_guest_hash: computeGlobalGuestHash(email, phone),
      visit_count: 0,
      source: silentAuthSignup ? 'self_booked' : null,
    })
    .select('id, venue_id, name, email, phone, visit_count, user_id')
    .single();

  if (insertErr) throw insertErr;
  return { guest: inserted as GuestRecord, created: true };
}
