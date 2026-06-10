import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';

const bodySchema = z.object({
  announcement_id: z.string().uuid(),
});

/**
 * POST /api/announcements/dismiss
 * Any authenticated user dismisses a platform announcement for themselves.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const admin = getSupabaseAdminClient();
  const { error } = await admin.from('platform_announcement_dismissals').upsert(
    {
      announcement_id: parsed.data.announcement_id,
      user_id: user.id,
    },
    { onConflict: 'announcement_id,user_id', ignoreDuplicates: true },
  );

  if (error) {
    console.error('[announcements/dismiss]', error.message, {
      announcementId: parsed.data.announcement_id,
      userId: user.id,
    });
    return NextResponse.json({ error: 'Failed to dismiss' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
