import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { isPlatformSuperuser } from '@/lib/platform-auth';
import { addSalesCode } from '@/lib/sales/admin';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || !isPlatformSuperuser(user)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { id } = await params;
    const admin = getSupabaseAdminClient();

    const { data: sp } = await admin
      .from('salespeople')
      .select('name, email')
      .eq('id', id)
      .is('revoked_at', null)
      .maybeSingle();
    if (!sp) {
      return NextResponse.json({ error: 'Salesperson not found' }, { status: 404 });
    }

    const code = await addSalesCode(admin, id, (sp.name as string) || (sp.email as string));
    return NextResponse.json({ ok: true, code });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Unexpected error';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
