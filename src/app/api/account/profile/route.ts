import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { getCallerAccessToken, updateAuthUserAsCaller } from '@/lib/auth/caller-auth';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { z } from 'zod';
import { isValidIanaTimeZone } from '@/lib/time/iana-time-zone';
import {
  mergeIncomingPreferences,
  withStaffMirror,
} from '@/lib/notifications/notification-preferences';
import { loadAccountProfile } from '@/lib/account/account-profile';

const patchSchema = z.object({
  display_name: z.union([z.string(), z.null()]).optional(),
  first_name: z.union([z.string(), z.null()]).optional(),
  last_name: z.union([z.string(), z.null()]).optional(),
  phone: z.union([z.string(), z.null()]).optional(),
  email: z.string().email().optional(),
  locale: z.string().min(2).max(20).optional(),
  // Constrained to real IANA zones (G23). Free text here meant a customer could
  // save 'GMT+1' and then be unable to load the very page that would let them
  // fix it, because every toLocaleDateString({ timeZone }) call threw.
  timezone: z
    .string()
    .min(2)
    .max(64)
    .refine(isValidIanaTimeZone, {
      message: 'Choose a timezone from the list, for example Europe/London.',
    })
    .optional(),
  default_login_destination: z.enum(['account', 'dashboard', 'ask']).nullable().optional(),
  notification_preferences: z.record(z.string(), z.unknown()).optional(),
});

function normalizeOptionalText(value: string | null | undefined, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const t = value.trim();
  if (t === '') return null;
  if (t.length > max) {
    return undefined; // signal invalid
  }
  return t;
}

export async function GET(request: Request) {
  try {
    const supabase = await createRouteHandlerClient(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorised', code: 'UNAUTHENTICATED' }, { status: 401 });

    // The same loader the portal pages call (C1), so the route and the page
    // cannot answer differently.
    // Throws on a read failure, caught below as a 500, so an empty response
    // never gets mistaken for "this customer has no profile".
    const data = await loadAccountProfile(supabase, user.id);

    // Build 1.0.7 reads notification_preferences.new_booking and its siblings
    // directly off this response, and it is in the stores. Once P0-13's R3
    // migration moves those keys into `staff`, the shipped app would read a
    // default for every one, show the user toggles that do not match reality,
    // and write those defaults back on their next save. The mirror costs a
    // dozen duplicated keys and removes that entirely (§5D.0 B7). It is a
    // no-op before R3, because the column is still flat. Retire it only when
    // telemetry shows 1.0.7 is gone.
    const profile = data
      ? { ...data, notification_preferences: withStaffMirror(data.notification_preferences) }
      : data;

    return NextResponse.json({ profile, user: { id: user.id, email: user.email } });
  } catch (e) {
    console.error('[account/profile GET]', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createRouteHandlerClient(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorised', code: 'UNAUTHENTICATED' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const d = parsed.data;
    const display_name = normalizeOptionalText(d.display_name, 200);
    const first_name = normalizeOptionalText(d.first_name, 100);
    const last_name = normalizeOptionalText(d.last_name, 100);
    const phone = normalizeOptionalText(d.phone, 32);
    if (
      (d.display_name !== undefined && display_name === undefined) ||
      (d.first_name !== undefined && first_name === undefined) ||
      (d.last_name !== undefined && last_name === undefined) ||
      (d.phone !== undefined && phone === undefined)
    ) {
      return NextResponse.json({ error: 'A text field exceeds the maximum length.' }, { status: 400 });
    }

    const nextEmail = d.email?.trim().toLowerCase();
    const currentEmail = (user.email ?? '').trim().toLowerCase();
    const wantsEmailChange = Boolean(nextEmail && nextEmail !== currentEmail);

    if (wantsEmailChange) {
      const admin = getSupabaseAdminClient();
      const { data: collides, error: rpcErr } = await admin.rpc('guest_email_collides_for_user_change', {
        p_email: nextEmail,
        p_user_id: user.id,
      });

      if (rpcErr) {
        console.error('[account/profile PATCH] collide check:', rpcErr.message);
        return NextResponse.json({ error: 'Could not validate email change' }, { status: 500 });
      }

      if (collides === true) {
        return NextResponse.json(
          {
            error:
              'That email is already in use for another customer at a venue. Choose a different email or contact support.',
          },
          { status: 409 },
        );
      }
    }

    const profileUpdate: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (display_name !== undefined) profileUpdate.display_name = display_name;
    if (first_name !== undefined) profileUpdate.first_name = first_name;
    if (last_name !== undefined) profileUpdate.last_name = last_name;
    if (phone !== undefined) profileUpdate.phone = phone;
    if (d.locale !== undefined) profileUpdate.locale = d.locale;
    if (d.timezone !== undefined) profileUpdate.timezone = d.timezone;
    if (d.default_login_destination !== undefined) profileUpdate.default_login_destination = d.default_login_destination;
    if (d.notification_preferences !== undefined) {
      // MERGED, never assigned. This route is re-exported as
      // /api/v1/me/profile, so both the customer portal and the shipped staff
      // app PATCH through it, into the same free-form jsonb column. Assigning
      // the incoming object meant a customer client that sent only its own two
      // keys erased every staff push preference on the row, and linked
      // accounts actively create users who have both.
      //
      // The merge also routes keys to their namespace by name, which is what
      // lets 1.0.7 keep PATCHing flat staff keys after R3 without an app
      // release. Re-reading the row first is a read-modify-write and so races
      // a concurrent save of the OTHER namespace; that is a fair trade against
      // today's guaranteed clobber, and P0-13's R4 half narrows this route to
      // the customer namespace so the race stops mattering.
      const { data: current } = await supabase
        .from('user_profiles')
        .select('notification_preferences')
        .eq('id', user.id)
        .maybeSingle();
      profileUpdate.notification_preferences = mergeIncomingPreferences(
        (current as { notification_preferences?: unknown } | null)?.notification_preferences,
        d.notification_preferences,
      );
    }

    const { data, error } = await supabase
      .from('user_profiles')
      .update(profileUpdate)
      .eq('id', user.id)
      .select('*')
      .maybeSingle();

    if (error) {
      console.error('[account/profile PATCH]', error.message);
      return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
    }

    let emailNotice: string | null = null;
    let email_error: string | null = null;
    if (wantsEmailChange && nextEmail) {
      // As the caller: keeps the double-confirm flow, and actually works for a
      // Bearer request, where supabase.auth.updateUser silently no-ops (P0-12).
      const accessToken = await getCallerAccessToken(request, supabase);
      const { error: authErr } = accessToken
        ? await updateAuthUserAsCaller(accessToken, { email: nextEmail })
        : { error: { message: 'Unauthorised', status: 401 } };
      if (authErr) {
        console.error('[account/profile PATCH] updateUser email:', authErr.message);
        email_error = authErr.message;
      } else {
        emailNotice =
          'Check your new inbox to confirm the email change. Venue booking records update after confirmation.';
      }
    }

    const {
      data: { user: refreshed },
    } = await supabase.auth.getUser();

    return NextResponse.json({
      profile: data,
      user: { email: refreshed?.email ?? user.email },
      notice: emailNotice,
      email_error,
    });
  } catch (e) {
    console.error('[account/profile PATCH]', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
