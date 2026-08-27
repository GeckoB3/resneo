import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import {
  deleteUserDevices,
  getCallerAccessToken,
  signOutCaller,
} from '@/lib/auth/caller-auth';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createRouteHandlerClient(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorised', code: 'UNAUTHENTICATED' }, { status: 401 });

    // Server-side revocation. The request-client signOut reads the session from
    // storage, so for a Bearer caller "sign out everywhere" revoked nothing and
    // reported success (P0-12, G27).
    const accessToken = await getCallerAccessToken(request, supabase);
    if (!accessToken) return NextResponse.json({ error: 'Unauthorised', code: 'UNAUTHENTICATED' }, { status: 401 });
    const { error } = await signOutCaller(accessToken, 'global');
    if (error) {
      console.error('[account/sign-out-everywhere]', error.message);
      return NextResponse.json({ error: 'Failed to sign out everywhere' }, { status: 500 });
    }

    // Push registrations die with the sessions. The app's own unregister uses an
    // in-memory id that does not survive a relaunch, so the server owns this.
    await deleteUserDevices(user.id);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[account/sign-out-everywhere]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
