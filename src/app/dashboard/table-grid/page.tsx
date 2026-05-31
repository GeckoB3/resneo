import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { getDashboardStaff } from '@/lib/venue-auth';
import { TableGridView } from './TableGridView';
import { ToastProvider } from '@/components/ui/Toast';
import { PageFrame } from '@/components/ui/dashboard/PageFrame';
import type { BookingModel } from '@/types/booking-models';
import { normalizeEnabledModels } from '@/lib/booking/enabled-models';

export default async function TableGridPage() {
  const supabase = await createClient();

  const staff = await getDashboardStaff(supabase);
  if (!staff.venue_id) redirect('/dashboard');

  const { data: venue } = await staff.db
    .from('venues')
    .select('table_management_enabled, currency, booking_model, enabled_models')
    .eq('id', staff.venue_id)
    .single();

  if (!venue?.table_management_enabled) redirect('/dashboard/day-sheet');

  const currency = ((venue as { currency?: string }).currency as string) ?? 'GBP';
  const bookingModel = ((venue as { booking_model?: string }).booking_model as BookingModel) ?? 'table_reservation';
  const enabledModels = normalizeEnabledModels(
    (venue as { enabled_models?: unknown }).enabled_models,
    bookingModel,
  );

  return (
    <ToastProvider>
      <PageFrame
        maxWidthClass="max-w-none"
        className="flex min-h-full flex-col px-1.5 py-2 pb-28 sm:px-2.5 sm:py-3 sm:pb-4 lg:px-3 lg:py-3 lg:pb-5"
      >
        <TableGridView
          venueId={staff.venue_id}
          currency={currency}
          bookingModel={bookingModel}
          enabledModels={enabledModels}
        />
      </PageFrame>
    </ToastProvider>
  );
}
