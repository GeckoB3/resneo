import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { z } from 'zod';

const schema = z.object({
  email: z.string().email(),
});

/**
 * POST /api/v1/me/email/change — initiate auth email change.
 * Blocks when another guest record already owns the target email at any venue (UNIQUE safety).
 * Linked `guests.email` rows sync after Supabase applies the new email (DB trigger on auth.users).
 */
export async function POST(request: NextRequest) {
  const supabase = await createRouteHandlerClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.id) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  const nextEmail = parsed.data.email.trim().toLowerCase();
  if (nextEmail === (user.email ?? '').trim().toLowerCase()) {
    return NextResponse.json({ ok: true, message: 'No change' });
  }

  const admin = getSupabaseAdminClient();
  const { data: collides, error: rpcErr } = await admin.rpc('guest_email_collides_for_user_change', {
    p_email: nextEmail,
    p_user_id: user.id,
  });

  if (rpcErr) {
    console.error('[v1/me/email/change] collide check:', rpcErr.message);
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

  const { error } = await supabase.auth.updateUser({ email: nextEmail });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    message: 'Check your new inbox to confirm the email change. Venue booking records update after confirmation.',
  });
}
