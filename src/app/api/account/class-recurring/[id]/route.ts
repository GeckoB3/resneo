import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';

const patchSchema = z.object({
  status: z.enum(['active', 'paused']).optional(),
  clear_error: z.boolean().optional(),
});

async function loadOwned(
  userId: string,
  id: string,
): Promise<{ ok: true; row: { id: string } } | { ok: false; status: number; error: string }> {
  const admin = getSupabaseAdminClient();
  const { data, error } = await admin
    .from('class_recurring_reservations')
    .select('id, user_id')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    return { ok: false, status: 500, error: 'Failed to load reservation' };
  }
  if (!data) return { ok: false, status: 404, error: 'Reservation not found' };
  const row = data as { id: string; user_id: string };
  if (row.user_id !== userId) return { ok: false, status: 403, error: 'Forbidden' };
  return { ok: true, row };
}

/** PATCH /api/account/class-recurring/[id] — change status or clear the last_error message. */
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createRouteHandlerClient(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const { id } = await ctx.params;
    const owned = await loadOwned(user.id, id);
    if (!owned.ok) return NextResponse.json({ error: owned.error }, { status: owned.status });

    const json = await request.json().catch(() => ({}));
    const parsed = patchSchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (parsed.data.status) update.status = parsed.data.status;
    if (parsed.data.clear_error) update.last_error = null;

    const admin = getSupabaseAdminClient();
    const { error: upErr } = await admin
      .from('class_recurring_reservations')
      .update(update)
      .eq('id', id);

    if (upErr) {
      console.error('[account/class-recurring/[id]] PATCH', upErr);
      return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[account/class-recurring/[id]] PATCH', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}

/** DELETE /api/account/class-recurring/[id] — guest deletes one of their own rules. */
export async function DELETE(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createRouteHandlerClient(request);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthenticated' }, { status: 401 });

    const { id } = await ctx.params;
    const owned = await loadOwned(user.id, id);
    if (!owned.ok) return NextResponse.json({ error: owned.error }, { status: owned.status });

    const admin = getSupabaseAdminClient();
    const { error: delErr } = await admin
      .from('class_recurring_reservations')
      .delete()
      .eq('id', id);

    if (delErr) {
      console.error('[account/class-recurring/[id]] DELETE', delErr);
      return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[account/class-recurring/[id]] DELETE', e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
