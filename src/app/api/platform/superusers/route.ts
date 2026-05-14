import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { isPlatformSuperuser } from '@/lib/platform-auth';
import { getStaffAuthBaseUrl } from '@/lib/staff-invite-redirect';
import {
  createPlatformSuperuserWithMagicLink,
  createPlatformSuperuserWithPassword,
  listActivePlatformSuperusers,
} from '@/lib/platform/superuser-admin';

const createBodySchema = z
  .object({
    email: z.string().email(),
    method: z.enum(['magic_link', 'password']),
    password: z.string().min(8).max(200).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.method === 'password' && (!data.password || data.password.length < 8)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Password is required (min 8 characters) for the password method.',
        path: ['password'],
      });
    }
    if (data.method === 'magic_link' && data.password !== undefined && data.password.length > 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'Do not send a password when using magic link.',
        path: ['password'],
      });
    }
  });

function errorStatus(err: unknown): number {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const s = (err as { status?: unknown }).status;
    if (typeof s === 'number' && s >= 400 && s < 600) return s;
  }
  return 500;
}

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || !isPlatformSuperuser(user)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const admin = getSupabaseAdminClient();
    const users = await listActivePlatformSuperusers(admin, { sessionSuperuserUserId: user.id });
    return NextResponse.json({ users });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unexpected error';
    console.error('[api/platform/superusers] GET:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || !isPlatformSuperuser(user)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const json = await request.json().catch(() => null);
    const parsed = createBodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();
    const baseUrl = getStaffAuthBaseUrl(request);
    const body = parsed.data;
    const email = body.email.trim().toLowerCase();

    if (body.method === 'password') {
      const { user_id } = await createPlatformSuperuserWithPassword({
        admin,
        email,
        password: body.password!,
        createdBy: user.id,
      });
      return NextResponse.json({ ok: true, user_id, method: 'password' as const });
    }

    const { user_id, channel } = await createPlatformSuperuserWithMagicLink({
      admin,
      email,
      baseUrl,
      createdBy: user.id,
    });
    return NextResponse.json({ ok: true, user_id, method: 'magic_link' as const, channel });
  } catch (e) {
    const status = errorStatus(e);
    const msg = e instanceof Error ? e.message : 'Unexpected error';
    if (status === 500) {
      console.error('[api/platform/superusers] POST:', msg);
    }
    return NextResponse.json({ error: msg }, { status });
  }
}
