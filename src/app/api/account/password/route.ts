import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
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

    const existingMeta =
      typeof user.user_metadata === 'object' && user.user_metadata !== null
        ? (user.user_metadata as Record<string, unknown>)
        : {};

    const { error } = await supabase.auth.updateUser({
      password: parsed.data.password,
      data: { ...existingMeta, has_set_password: true },
    });

    if (error) {
      if (error.message?.includes('same_password')) {
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
