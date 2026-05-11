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
import { formatGuestDisplayName, normaliseGuestNamePart } from '@/lib/guests/name';

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
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  /** When set (public online flows), updates `guests.marketing_consent` / `marketing_consent_at`. */
  marketing_consent?: boolean;
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
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  visit_count: number;
  user_id?: string | null;
  marketing_opt_out?: boolean;
  marketing_consent?: boolean;
  marketing_consent_at?: string | null;
}

function marketingPayloadFromConsent(consented: boolean): {
  marketing_consent: boolean;
  marketing_consent_at: string | null;
} {
  return {
    marketing_consent: consented,
    marketing_consent_at: consented ? new Date().toISOString() : null,
  };
}

async function maybeInsertMarketingConsentEvent(
  supabase: SupabaseClient,
  venueId: string,
  guestId: string,
  opts: { prevOptOut: boolean; prevConsent: boolean; nextConsent: boolean; created: boolean },
): Promise<void> {
  if (!opts.created && opts.prevConsent === opts.nextConsent) return;
  const { error } = await supabase.from('guest_marketing_consent_events').insert({
    venue_id: venueId,
    guest_id: guestId,
    actor_staff_id: null,
    marketing_consent: opts.nextConsent,
    marketing_opt_out: opts.prevOptOut,
  });
  if (error) {
    console.error('[findOrCreateGuest] guest_marketing_consent_events insert failed:', error.message);
  }
}

const guestSelect =
  'id, venue_id, first_name, last_name, email, phone, visit_count, user_id, marketing_opt_out, marketing_consent, marketing_consent_at';

async function resolveAuthUserIdForGuest(
  admin: SupabaseClient,
  email: string,
  firstName: string | null,
  lastName: string | null,
  silentAuthSignup: boolean,
): Promise<string | null> {
  if (!silentAuthSignup) return null;
  const display = formatGuestDisplayName(firstName, lastName);
  try {
    return await ensureAuthUserForEmail(admin, email, display === 'Guest' ? null : display);
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
  const firstName = normaliseGuestNamePart(input.first_name);
  const lastName = normaliseGuestNamePart(input.last_name);

  const accountLinkedPublic = isAccountLinkedPublicMode(silentAuthSignup, email);

  let authUserId: string | null = null;
  if (email && silentAuthSignup) {
    authUserId = await resolveAuthUserIdForGuest(supabase, email, firstName, lastName, true);
  }

  if (email) {
    const { data: byEmail } = await supabase
      .from('guests')
      .select(guestSelect)
      .eq('venue_id', venueId)
      .eq('email', email)
      .maybeSingle();

    if (byEmail) {
      const nextFirst = mergeVenueAuthoritativeField(byEmail.first_name, firstName);
      const nextLast = mergeVenueAuthoritativeField(byEmail.last_name, lastName);
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

      const marketingPatch =
        input.marketing_consent !== undefined ? marketingPayloadFromConsent(input.marketing_consent) : null;

      const { error: updErr } = await supabase
        .from('guests')
        .update({
          first_name: nextFirst,
          last_name: nextLast,
          phone: nextPhone,
          user_id: nextUserId,
          updated_at: new Date().toISOString(),
          ...(marketingPatch ?? {}),
        })
        .eq('id', byEmail.id);

      if (!updErr) {
        if (marketingPatch) {
          await maybeInsertMarketingConsentEvent(supabase, venueId, byEmail.id, {
            prevOptOut: Boolean(byEmail.marketing_opt_out),
            prevConsent: Boolean(byEmail.marketing_consent),
            nextConsent: marketingPatch.marketing_consent,
            created: false,
          });
        }
        return {
          guest: {
            ...byEmail,
            first_name: nextFirst,
            last_name: nextLast,
            phone: nextPhone,
            user_id: nextUserId,
            ...(marketingPatch ?? {}),
          },
          created: false,
        };
      }
    }
  }

  if (!accountLinkedPublic && phone) {
    const { data: byPhone } = await supabase
      .from('guests')
      .select(guestSelect)
      .eq('venue_id', venueId)
      .eq('phone', phone)
      .maybeSingle();

    if (byPhone) {
      const nextFirst = mergeVenueAuthoritativeField(byPhone.first_name, firstName);
      const nextLast = mergeVenueAuthoritativeField(byPhone.last_name, lastName);
      const nextEmail = mergeVenueAuthoritativeField(byPhone.email, email);
      let nextUserId = byPhone.user_id as string | null;
      if (email && silentAuthSignup && authUserId) {
        if (!nextUserId) {
          nextUserId = authUserId;
        }
      }

      const marketingPatchPhone =
        input.marketing_consent !== undefined ? marketingPayloadFromConsent(input.marketing_consent) : null;

      const { error: updErr } = await supabase
        .from('guests')
        .update({
          first_name: nextFirst,
          last_name: nextLast,
          email: nextEmail,
          user_id: nextUserId,
          updated_at: new Date().toISOString(),
          ...(marketingPatchPhone ?? {}),
        })
        .eq('id', byPhone.id);

      if (!updErr) {
        if (marketingPatchPhone) {
          await maybeInsertMarketingConsentEvent(supabase, venueId, byPhone.id, {
            prevOptOut: Boolean(byPhone.marketing_opt_out),
            prevConsent: Boolean(byPhone.marketing_consent),
            nextConsent: marketingPatchPhone.marketing_consent,
            created: false,
          });
        }
        return {
          guest: {
            ...byPhone,
            first_name: nextFirst,
            last_name: nextLast,
            email: nextEmail,
            user_id: nextUserId,
            ...(marketingPatchPhone ?? {}),
          },
          created: false,
        };
      }
    }
  }

  const insertUserId = email && silentAuthSignup ? authUserId : null;

  const marketingInsert =
    input.marketing_consent !== undefined ? marketingPayloadFromConsent(input.marketing_consent) : {};

  const { data: inserted, error: insertErr } = await supabase
    .from('guests')
    .insert({
      venue_id: venueId,
      first_name: firstName,
      last_name: lastName,
      email: email || null,
      phone: phone || null,
      user_id: insertUserId ?? null,
      global_guest_hash: computeGlobalGuestHash(email, phone),
      visit_count: 0,
      source: silentAuthSignup ? 'self_booked' : null,
      ...marketingInsert,
    })
    .select(guestSelect)
    .single();

  if (insertErr) throw insertErr;
  const guestRow = inserted as GuestRecord;
  if (input.marketing_consent !== undefined) {
    await maybeInsertMarketingConsentEvent(supabase, venueId, guestRow.id, {
      prevOptOut: Boolean(guestRow.marketing_opt_out),
      prevConsent: false,
      nextConsent: input.marketing_consent,
      created: true,
    });
  }
  return { guest: guestRow, created: true };
}
