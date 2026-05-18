import type { StaffRebookBootstrapPayloadV1, StaffRebookGuestPrefill } from '@/lib/booking/staff-rebook-bootstrap';
import { defaultStaffBookingSurfaceTab } from '@/lib/booking/staff-booking-modal-options';
import type { BookingModel } from '@/types/booking-models';
import type { GuestListRow } from '@/types/contacts';
import { formatGuestDisplayName } from '@/lib/guests/name';

export function guestListRowToPrefill(row: GuestListRow): StaffRebookGuestPrefill {
  return {
    firstName: row.first_name ?? undefined,
    lastName: row.last_name ?? undefined,
    email: row.email,
    phone: row.phone,
  };
}

export function buildToolbarBookBootstrap(
  row: GuestListRow,
  bookingModel: BookingModel,
  enabledModels: BookingModel[],
): StaffRebookBootstrapPayloadV1 {
  return {
    v: 1,
    surface: defaultStaffBookingSurfaceTab(bookingModel, enabledModels),
    guest: guestListRowToPrefill(row),
  };
}

export function guestSearchResultLabel(row: GuestListRow): string {
  if (row.identifiability_tier === 'anonymous') return 'Anonymous';
  return formatGuestDisplayName(row.first_name, row.last_name);
}

export function guestSearchResultSubtitle(row: GuestListRow): string {
  const email = row.email?.trim();
  const phone = row.phone?.trim();
  if (email && phone) return `${email} · ${phone}`;
  return email ?? phone ?? 'No contact details on file';
}
