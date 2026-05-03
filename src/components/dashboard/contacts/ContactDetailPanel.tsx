'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { GuestMessageChannelSelect } from '@/components/booking/GuestMessageChannelSelect';
import type { GuestMessageChannel } from '@/lib/booking/guest-message-channel';
import { useToast } from '@/components/ui/Toast';
import { GuestTagEditor } from '@/components/dashboard/GuestTagEditor';
import { CustomerProfileNotesCard } from '@/components/booking/CustomerProfileNotesCard';
import { StatTile } from '@/components/ui/dashboard/StatTile';
import type { GuestDetailResponse } from '@/types/contacts';
import { ContactCustomFieldsSection } from '@/components/dashboard/contacts/ContactCustomFieldsSection';
import { ContactDocumentsSection } from '@/components/dashboard/contacts/ContactDocumentsSection';
import { ContactMarketingSection } from '@/components/dashboard/contacts/ContactMarketingSection';
import { ContactTimelineSection } from '@/components/dashboard/contacts/ContactTimelineSection';
import { ContactHouseholdSection } from '@/components/dashboard/contacts/ContactHouseholdSection';
import { ContactGdprSection } from '@/components/dashboard/contacts/ContactGdprSection';

export function ContactDetailPanel({
  clientLower,
  bookingWord,
  currencySymbol,
  venueId,
  isAdmin,
  selectedId,
  detail,
  detailLoading,
  editError,
  editName,
  setEditName,
  editEmail,
  setEditEmail,
  editPhone,
  setEditPhone,
  editSaving,
  onSaveGuestDetails,
  loadDetail,
  loadList,
  eraseLoadingId,
  onEraseGuest,
  onOpenMerge,
}: {
  clientLower: string;
  bookingWord: string;
  currencySymbol: string;
  venueId: string;
  isAdmin: boolean;
  selectedId: string;
  detail: GuestDetailResponse | null;
  detailLoading: boolean;
  editError: string | null;
  editName: string;
  setEditName: (v: string) => void;
  editEmail: string;
  setEditEmail: (v: string) => void;
  editPhone: string;
  setEditPhone: (v: string) => void;
  editSaving: boolean;
  onSaveGuestDetails: () => Promise<void>;
  loadDetail: (guestId: string) => Promise<void>;
  loadList: () => Promise<void>;
  eraseLoadingId: string | null;
  onEraseGuest: (guestId: string) => Promise<void>;
  onOpenMerge?: () => void;
}) {
  const { addToast } = useToast();
  const [messageChannel, setMessageChannel] = useState<GuestMessageChannel>('both');
  const [messageDraft, setMessageDraft] = useState('');
  const [messageSending, setMessageSending] = useState(false);

  useEffect(() => {
    setMessageDraft('');
    setMessageChannel('both');
  }, [selectedId]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      {detailLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {editError && !detailLoading && <p className="mb-2 text-sm text-red-600">{editError}</p>}
      {detail && !detailLoading && detail.guest.id === selectedId ? (
        <div className="space-y-5">
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4">
            <h3 className="text-sm font-semibold text-slate-800">Contact</h3>
            <div className="mt-2 space-y-2">
              <label className="block text-xs font-medium text-slate-500">Name</label>
              <input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
              <label className="block text-xs font-medium text-slate-500">Email</label>
              <input
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
              <label className="block text-xs font-medium text-slate-500">Phone</label>
              <input
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
              <button
                type="button"
                disabled={editSaving}
                onClick={() => void onSaveGuestDetails()}
                className="mt-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
              >
                {editSaving ? 'Saving…' : 'Save details'}
              </button>
            </div>
            <GuestTagEditor
              tags={detail.guest.tags}
              venueId={venueId}
              onTagsChange={async (next) => {
                const res = await fetch(`/api/venue/guests/${detail.guest.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ tags: next }),
                });
                if (!res.ok) {
                  const j = (await res.json().catch(() => ({}))) as { error?: string };
                  throw new Error(typeof j.error === 'string' ? j.error : 'Could not save tags');
                }
                await loadDetail(detail.guest.id);
                await loadList();
              }}
            />
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href="/dashboard/bookings/new"
                className="inline-flex min-h-10 items-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-brand-700 hover:bg-slate-50"
              >
                New {bookingWord.toLowerCase()}
              </Link>
              <Link
                href={`/dashboard/bookings?guest=${encodeURIComponent(detail.guest.id)}`}
                className="inline-flex min-h-10 items-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-brand-700 hover:bg-slate-50"
              >
                View {bookingWord.toLowerCase()}s
              </Link>
              {isAdmin && onOpenMerge ? (
                <button
                  type="button"
                  onClick={onOpenMerge}
                  className="inline-flex min-h-10 items-center rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm font-medium text-amber-800 hover:bg-amber-50"
                >
                  Merge duplicate…
                </button>
              ) : null}
              {isAdmin ? (
                <button
                  type="button"
                  disabled={eraseLoadingId === detail.guest.id}
                  onClick={() => void onEraseGuest(detail.guest.id)}
                  className="inline-flex min-h-10 items-center rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  {eraseLoadingId === detail.guest.id ? 'Erasing…' : 'Erase data'}
                </button>
              ) : null}
            </div>
          </div>

          <ContactMarketingSection guestId={detail.guest.id} detail={detail} onUpdated={() => void loadDetail(detail.guest.id)} />

          <ContactCustomFieldsSection guestId={detail.guest.id} detail={detail} onUpdated={() => void loadDetail(detail.guest.id)} />

          <ContactDocumentsSection guestId={detail.guest.id} onChanged={() => void loadDetail(detail.guest.id)} />

          <ContactTimelineSection guestId={detail.guest.id} />

          <ContactHouseholdSection guestId={detail.guest.id} clientLower={clientLower} onChanged={() => void loadDetail(detail.guest.id)} />

          <ContactGdprSection guestId={detail.guest.id} clientLower={clientLower} isAdmin={isAdmin} />

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <StatTile
              label={`Total ${bookingWord.toLowerCase()}s`}
              value={String(detail.stats.total_bookings)}
              color="slate"
            />
            <StatTile label="Cancellations" value={String(detail.stats.cancellations)} color="amber" />
            <StatTile label="No-shows" value={String(detail.stats.no_shows)} color="amber" />
            <StatTile
              label="Deposits paid"
              value={`${currencySymbol}${(detail.stats.total_deposit_pence_paid / 100).toFixed(2)}`}
              color="emerald"
            />
            <StatTile
              label="Days since last visit"
              value={detail.stats.days_since_last_visit != null ? String(detail.stats.days_since_last_visit) : '—'}
              color="brand"
            />
            <StatTile label="Days as customer" value={String(detail.stats.days_as_customer)} color="brand" />
          </div>

          <CustomerProfileNotesCard
            guestId={detail.guest.id}
            value={detail.guest.customer_profile_notes}
            onSaved={() => void loadDetail(detail.guest.id)}
          />

          <div className="rounded-xl border border-slate-200">
            <h3 className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
              {bookingWord} history
            </h3>
            <ul className="max-h-72 divide-y divide-slate-50 overflow-y-auto">
              {detail.booking_history.map((b) => (
                <li key={b.id}>
                  <Link
                    href={`/dashboard/bookings?openBooking=${encodeURIComponent(b.id)}`}
                    className="flex flex-col gap-0.5 px-3 py-2 text-sm hover:bg-slate-50"
                  >
                    <span className="font-medium text-slate-900">
                      {b.booking_date} {b.booking_time}
                    </span>
                    <span className="text-xs text-slate-600">
                      <span className="font-medium text-slate-700">{b.kind_label}</span>
                      {' · '}
                      {b.detail_label} · {b.status}
                      {b.deposit_status ? ` · deposit ${b.deposit_status}` : ''}
                      {typeof b.deposit_amount_pence === 'number' && b.deposit_amount_pence > 0
                        ? ` · ${currencySymbol}${(b.deposit_amount_pence / 100).toFixed(2)}`
                        : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-xl border border-slate-200">
            <h3 className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
              Communications
            </h3>
            <div className="space-y-3 p-3">
              <div className="rounded-xl border border-slate-100 bg-slate-50/80 p-3">
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Send message via</span>
                  <GuestMessageChannelSelect
                    value={messageChannel}
                    onChange={setMessageChannel}
                    disabled={messageSending}
                  />
                </div>
                <textarea
                  value={messageDraft}
                  onChange={(e) => setMessageDraft(e.target.value)}
                  rows={3}
                  disabled={messageSending}
                  placeholder={`SMS / email to ${clientLower}…`}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:border-brand-300 focus:outline-none focus:ring-1 focus:ring-brand-200 disabled:opacity-50"
                />
                <button
                  type="button"
                  disabled={messageSending || messageDraft.trim().length === 0}
                  onClick={async () => {
                    setMessageSending(true);
                    try {
                      const res = await fetch(`/api/venue/guests/${detail.guest.id}/message`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ message: messageDraft.trim(), channel: messageChannel }),
                      });
                      const payload = (await res.json().catch(() => ({}))) as {
                        success?: boolean;
                        error?: string;
                        errors?: string[];
                      };
                      if (!res.ok || !payload.success) {
                        const detailErr =
                          (payload.errors && payload.errors.length > 0
                            ? payload.errors.join('; ')
                            : payload.error) ?? 'Failed to send message';
                        addToast(detailErr, 'error');
                        return;
                      }
                      if (payload.errors && payload.errors.length > 0) {
                        addToast(`Sent with issues — ${payload.errors.join('; ')}`, 'error');
                      } else {
                        addToast('Message sent', 'success');
                      }
                      setMessageDraft('');
                      await loadDetail(detail.guest.id);
                    } finally {
                      setMessageSending(false);
                    }
                  }}
                  className="mt-2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-900 disabled:opacity-50"
                >
                  {messageSending ? 'Sending…' : 'Send'}
                </button>
              </div>

              {detail.communications.length === 0 ? (
                <p className="text-sm text-slate-500">No logged communications for this guest yet.</p>
              ) : (
                <ul className="max-h-56 divide-y divide-slate-50 overflow-y-auto rounded-lg border border-slate-100">
                  {detail.communications.map((c) => (
                    <li key={c.id} className="px-3 py-2 text-sm">
                      <div className="font-medium text-slate-800">{c.message_type}</div>
                      <div className="text-xs text-slate-500">
                        {c.channel} · {c.status} · {new Date(c.created_at).toLocaleString()}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
