import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export default async function TablesPage() {
  const supabase = await createClient();

  redirect('/dashboard/floor-plan');
}
