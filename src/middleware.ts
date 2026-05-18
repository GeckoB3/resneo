import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { isPlatformRoleInJwt } from '@/lib/platform-auth';
import {
  SIGNUP_PENDING_BUSINESS_TYPE_KEY,
  SIGNUP_PENDING_PLAN_KEY,
  isSignupPaymentReady,
} from '@/lib/signup-pending-selection';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { SUPPORT_SESSION_COOKIE_NAME } from '@/lib/support-session-constants';
import {
  fetchActiveSupportSession,
  logSupportApiMutationFromMiddleware,
  parseSupportSessionCookieValue,
} from '@/lib/support-session-core';
import { resolvePostLoginDestination, withSetPasswordGateIfNeeded } from '@/lib/post-login-destination';
import { sanitizeAuthNextPath } from '@/lib/safe-auth-redirect';
import { areVenueSubscriptionMutationsBlocked } from '@/lib/billing/subscription-entitlement';

async function loadSupportSessionRow(request: NextRequest, userId: string) {
  const raw = request.cookies.get(SUPPORT_SESSION_COOKIE_NAME)?.value;
  const sid = parseSupportSessionCookieValue(raw);
  if (!sid) return null;
  return fetchActiveSupportSession(getSupabaseAdminClient(), sid, userId);
}

/** POST-only previews that do not persist venue state and should not be mutation-audited. */
function isNonPersistingVenuePath(p: string): boolean {
  if (p === '/api/venue/communication-preview') return true;
  if (p === '/api/venue/appointments-plan/preview') return true;
  return false;
}

/** Public embed iframe: allow framing on any parent origin (overrides any stray X-Frame-Options). */
function embedFrameHeadersResponse(request: NextRequest): NextResponse {
  const response = NextResponse.next({ request });
  response.headers.delete('X-Frame-Options');
  response.headers.set('Content-Security-Policy', 'frame-ancestors *');
  return response;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/embed')) {
    return embedFrameHeadersResponse(request);
  }

  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabasePublishableKey) {
    return response;
  }

  const supabase = createServerClient(
    supabaseUrl,
    supabasePublishableKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session; required so server and client stay in sync
  const { data: { user } } = await supabase.auth.getUser();

  const isDashboard = pathname.startsWith('/dashboard');
  const isAccount = pathname.startsWith('/account');
  const isChooseDestination = pathname.startsWith('/auth/choose-destination');
  const isPlatformUI = pathname.startsWith('/super');
  const isPlatformAPI = pathname.startsWith('/api/platform');
  const signupPlan = request.nextUrl.searchParams.get('plan');

  if (pathname === '/signup/business-type' && (signupPlan === 'restaurant' || signupPlan === 'founding')) {
    const url = request.nextUrl.clone();
    url.pathname = '/signup/plan';
    url.searchParams.set('plan', signupPlan);
    return NextResponse.redirect(url);
  }

  if (
    user &&
    (pathname === '/signup' || pathname === '/signup/business-type' || pathname === '/signup/plan')
  ) {
    const meta = user.user_metadata as Record<string, unknown> | undefined;
    const pendingPlan = meta?.[SIGNUP_PENDING_PLAN_KEY];
    const pendingBusinessType = meta?.[SIGNUP_PENDING_BUSINESS_TYPE_KEY];
    if (
      isSignupPaymentReady(
        typeof pendingPlan === 'string' ? pendingPlan : null,
        typeof pendingBusinessType === 'string' ? pendingBusinessType : null,
      )
    ) {
      return NextResponse.redirect(new URL('/signup/payment', request.url));
    }
  }

  // Unauthenticated: protect /dashboard, /account, /super, and post-login chooser
  if (!user && (isDashboard || isAccount || isPlatformUI || isChooseDestination)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirectTo', pathname);
    return NextResponse.redirect(url);
  }

  const jwtSuperuser =
    !!user &&
    isPlatformRoleInJwt(user.app_metadata as Record<string, unknown> | undefined, user.email);

  if (user && jwtSuperuser && (pathname.startsWith('/dashboard') || pathname.startsWith('/onboarding'))) {
    const session = await loadSupportSessionRow(request, user.id);
    if (!session) {
      return NextResponse.redirect(new URL('/super', request.url));
    }
  }

  /** Block mutating venue APIs when billing is past due or subscription access has ended (billing routes exempt). */
  const method = request.method.toUpperCase();
  const isVenueMutating =
    user &&
    pathname.startsWith('/api/venue/') &&
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  function isVenueBillingExemptVenuePath(p: string): boolean {
    if (p === '/api/venue/change-plan') return true;
    if (p.startsWith('/api/venue/light-plan')) return true;
    if (p.startsWith('/api/venue/stripe-connect')) return true;
    if (p.startsWith('/api/venue/staff/me')) return true;
    if (p === '/api/venue/staff/change-password') return true;
    if (p.startsWith('/api/venue/support')) return true;
    return false;
  }

  if (isVenueMutating) {
    const supportSession = jwtSuperuser ? await loadSupportSessionRow(request, user.id) : null;

    if (!isVenueBillingExemptVenuePath(pathname)) {
      let vid: string | undefined = supportSession?.venue_id;
      const email = (user?.email ?? '').trim();
      if (!vid) {
        if (!email) {
          return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
        }
        const { data: staffRows } = await supabase
          .from('staff')
          .select('venue_id')
          .ilike('email', email.toLowerCase())
          .limit(1);
        vid = staffRows?.[0]?.venue_id as string | undefined;
      }
      if (vid) {
        const { data: venueRow } = await supabase
          .from('venues')
          .select('plan_status, billing_access_source, subscription_current_period_end')
          .eq('id', vid)
          .maybeSingle();
        const row = venueRow as {
          plan_status?: string | null;
          billing_access_source?: string | null;
          subscription_current_period_end?: string | null;
        } | null;
        if (
          row &&
          areVenueSubscriptionMutationsBlocked({
            plan_status: row.plan_status,
            billing_access_source: row.billing_access_source,
            subscription_current_period_end: row.subscription_current_period_end,
          })
        ) {
          const ps = (row.plan_status ?? '').toLowerCase().trim();
          const isPastDue = ps === 'past_due';
          return NextResponse.json(
            {
              error: isPastDue
                ? 'Billing is past due. Add or update your payment method under Settings → Plan to continue editing.'
                : 'Your subscription has ended. Resubscribe under Settings → Plan to continue editing.',
              code: isPastDue ? 'VENUE_PAST_DUE' : 'VENUE_SUBSCRIPTION_EXPIRED',
            },
            { status: 403 },
          );
        }
      }
    }

    if (supportSession && !isNonPersistingVenuePath(pathname)) {
      await logSupportApiMutationFromMiddleware({
        session: supportSession,
        method,
        pathname,
      });
    }
  }

  // Platform routes: require superuser role + email allowlist
  if ((isPlatformUI || isPlatformAPI) && user) {
    const isSuperuser = isPlatformRoleInJwt(
      user.app_metadata as Record<string, unknown> | undefined,
      user.email,
    );
    if (!isSuperuser) {
      if (isPlatformAPI) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }

  // Logged-in user on /login: redirect to the right surface
  if (user && pathname === '/login') {
    const explicit = request.nextUrl.searchParams.get('redirectTo');
    if (explicit) {
      const safe = sanitizeAuthNextPath(explicit);
      return NextResponse.redirect(new URL(safe, request.url));
    }
    if (jwtSuperuser) {
      const sess = await loadSupportSessionRow(request, user.id);
      return NextResponse.redirect(new URL(sess ? '/dashboard' : '/super', request.url));
    }
    const admin = getSupabaseAdminClient();
    const meta = user.user_metadata as Record<string, unknown> | undefined;
    const needsSetPassword = meta?.has_set_password === false;
    let dest = await resolvePostLoginDestination({
      admin,
      userId: user.id,
      userEmail: user.email ?? '',
      rawNext: null,
      isPlatformSuperuser: false,
      needsSetPassword,
    });
    dest = withSetPasswordGateIfNeeded(dest, needsSetPassword);
    return NextResponse.redirect(new URL(dest, request.url));
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/cron|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
