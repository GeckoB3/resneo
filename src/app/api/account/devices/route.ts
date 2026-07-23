import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { z } from 'zod';

const DEVICE_SELECT =
  'id, platform, push_token, device_name, app_version, os_version, last_seen_at, created_at';

const deviceSchema = z.object({
  platform: z.enum(['ios', 'android', 'web']),
  push_token: z.string().max(512).nullable().optional(),
  device_name: z.string().max(200).nullable().optional(),
  app_version: z.string().max(80).nullable().optional(),
  os_version: z.string().max(80).nullable().optional(),
});

export async function GET(request: Request) {
  try {
    const supabase = await createRouteHandlerClient(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const { data, error } = await supabase
      .from('user_devices')
      .select(DEVICE_SELECT)
      .eq('user_id', user.id)
      .order('last_seen_at', { ascending: false });

    if (error) {
      console.error('[account/devices GET]', error.message);
      return NextResponse.json({ error: 'Failed to load devices' }, { status: 500 });
    }
    return NextResponse.json({ devices: data ?? [] });
  } catch (err) {
    console.error('[account/devices GET]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createRouteHandlerClient(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const parsed = deviceSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const pushToken = parsed.data.push_token?.trim() || null;
    const attributes = {
      ...parsed.data,
      push_token: pushToken,
      last_seen_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('user_devices')
      .insert({ user_id: user.id, ...attributes })
      .select(DEVICE_SELECT)
      .single();

    if (!error) return NextResponse.json({ device: data }, { status: 201 });

    // Re-registering a device the user already has. `user_devices_user_push_unique`
    // is a *partial* index (WHERE push_token IS NOT NULL), which `.upsert({ onConflict })`
    // cannot target — PostgREST sends column names only, never the index predicate, so
    // Postgres would raise 42P10. Refresh the existing row instead.
    if (error.code === '23505' && pushToken) {
      const { data: refreshed, error: refreshError } = await supabase
        .from('user_devices')
        .update(attributes)
        .eq('user_id', user.id)
        .eq('push_token', pushToken)
        .select(DEVICE_SELECT)
        .single();

      if (!refreshError) return NextResponse.json({ device: refreshed });

      console.error('[account/devices POST] refresh failed', refreshError.message);
      return NextResponse.json({ error: 'Failed to register device' }, { status: 500 });
    }

    console.error('[account/devices POST]', error.message);
    return NextResponse.json({ error: 'Failed to register device' }, { status: 500 });
  } catch (err) {
    console.error('[account/devices POST]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
