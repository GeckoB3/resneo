import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createRouteHandlerClient(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const { error } = await supabase.auth.signOut({ scope: 'global' });
    if (error) {
      console.error('[account/sign-out-everywhere]', error.message);
      return NextResponse.json({ error: 'Failed to sign out everywhere' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[account/sign-out-everywhere]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
