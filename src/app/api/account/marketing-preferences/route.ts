import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { z } from 'zod';

const patchSchema = z.object({
  guest_id: z.string().uuid(),
  marketing_consent: z.boolean(),
});

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createRouteHandlerClient(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request', details: parsed.error.flatten() }, { status: 400 });
    }

    const admin = getSupabaseAdminClient();
    const { data: guest, error: loadErr } = await admin
      .from('guests')
      .select('id, user_id')
      .eq('id', parsed.data.guest_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (loadErr) {
      console.error('[account/marketing-preferences] load:', loadErr.message);
      return NextResponse.json({ error: 'Failed to load preference' }, { status: 500 });
    }
    if (!guest) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const consent = parsed.data.marketing_consent;
    const { data, error } = await admin
      .from('guests')
      .update({
        marketing_consent: consent,
        marketing_consent_at: consent ? new Date().toISOString() : null,
        marketing_opt_out: !consent,
        updated_at: new Date().toISOString(),
      })
      .eq('id', parsed.data.guest_id)
      .eq('user_id', user.id)
      .select('id, marketing_consent, marketing_consent_at, marketing_opt_out')
      .single();

    if (error) {
      console.error('[account/marketing-preferences] update:', error.message);
      return NextResponse.json({ error: 'Failed to update preference' }, { status: 500 });
    }

    return NextResponse.json({ guest: data });
  } catch (err) {
    console.error('[account/marketing-preferences]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
