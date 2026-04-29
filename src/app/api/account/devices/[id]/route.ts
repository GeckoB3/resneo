import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';

type Params = { params: Promise<{ id: string }> };

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const supabase = await createRouteHandlerClient(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const { error } = await supabase.from('user_devices').delete().eq('id', id).eq('user_id', user.id);
    if (error) {
      console.error('[account/devices DELETE]', error.message);
      return NextResponse.json({ error: 'Failed to remove device' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[account/devices DELETE]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
