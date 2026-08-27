import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { z } from 'zod';
import {
  deleteUserDevices,
  getCallerAccessToken,
  signOutCaller,
} from '@/lib/auth/caller-auth';

const schema = z.object({
  scope: z.enum(['local', 'global']).optional(),
});

/**
 * POST /api/v1/auth/logout - the documented mobile logout. Until P0-12 this
 * called signOut on the request client, which reads the session from STORAGE:
 * for the Bearer callers this route exists for, it revoked nothing and
 * returned ok. Revocation now happens server-side against the caller's token.
 */
export async function POST(request: NextRequest) {
  const supabase = await createRouteHandlerClient(request);
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const accessToken = await getCallerAccessToken(request, supabase);
  if (!accessToken) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

  const scope = parsed.data.scope ?? 'local';
  const { error } = await signOutCaller(accessToken, scope);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (scope === 'global') {
    // Every session is gone, so every push registration goes with them.
    await deleteUserDevices(user.id);
  }
  return NextResponse.json({ ok: true });
}
