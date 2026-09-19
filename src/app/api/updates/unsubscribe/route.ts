import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { verifyBroadcastUnsubscribeSignature } from '@/lib/platform/broadcast-unsubscribe';

export const dynamic = 'force-dynamic';

/**
 * POST /api/updates/unsubscribe?r=<recipient id>&sig=<signature>
 *
 * Opts an account holder out of ResNeo product news (Contact Users emails). Two callers:
 *  - mail apps, through the RFC 8058 `List-Unsubscribe-Post: List-Unsubscribe=One-Click` header:
 *    answered with a plain 200;
 *  - the confirm page's form (`/updates/unsubscribe`), which may also post `action=resubscribe`:
 *    redirected back to that page with the outcome.
 *
 * GET does nothing on purpose: link scanners open every URL in an email, and must not unsubscribe
 * anyone by doing so.
 */
export async function POST(request: NextRequest) {
  const r = request.nextUrl.searchParams.get('r') ?? '';
  const sig = request.nextUrl.searchParams.get('sig') ?? '';

  const contentType = request.headers.get('content-type') ?? '';
  const form = contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')
    ? await request.formData().catch(() => null)
    : null;
  const oneClick = form?.get('List-Unsubscribe') === 'One-Click';
  const resubscribe = !oneClick && form?.get('action') === 'resubscribe';

  const pageUrl = (outcome: string) => {
    const url = new URL('/updates/unsubscribe', request.nextUrl.origin);
    url.searchParams.set('r', r);
    url.searchParams.set('sig', sig);
    url.searchParams.set('done', outcome);
    return url;
  };

  if (!verifyBroadcastUnsubscribeSignature(r, sig)) {
    return oneClick
      ? new NextResponse('Invalid unsubscribe link', { status: 400 })
      : NextResponse.redirect(new URL('/updates/unsubscribe?invalid=1', request.nextUrl.origin), 303);
  }

  const admin = getSupabaseAdminClient();
  const { data: recipient, error: rErr } = await admin
    .from('platform_broadcast_recipients')
    .select('email, broadcast_id')
    .eq('id', r)
    .maybeSingle();
  if (rErr || !recipient) {
    if (rErr) console.error('[updates/unsubscribe] recipient lookup:', rErr.message);
    return oneClick
      ? new NextResponse('Unsubscribe link not found', { status: 404 })
      : NextResponse.redirect(new URL('/updates/unsubscribe?invalid=1', request.nextUrl.origin), 303);
  }

  const email = (recipient as { email: string }).email.trim().toLowerCase();
  const { error } = resubscribe
    ? await admin.from('platform_email_opt_outs').delete().eq('email', email)
    : await admin
        .from('platform_email_opt_outs')
        .upsert(
          { email, broadcast_id: (recipient as { broadcast_id: string }).broadcast_id },
          { onConflict: 'email', ignoreDuplicates: true },
        );
  if (error) {
    console.error('[updates/unsubscribe]', error.message);
    return oneClick
      ? new NextResponse('Could not update your preference', { status: 500 })
      : NextResponse.redirect(pageUrl('error'), 303);
  }

  if (oneClick) {
    return new NextResponse('You have been unsubscribed from ResNeo product news.', {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  return NextResponse.redirect(pageUrl(resubscribe ? 'resubscribed' : 'unsubscribed'), 303);
}
