import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { sendEmail } from '@/lib/emails/send-email';
import { normalizePublicBaseUrl } from '@/lib/public-base-url';

/** POST /api/account/delete-request — 30-day grace soft delete marker on user_profiles. */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createRouteHandlerClient(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const { data, error } = await supabase.rpc('request_account_deletion');
    if (error) {
      console.error('[account/delete-request]', error.message);
      return NextResponse.json({ error: 'Failed to request deletion' }, { status: 500 });
    }

    const base = normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL ?? '');
    const loginForCancel = `${base}/login?redirectTo=${encodeURIComponent('/account/security')}`;
    const magicCancel =
      user.email && base
        ? `${base}/auth/magic?email=${encodeURIComponent(user.email)}&context=customer&redirect=${encodeURIComponent('/account/security')}`
        : loginForCancel;
    const magicCancelHref = magicCancel.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

    if (user.email) {
      try {
        await sendEmail({
          to: user.email,
          subject: 'Your Resneo account deletion request',
          text: [
            'We have received your Resneo account deletion request.',
            '',
            `Your account is scheduled for deletion on ${String(data).slice(0, 10)}.`,
            'Linked venue guest records have been anonymised.',
            '',
            'To cancel this deletion before the date above, sign in and use "Cancel deletion request" on Account Security:',
            magicCancel,
            '',
            'If this was not you, contact Resneo support.',
          ].join('\n'),
          html: `
            <p>We have received your Resneo account deletion request.</p>
            <p>Your account is scheduled for deletion on <strong>${String(data).slice(0, 10)}</strong>.</p>
            <p>Linked venue guest records have been anonymised.</p>
            <p><a href="${magicCancelHref}">Cancel deletion request</a> (sign in may be required).</p>
            <p>If this was not you, contact Resneo support.</p>
          `,
          disableTracking: true,
        });
      } catch (emailErr) {
        console.error(
          '[account/delete-request] confirmation email:',
          emailErr instanceof Error ? emailErr.message : emailErr,
        );
      }
    }

    const { error: signOutErr } = await supabase.auth.signOut({ scope: 'global' });
    if (signOutErr) {
      console.error('[account/delete-request] signOut global:', signOutErr.message);
    }
    return NextResponse.json({ deletion_scheduled_at: data });
  } catch (e) {
    console.error('[account/delete-request]', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
