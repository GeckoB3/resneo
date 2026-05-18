'use client';

import { useCallback, useEffect, useState, type RefObject } from 'react';
import { ContactDetailPanel } from '@/components/dashboard/contacts/ContactDetailPanel';
import { ClampedFixedDropdown } from '@/components/ui/ClampedFixedDropdown';
import { useDashboardDetailCache } from '@/components/providers/DashboardDetailCacheProvider';
import { useDashboardToolbarVenue } from '@/components/dashboard/toolbar-guest-search/DashboardToolbarVenueProvider';
import type { GuestDetailGuest, GuestDetailResponse, GuestListRow } from '@/types/contacts';

function mergeGuestDetailFromSavedGuest(prev: GuestDetailResponse, saved: GuestDetailGuest): GuestDetailResponse {
  return {
    ...prev,
    guest: {
      ...prev.guest,
      ...saved,
      tags: Array.isArray(saved.tags) ? saved.tags : prev.guest.tags,
    },
  };
}

import type { GuestHistoryRelatedBookingPayload } from '@/app/dashboard/bookings/GuestBookingsForGuestAccordion';
import { guestSearchResultLabel } from '@/components/dashboard/toolbar-guest-search/guest-search-helpers';

export function ToolbarContactDetailPopover({
  row,
  open,
  triggerRef,
  verticalAnchorRef,
  onDismiss,
  onGuestUpdated,
}: {
  row: GuestListRow;
  open: boolean;
  triggerRef: RefObject<HTMLButtonElement | null>;
  verticalAnchorRef?: RefObject<HTMLDivElement | null>;
  onDismiss: () => void;
  onGuestUpdated?: () => void;
}) {
  const venue = useDashboardToolbarVenue();
  const { peekGuestDetail, primeGuestDetail, warmGuestDetail } = useDashboardDetailCache();

  const [detail, setDetail] = useState<GuestDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editFirstName, setEditFirstName] = useState('');
  const [editLastName, setEditLastName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editSaving, setEditSaving] = useState(false);
  const [eraseLoadingId, setEraseLoadingId] = useState<string | null>(null);

  const loadDetail = useCallback(
    async (guestId: string) => {
      const cached = peekGuestDetail(guestId);
      const cacheHit = cached?.guest?.id === guestId;

      setDetailLoading(!cacheHit);
      setEditError(null);

      if (cacheHit) {
        setDetail(cached);
        setEditFirstName(cached.guest.first_name ?? '');
        setEditLastName(cached.guest.last_name ?? '');
        setEditEmail(cached.guest.email ?? '');
        setEditPhone(cached.guest.phone ?? '');
      } else {
        setDetail((prev) => (prev?.guest.id === guestId ? prev : null));
      }

      try {
        const res = await fetch(`/api/venue/guests/${guestId}?booking_history_limit=40`);
        const data = (await res.json()) as GuestDetailResponse & { error?: string };
        if (!res.ok) {
          throw new Error(typeof data.error === 'string' ? data.error : 'Failed to load contact');
        }
        primeGuestDetail(guestId, data);
        setDetail(data);
        setEditFirstName(data.guest.first_name ?? '');
        setEditLastName(data.guest.last_name ?? '');
        setEditEmail(data.guest.email ?? '');
        setEditPhone(data.guest.phone ?? '');
      } catch (e) {
        setEditError(e instanceof Error ? e.message : 'Failed to load contact');
      } finally {
        setDetailLoading(false);
      }
    },
    [peekGuestDetail, primeGuestDetail],
  );

  useEffect(() => {
    if (!open) return;
    void loadDetail(row.id);
  }, [open, loadDetail, row.id]);

  useEffect(() => {
    if (!open) return;
    void warmGuestDetail(row.id);
  }, [open, row.id, warmGuestDetail]);

  const onSaveGuestDetails = useCallback(async (): Promise<boolean> => {
    if (!detail) return false;
    setEditSaving(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/venue/guests/${detail.guest.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: editFirstName.trim(),
          last_name: editLastName.trim(),
          email: editEmail.trim(),
          phone: editPhone.trim(),
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string; guest?: GuestDetailGuest };
      if (!res.ok) {
        throw new Error(typeof j.error === 'string' ? j.error : 'Save failed');
      }
      if (!j.guest || j.guest.id !== detail.guest.id) {
        await loadDetail(detail.guest.id);
      } else {
        const merged = mergeGuestDetailFromSavedGuest(detail, j.guest);
        primeGuestDetail(merged.guest.id, merged);
        setDetail(merged);
        setEditFirstName(j.guest.first_name ?? '');
        setEditLastName(j.guest.last_name ?? '');
        setEditEmail(j.guest.email ?? '');
        setEditPhone(j.guest.phone ?? '');
      }
      onGuestUpdated?.();
      return true;
    } catch (e) {
      setEditError(e instanceof Error ? e.message : 'Save failed');
      return false;
    } finally {
      setEditSaving(false);
    }
  }, [
    detail,
    editEmail,
    editFirstName,
    editLastName,
    editPhone,
    loadDetail,
    onGuestUpdated,
    primeGuestDetail,
  ]);

  const onEraseGuest = useCallback(
    async (guestId: string): Promise<boolean> => {
      setEraseLoadingId(guestId);
      try {
        const res = await fetch('/api/venue/gdpr/erase-guest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guest_id: guestId }),
        });
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          throw new Error(typeof j.error === 'string' ? j.error : 'Erase failed');
        }
        onDismiss();
        onGuestUpdated?.();
        return true;
      } catch (e) {
        setEditError(e instanceof Error ? e.message : 'Erase failed');
        return false;
      } finally {
        setEraseLoadingId(null);
      }
    },
    [onDismiss, onGuestUpdated],
  );

  const noopRelatedBooking = useCallback((_payload: GuestHistoryRelatedBookingPayload) => {
    /* Toolbar popover: open full bookings page for related history if needed. */
  }, []);

  return (
    <ClampedFixedDropdown
      open={open}
      triggerRef={triggerRef}
      verticalAnchorRef={verticalAnchorRef}
      horizontalCenter={false}
      gapPx={6}
      align="end"
      maxWidthPx={420}
      onDismiss={onDismiss}
      aria-label={`${guestSearchResultLabel(row)} contact details`}
      className="animate-fade-in z-[60] max-h-[min(72dvh,32rem)] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl shadow-slate-900/15 ring-1 ring-slate-100"
    >
      <div className="flex max-h-[min(72dvh,32rem)] flex-col">
        <div className="shrink-0 border-b border-slate-100 px-3 py-2">
          <p className="truncate text-sm font-semibold text-slate-900">{guestSearchResultLabel(row)}</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-2 sm:px-3">
          <ContactDetailPanel
            id={`toolbar-contact-${row.id}`}
            clientLower={venue.clientLower}
            bookingWord={venue.bookingWord}
            venueId={venue.venueId}
            venueCurrency={venue.currency}
            tableManagementEnabled={venue.tableManagementEnabled}
            isAdmin={venue.isAdmin}
            listRow={row}
            selectedId={row.id}
            detail={detail}
            detailLoading={detailLoading}
            editError={editError}
            editFirstName={editFirstName}
            setEditFirstName={setEditFirstName}
            editLastName={editLastName}
            setEditLastName={setEditLastName}
            editEmail={editEmail}
            setEditEmail={setEditEmail}
            editPhone={editPhone}
            setEditPhone={setEditPhone}
            editSaving={editSaving}
            onSaveGuestDetails={onSaveGuestDetails}
            loadDetail={loadDetail}
            loadList={async () => {
              onGuestUpdated?.();
            }}
            eraseLoadingId={eraseLoadingId}
            onEraseGuest={onEraseGuest}
            venueStaffBookingModel={venue.bookingModel}
            venueStaffEnabledBookingModels={venue.enabledModels}
            venueTimezone={venue.venueTimezone}
            onOpenRelatedGuestBooking={noopRelatedBooking}
          />
        </div>
      </div>
    </ClampedFixedDropdown>
  );
}
