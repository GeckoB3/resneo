import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { z } from 'zod';

const patchSchema = z.object({
  display_name: z.string().max(200).nullable().optional(),
  first_name: z.string().max(100).nullable().optional(),
  last_name: z.string().max(100).nullable().optional(),
  phone: z.string().max(32).nullable().optional(),
  locale: z.string().min(2).max(20).optional(),
  timezone: z.string().min(2).max(64).optional(),
  default_login_destination: z.enum(['account', 'dashboard', 'ask']).nullable().optional(),
  notification_preferences: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(request: Request) {
  try {
    const supabase = await createRouteHandlerClient(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const { data, error } = await supabase.from('user_profiles').select('*').eq('id', user.id).maybeSingle();
    if (error) {
      console.error('[account/profile GET]', error.message);
      return NextResponse.json({ error: 'Failed to load profile' }, { status: 500 });
    }
    return NextResponse.json({ profile: data, user: { id: user.id, email: user.email } });
  } catch (e) {
    console.error('[account/profile GET]', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createRouteHandlerClient(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const body = await request.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const patch = { ...parsed.data, updated_at: new Date().toISOString() };
    const { data, error } = await supabase
      .from('user_profiles')
      .update(patch)
      .eq('id', user.id)
      .select('*')
      .maybeSingle();

    if (error) {
      console.error('[account/profile PATCH]', error.message);
      return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 });
    }
    return NextResponse.json({ profile: data });
  } catch (e) {
    console.error('[account/profile PATCH]', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
