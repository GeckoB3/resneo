import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { hasPlatformSuperuserJwtRole } from '@/lib/platform-auth';
import { hasSalesAgentJwtRole } from '@/lib/sales/auth';
import { resolvePostLoginDestination, withSetPasswordGateIfNeeded } from '@/lib/post-login-destination';

/**
 * GET /api/auth/resolve-next?next=
 * Returns JSON { destination } for the authenticated session (browser cookies).
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });
    }

    const { error: claimErr } = await supabase.rpc('claim_user_account');
    if (claimErr) {
      console.warn('[resolve-next] claim_user_account:', claimErr.message);
    }

    const rawNext = request.nextUrl.searchParams.get('next');
    const meta = user.user_metadata as Record<string, unknown> | undefined;
    const needsSetPassword = meta?.has_set_password === false;
    const isSuper = hasPlatformSuperuserJwtRole(user);
    const isSales = hasSalesAgentJwtRole(user);

    const admin = getSupabaseAdminClient();
    let destination = await resolvePostLoginDestination({
      admin,
      userId: user.id,
      userEmail: user.email ?? '',
      rawNext,
      isPlatformSuperuser: isSuper,
      isSalesAgent: isSales,
      needsSetPassword,
    });

    destination = withSetPasswordGateIfNeeded(destination, needsSetPassword && !isSuper);

    if (isSuper) {
      const pathOnly = destination.split('?')[0] ?? '';
      if (pathOnly !== '/super' && !pathOnly.startsWith('/super/')) {
        destination = '/super';
      }
    }

    return NextResponse.json({ destination });
  } catch (err) {
    console.error('[resolve-next]', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
