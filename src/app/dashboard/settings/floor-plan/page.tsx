import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export default async function FloorPlanEditorPage() {
  const supabase = await createClient();
  redirect('/dashboard/floor-plan');
}
