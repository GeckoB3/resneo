import { NextRequest, NextResponse } from 'next/server';
import { createVenueRouteClient } from '@/lib/supabase/venue-route-client';
import { getCallerAccessToken, updateAuthUserAsCaller } from '@/lib/auth/caller-auth';
import { z } from 'zod';

const schema = z.object({
  new_password: z.string().min(8, 'Password must be at least 8 characters'),
});

/** POST /api/venue/staff/change-password - change the currently logged-in user's password. */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createVenueRouteClient(request);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });

    const body = await request.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? 'Invalid request' },
        { status: 400 },
      );
    }

    // Through the caller's own token, not `supabase.auth.updateUser` on the route
    // client: that reads its session from cookie storage, so a Bearer (mobile)
    // request passed the `getUser` check above and then failed with "Auth session
    // missing", and the password never changed (R32). GoTrue shallow-merges `data`
    // into user_metadata, so the old metadata spread is not needed.
    const accessToken = await getCallerAccessToken(request, supabase);
    if (!accessToken) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
    const { error: updateErr } = await updateAuthUserAsCaller(accessToken, {
      password: parsed.data.new_password,
      data: { has_set_password: true },
    });

    if (updateErr) {
      console.error('Password update failed:', updateErr);
      if (updateErr.code === 'same_password' || updateErr.message?.includes('same_password')) {
        return NextResponse.json({ error: 'New password must be different from the current one' }, { status: 400 });
      }
      return NextResponse.json({ error: updateErr.message ?? 'Password update failed' }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('POST /api/venue/staff/change-password failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
