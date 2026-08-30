import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { getCallerAccessToken, updateAuthUserAsCaller } from '@/lib/auth/caller-auth';
import { z } from 'zod';

const schema = z.object({
  password: z.string().min(8).max(128),
});

export async function POST(request: NextRequest) {
  const supabase = await createRouteHandlerClient(request);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorised', code: 'UNAUTHENTICATED' }, { status: 401 });

  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
  }

  // As the caller: supabase.auth.updateUser reads the session from storage and
  // silently no-ops for the Bearer requests this v1 route exists to serve (P0-12).
  const accessToken = await getCallerAccessToken(request, supabase);
  if (!accessToken) return NextResponse.json({ error: 'Unauthorised', code: 'UNAUTHENTICATED' }, { status: 401 });
  const { error } = await updateAuthUserAsCaller(accessToken, {
    password: parsed.data.password,
    data: { has_set_password: true },
  });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
