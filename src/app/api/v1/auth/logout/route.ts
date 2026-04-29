import { NextRequest, NextResponse } from 'next/server';
import { createRouteHandlerClient } from '@/lib/supabase/server';
import { z } from 'zod';

const schema = z.object({
  scope: z.enum(['local', 'global']).optional(),
});

export async function POST(request: NextRequest) {
  const supabase = await createRouteHandlerClient(request);
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
  const { error } = await supabase.auth.signOut({ scope: parsed.data.scope ?? 'local' });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
