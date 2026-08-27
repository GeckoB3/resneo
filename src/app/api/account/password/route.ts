import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { getCallerAccessToken, updateAuthUserAsCaller } from '@/lib/auth/caller-auth';
import { z } from 'zod';

const schema = z.object({
  password: z.string().min(8, 'Use at least 8 characters').max(128),
});

/**
 * POST /api/account/password — set or change password for the signed-in user (guest account, staff, etc.).
 * Magic-link users can call this once they have a session to enable email + password sign-in.
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createRouteHandlerClient(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }

    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? 'Invalid request';
      return NextResponse.json({ error: msg }, { status: 400 });
    }

    // As the caller, not via supabase.auth.updateUser: that call reads the
    // session from storage, so it silently did nothing for a Bearer (mobile)
    // request. GoTrue shallow-merges `data` into user_metadata, same as the
    // SDK call it replaces (P0-12).
    const accessToken = await getCallerAccessToken(request, supabase);
    if (!accessToken) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }
    const { error } = await updateAuthUserAsCaller(accessToken, {
      password: parsed.data.password,
      data: { has_set_password: true },
    });

    if (error) {
      if (error.code === 'same_password' || error.message?.includes('same_password')) {
        return NextResponse.json(
          { error: 'New password must be different from the current one.' },
          { status: 400 },
        );
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[POST /api/account/password]', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
