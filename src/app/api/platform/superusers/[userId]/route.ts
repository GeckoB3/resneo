import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { isPlatformSuperuser } from '@/lib/platform-auth';
import { revokePlatformSuperuser } from '@/lib/platform/superuser-admin';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function errorStatus(err: unknown): number {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const s = (err as { status?: unknown }).status;
    if (typeof s === 'number' && s >= 400 && s < 600) return s;
  }
  return 500;
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const { userId: targetUserId } = await params;
    if (!targetUserId || !UUID_RE.test(targetUserId)) {
      return NextResponse.json({ error: 'Invalid user id' }, { status: 400 });
    }

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || !isPlatformSuperuser(user)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const admin = getSupabaseAdminClient();
    await revokePlatformSuperuser({ admin, targetUserId, actorUserId: user.id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    const status = errorStatus(e);
    const msg = e instanceof Error ? e.message : 'Unexpected error';
    if (status === 500) {
      console.error('[api/platform/superusers/[userId]] DELETE:', msg);
    }
    return NextResponse.json({ error: msg }, { status });
  }
}
