import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { z } from 'zod';

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
      .select('id, platform, push_token, device_name, app_version, os_version, last_seen_at, created_at')
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

    const { data, error } = await supabase
      .from('user_devices')
      .insert({
        user_id: user.id,
        ...parsed.data,
        push_token: parsed.data.push_token?.trim() || null,
        last_seen_at: new Date().toISOString(),
      })
      .select('id, platform, push_token, device_name, app_version, os_version, last_seen_at, created_at')
      .single();

    if (error) {
      console.error('[account/devices POST]', error.message);
      return NextResponse.json({ error: 'Failed to register device' }, { status: 500 });
    }
    return NextResponse.json({ device: data }, { status: 201 });
  } catch (err) {
    console.error('[account/devices POST]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
