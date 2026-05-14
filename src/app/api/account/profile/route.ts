import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { z } from 'zod';

const patchSchema = z.object({
  display_name: z.union([z.string(), z.null()]).optional(),
  first_name: z.union([z.string(), z.null()]).optional(),
  last_name: z.union([z.string(), z.null()]).optional(),
  phone: z.union([z.string(), z.null()]).optional(),
  email: z.string().email().optional(),
  locale: z.string().min(2).max(20).optional(),
  timezone: z.string().min(2).max(64).optional(),
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
    if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const { data, error } = await supabase.from('user_profiles').select('*').eq('id', user.id).maybeSingle();
    if (error) {
      console.error('[account/profile GET]', error.message);
      return NextResponse.json({ error: 'Failed to load profile' }, { status: 500 });
    }
    return NextResponse.json({ profile: data, user: { id: user.id, email: user.email } });
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
    if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

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
    if (d.notification_preferences !== undefined) profileUpdate.notification_preferences = d.notification_preferences;

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
      const { error: authErr } = await supabase.auth.updateUser({ email: nextEmail });
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
