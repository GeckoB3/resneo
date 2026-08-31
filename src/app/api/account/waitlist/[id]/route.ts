import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { cancelAccountWaitlistEntry } from '@/lib/account/account-waitlist';
import { NO_STORE_HEADERS } from '@/lib/api/error-codes';

/**
 * DELETE /api/account/waitlist/[id] - leave a waitlist (P4-4).
 *
 * **An entry that is not this account's returns 404**, the same answer as one
 * that does not exist. 403 would confirm the entry is real and belongs to
 * somebody, which is more than a stranger should learn from a guessed id.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = await createRouteHandlerClient(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: 'Unauthorised', code: 'UNAUTHENTICATED' },
        { status: 401, headers: NO_STORE_HEADERS },
      );
    }

    const result = await cancelAccountWaitlistEntry(getSupabaseAdminClient(), user.email, id);
    if (result.ok) return NextResponse.json({ ok: true }, { headers: NO_STORE_HEADERS });

    if (result.reason === 'not_cancellable') {
      return NextResponse.json(
        {
          error: 'That waitlist place can no longer be cancelled.',
          code: 'CONFLICT',
        },
        { status: 409, headers: NO_STORE_HEADERS },
      );
    }
    if (result.reason === 'error') {
      return NextResponse.json(
        { error: 'Internal error', code: 'INTERNAL_ERROR' },
        { status: 500, headers: NO_STORE_HEADERS },
      );
    }
    return NextResponse.json(
      { error: 'Not found', code: 'NOT_FOUND' },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  } catch (e) {
    console.error('[account/waitlist/[id]]', e);
    return NextResponse.json(
      { error: 'Internal error', code: 'INTERNAL_ERROR' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
