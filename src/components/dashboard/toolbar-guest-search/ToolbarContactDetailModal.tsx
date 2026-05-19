'use client';

import { useCallback, useEffect, useState } from 'react';
import { ContactDetailPanel } from '@/components/dashboard/contacts/ContactDetailPanel';
import { useDashboardToolbarVenue } from '@/components/dashboard/toolbar-guest-search/DashboardToolbarVenueProvider';
import { guestSearchResultLabel } from '@/components/dashboard/toolbar-guest-search/guest-search-helpers';
import { useDashboardDetailCache } from '@/components/providers/DashboardDetailCacheProvider';
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

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

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

  if (!open) return null;

  const title = guestSearchResultLabel(row);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/30 p-4 pb-[max(1rem,env(safe-area-inset-bottom,0px))] backdrop-blur-[2px] sm:items-center sm:pb-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="toolbar-contact-detail-modal-title"
        className="flex h-[min(85dvh,85vh)] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-slate-200/80 bg-white shadow-2xl shadow-slate-900/15 ring-1 ring-slate-100 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-4 py-3 sm:px-5">
          <h2 id="toolbar-contact-detail-modal-title" className="min-w-0 truncate text-base font-semibold text-slate-900 sm:text-lg">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4 sm:py-4">
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
          />
        </div>
      </div>
    </div>
  );
}
