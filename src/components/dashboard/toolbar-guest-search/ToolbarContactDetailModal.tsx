'use client';

import { useCallback, useEffect, useState } from 'react';
import { ContactDetailPanel } from '@/components/dashboard/contacts/ContactDetailPanel';
import { MergeContactsModal } from '@/components/dashboard/contacts/MergeContactsModal';
import { useDashboardToolbarVenue } from '@/components/dashboard/toolbar-guest-search/DashboardToolbarVenueProvider';
import { guestSearchResultLabel } from '@/components/dashboard/toolbar-guest-search/guest-search-helpers';
import { useDashboardDetailCache } from '@/components/providers/DashboardDetailCacheProvider';
import type { GuestDetailGuest, GuestDetailResponse, GuestListRow } from '@/types/contacts';
import { Dialog } from '@/components/ui/primitives/Dialog';

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

export function ToolbarContactDetailModal({
  row,
  open,
  onClose,
  onGuestUpdated,
}: {
  row: GuestListRow;
  open: boolean;
  onClose: () => void;
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
  const [mergeOpen, setMergeOpen] = useState(false);

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
        onClose();
        onGuestUpdated?.();
        return true;
      } catch (e) {
        setEditError(e instanceof Error ? e.message : 'Erase failed');
        return false;
      } finally {
        setEraseLoadingId(null);
      }
    },
    [onClose, onGuestUpdated],
  );

  const title = guestSearchResultLabel(row);

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && mergeOpen) return;
          if (!next) onClose();
        }}
        title={title}
        size="md"
        contentClassName="flex max-h-[min(85dvh,85vh)] w-full max-w-lg flex-col overflow-hidden"
      >
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
            onOpenMerge={venue.isAdmin ? () => setMergeOpen(true) : undefined}
            venueStaffBookingModel={venue.bookingModel}
            venueStaffEnabledBookingModels={venue.enabledModels}
            venueTimezone={venue.venueTimezone}
          />

      </Dialog>

      {mergeOpen && venue.isAdmin ? (
        <MergeContactsModal
          targetGuestId={row.id}
          clientLower={venue.clientLower}
          onClose={() => setMergeOpen(false)}
          onMerged={() => {
            void loadDetail(row.id);
            onGuestUpdated?.();
            setMergeOpen(false);
          }}
        />
      ) : null}
    </>
  );
}
