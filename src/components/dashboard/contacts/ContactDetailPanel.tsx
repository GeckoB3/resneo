'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { GuestMessageChannelSelect } from '@/components/booking/GuestMessageChannelSelect';
import type { GuestMessageChannel } from '@/lib/booking/guest-message-channel';
import { useToast } from '@/components/ui/Toast';
import { GuestTagEditor } from '@/components/dashboard/GuestTagEditor';
import { CustomerProfileNotesCard } from '@/components/booking/CustomerProfileNotesCard';
import { StatTile } from '@/components/ui/dashboard/StatTile';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { Pill } from '@/components/ui/dashboard/Pill';
import type { GuestDetailResponse, GuestListRow } from '@/types/contacts';
import {
  formatCalendarDayShort,
  formatNextBookingSummary,
  formatRelativeVisitDate,
} from '@/lib/guests/contact-formatting';
import { ContactCustomFieldsSection } from '@/components/dashboard/contacts/ContactCustomFieldsSection';
import { ContactDocumentsSection } from '@/components/dashboard/contacts/ContactDocumentsSection';
import { ContactMarketingSection } from '@/components/dashboard/contacts/ContactMarketingSection';
import { ContactTimelineSection } from '@/components/dashboard/contacts/ContactTimelineSection';
import { ContactHouseholdSection } from '@/components/dashboard/contacts/ContactHouseholdSection';
import { ContactGdprSection } from '@/components/dashboard/contacts/ContactGdprSection';
import {
  bookingExpandAccordionBodyClass,
  bookingExpandAccordionDetailsClass,
  bookingExpandAccordionSummaryClass,
  bookingExpandActionsBarClass,
} from '@/app/dashboard/bookings/booking-expand-accordion-classes';

const accordionChevron = (
  <svg className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
    <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
  </svg>
);

function SubBlock({ title, children, className = '' }: { title: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`space-y-2 ${className}`}>
      <h3 className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">{title}</h3>
      {children}
    </section>
  );
}

export function ContactDetailPanel({
  id,
  clientLower,
  bookingWord,
  currencySymbol,
  venueId,
  isAdmin,
  listRow,
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
  id: string;
  clientLower: string;
  bookingWord: string;
  currencySymbol: string;
  venueId: string;
  isAdmin: boolean;
  listRow: GuestListRow;
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

  if (detailLoading) {
    return (
      <div
        id={id}
        className="mt-1.5 animate-pulse space-y-2.5 px-1 pb-3 sm:px-1.5"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="grid grid-cols-2 gap-2.5">
          <div className="h-28 rounded-2xl bg-slate-100" />
          <div className="h-28 rounded-2xl bg-slate-100" />
        </div>
        <div className="h-16 rounded-2xl bg-slate-100" />
        <div className="h-10 rounded-2xl bg-slate-100" />
      </div>
    );
  }

  if (!detail || detail.guest.id !== selectedId) {
    return (
      <div id={id} className="px-3 py-4 sm:px-4" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        {editError ? <p className="text-sm text-red-600">{editError}</p> : (
          <p className="text-sm text-slate-500">Could not load this {clientLower}.</p>
        )}
      </div>
    );
  }

  const g = detail.guest;
  const displayName = g.name?.trim() || 'Unnamed';
  const email = g.email?.trim() || null;
  const phone = g.phone?.trim() || null;
  const tags = g.tags ?? [];
  const nextVisitLabel = formatNextBookingSummary(listRow.next_booking_date, listRow.next_booking_time);
  const lastVisitRelative = g.last_visit_date ? formatRelativeVisitDate(g.last_visit_date) : null;
  const lastVisitCal = formatCalendarDayShort(g.last_visit_date ?? listRow.last_visit_date);
  const activeFieldCount = (detail.custom_field_definitions ?? []).filter((d) => d.is_active).length;
  const marketingHint =
    g.marketing_opt_out ? 'Opted out' : g.marketing_consent ? 'Subscribed' : 'No consent';
  const recordSummaryHint =
    activeFieldCount === 0 ? marketingHint : `${marketingHint} · ${activeFieldCount} field${activeFieldCount === 1 ? '' : 's'}`;
  const activitySummaryHint = `${detail.booking_history.length} in list`;
  const inboxSummaryHint =
    `${detail.communications.length} message${detail.communications.length === 1 ? '' : 's'}`
    + (g.customer_profile_notes?.trim() ? ' · note on file' : '');

  return (
    <div
      id={id}
      className="mt-1.5 flex flex-col gap-2.5 px-0.5 pb-2.5 sm:px-1"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {editError ? <p className="px-1 text-sm text-red-600">{editError}</p> : null}

      <SectionCard className="rounded-xl ring-1 ring-slate-900/[0.04]">
        <SectionCard.Body className="p-2.5 sm:p-3">
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-sm font-bold text-brand-700 ring-1 ring-brand-100">
                {displayName.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                  <p className="max-w-[14rem] truncate text-sm font-bold text-slate-900 sm:max-w-[20rem]">{displayName}</p>
                  <Pill variant="neutral" size="sm">
                    {g.visit_count > 0 ? `${g.visit_count} visit${g.visit_count !== 1 ? 's' : ''}` : 'New'}
                  </Pill>
                  {g.no_show_count > 0 ? (
                    <Pill variant="warning" size="sm" dot>
                      {g.no_show_count} no-show{g.no_show_count !== 1 ? 's' : ''}
                    </Pill>
                  ) : null}
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  {listRow.total_bookings > 0 ? (
                    <>
                      <span className="font-medium text-slate-700">{listRow.total_bookings}</span>
                      {' '}
                      {bookingWord.toLowerCase()}
                      {listRow.total_bookings !== 1 ? 's' : ''} on file
                    </>
                  ) : (
                    <>No past {bookingWord.toLowerCase()}s yet</>
                  )}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-1.5 sm:flex sm:shrink-0 sm:items-center">
              {phone ? (
                <a
                  href={`tel:${phone}`}
                  className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  Call
                </a>
              ) : null}
              {email ? (
                <a
                  href={`mailto:${email}`}
                  className="inline-flex min-h-8 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  Email
                </a>
              ) : null}
            </div>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-2 py-1.5">
              <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Email</p>
              {email ? (
                <a href={`mailto:${email}`} className="mt-0.5 block truncate text-xs font-bold text-slate-800 hover:text-brand-700">
                  {email}
                </a>
              ) : (
                <p className="mt-0.5 text-xs font-bold text-slate-400">Not provided</p>
              )}
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-2 py-1.5">
              <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Phone</p>
              {phone ? (
                <a href={`tel:${phone}`} className="mt-0.5 block truncate text-xs font-bold text-slate-800 hover:text-brand-700">
                  {phone}
                </a>
              ) : (
                <p className="mt-0.5 text-xs font-bold text-slate-400">Not provided</p>
              )}
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-2 py-1.5">
              <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Last visit</p>
              <p className="mt-0.5 truncate text-xs font-bold text-slate-800" title={lastVisitRelative ?? undefined}>
                {g.last_visit_date || listRow.last_visit_date ? (
                  <>
                    <span className="sm:hidden">{lastVisitCal}</span>
                    <span className="hidden cursor-help sm:inline">{lastVisitRelative ?? lastVisitCal}</span>
                  </>
                ) : (
                  '—'
                )}
              </p>
            </div>
            <div
              className={`rounded-lg border px-2 py-1.5 ${
                nextVisitLabel ? 'border-sky-200 bg-sky-50/80' : 'border-slate-200 bg-slate-50/70'
              }`}
            >
              <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Next visit</p>
              <p className={`mt-0.5 truncate text-xs font-bold ${nextVisitLabel ? 'text-sky-900' : 'text-slate-500'}`}>
                {nextVisitLabel ?? 'None scheduled'}
              </p>
            </div>
          </div>

          <div className="mt-2.5 border-t border-slate-100 pt-2.5">
            <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Tags</p>
            <div className="mt-1.5">
              <GuestTagEditor
                tags={tags}
                venueId={venueId}
                onTagsChange={async (next) => {
                  const res = await fetch(`/api/venue/guests/${g.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ tags: next }),
                  });
                  if (!res.ok) {
                    const j = (await res.json().catch(() => ({}))) as { error?: string };
                    throw new Error(typeof j.error === 'string' ? j.error : 'Could not save tags');
                  }
                  await loadDetail(g.id);
                  await loadList();
                }}
              />
            </div>
          </div>

          <div className="mt-2.5 border-t border-slate-100 pt-2.5">
            <p className="text-[9px] font-semibold uppercase tracking-widest text-slate-500">Staff notes</p>
            <div className="mt-1.5">
              <CustomerProfileNotesCard
                embedded
                embeddedFlush
                guestId={g.id}
                value={g.customer_profile_notes}
                onSaved={() => void loadDetail(g.id)}
              />
            </div>
          </div>
        </SectionCard.Body>
      </SectionCard>

      <div className={bookingExpandActionsBarClass}>
        <div className="flex flex-wrap items-center gap-1.5 px-2 py-2 sm:px-3">
          <Link
            href="/dashboard/bookings/new"
            className="inline-flex min-h-7 shrink-0 items-center gap-1 rounded-md bg-brand-600 px-2 py-0.5 text-[10px] font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 sm:text-[11px]"
          >
            New {bookingWord.toLowerCase()}
          </Link>
          <Link
            href={`/dashboard/bookings?guest=${encodeURIComponent(g.id)}`}
            className="inline-flex min-h-7 shrink-0 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-50 sm:text-[11px]"
          >
            View {bookingWord.toLowerCase()}s
          </Link>
          {isAdmin && onOpenMerge ? (
            <button
              type="button"
              onClick={onOpenMerge}
              className="inline-flex min-h-7 shrink-0 items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-900 transition-colors hover:bg-amber-100 sm:text-[11px]"
            >
              Merge…
            </button>
          ) : null}
          {isAdmin ? (
            <button
              type="button"
              disabled={eraseLoadingId === g.id}
              onClick={() => void onEraseGuest(g.id)}
              className="inline-flex min-h-7 shrink-0 items-center gap-1 rounded-md border border-transparent px-2 py-0.5 text-[10px] font-semibold text-red-600 transition-colors hover:border-red-100 hover:bg-red-50 disabled:opacity-50 sm:text-[11px]"
            >
              {eraseLoadingId === g.id ? 'Erasing…' : 'Erase data'}
            </button>
          ) : null}
        </div>
      </div>

      <details className={bookingExpandAccordionDetailsClass}>
        <summary className={bookingExpandAccordionSummaryClass}>
          <span>Record &amp; preferences</span>
          <span className="max-w-[9rem] truncate text-[11px] font-medium text-slate-400 group-open:hidden sm:max-w-[14rem]">
            {recordSummaryHint}
          </span>
          {accordionChevron}
        </summary>
        <div className={`${bookingExpandAccordionBodyClass} space-y-4`}>
          <SubBlock title="Name & contact details">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div>
                <label htmlFor={`${id}-name`} className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Name</label>
                <input
                  id={`${id}-name`}
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="mt-0.5 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm"
                />
              </div>
              <div>
                <label htmlFor={`${id}-email`} className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Email</label>
                <input
                  id={`${id}-email`}
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="mt-0.5 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm"
                />
              </div>
              <div className="sm:col-span-2">
                <label htmlFor={`${id}-phone`} className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Phone</label>
                <input
                  id={`${id}-phone`}
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  className="mt-0.5 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm"
                />
              </div>
            </div>
            <button
              type="button"
              disabled={editSaving}
              onClick={() => void onSaveGuestDetails()}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {editSaving ? 'Saving…' : 'Save changes'}
            </button>
          </SubBlock>

          <SubBlock title="Marketing preferences" className="border-t border-slate-200/70 pt-4">
            <ContactMarketingSection guestId={g.id} detail={detail} onUpdated={() => void loadDetail(g.id)} />
          </SubBlock>

          <SubBlock title="Custom fields" className="border-t border-slate-200/70 pt-4">
            <ContactCustomFieldsSection guestId={g.id} detail={detail} onUpdated={() => void loadDetail(g.id)} />
          </SubBlock>

          <SubBlock title="Household" className="border-t border-slate-200/70 pt-4">
            <ContactHouseholdSection guestId={g.id} clientLower={clientLower} onChanged={() => void loadDetail(g.id)} />
          </SubBlock>

          <SubBlock title="Documents" className="border-t border-slate-200/70 pt-4">
            <ContactDocumentsSection guestId={g.id} onChanged={() => void loadDetail(g.id)} />
          </SubBlock>
        </div>
      </details>

      <details className={bookingExpandAccordionDetailsClass}>
        <summary className={bookingExpandAccordionSummaryClass}>
          <span>
            {bookingWord}
            {' '}
            history &amp; activity
          </span>
          <span className="text-[11px] font-medium text-slate-400 group-open:hidden">{activitySummaryHint}</span>
          {accordionChevron}
        </summary>
        <div className={`${bookingExpandAccordionBodyClass} space-y-4`}>
          <SubBlock title="At a glance">
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              <StatTile label={`Total ${bookingWord.toLowerCase()}s`} value={String(detail.stats.total_bookings)} color="slate" />
              <StatTile label="Cancellations" value={String(detail.stats.cancellations)} color="amber" />
              <StatTile label="No-shows" value={String(detail.stats.no_shows)} color="amber" />
              <StatTile
                label="Deposits paid"
                value={`${currencySymbol}${(detail.stats.total_deposit_pence_paid / 100).toFixed(2)}`}
                color="emerald"
              />
              <StatTile
                label="Since last visit"
                value={detail.stats.days_since_last_visit != null ? `${detail.stats.days_since_last_visit}d` : '—'}
                color="brand"
              />
              <StatTile label="Relationship" value={`${detail.stats.days_as_customer}d`} color="brand" />
            </div>
          </SubBlock>

          <SubBlock
            title={
              <>
                {bookingWord}
                {' '}
                history
              </>
            }
            className="border-t border-slate-200/70 pt-4"
          >
            <ul className="max-h-60 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-100 bg-white">
              {detail.booking_history.map((b) => (
                <li key={b.id}>
                  <Link
                    href={`/dashboard/bookings?openBooking=${encodeURIComponent(b.id)}`}
                    className="flex flex-col gap-0.5 px-2.5 py-2 text-sm hover:bg-slate-50"
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
          </SubBlock>

          <SubBlock title="Timeline" className="border-t border-slate-200/70 pt-4">
            <ContactTimelineSection guestId={g.id} />
          </SubBlock>
        </div>
      </details>

      <details
        className={bookingExpandAccordionDetailsClass}
        open={detail.communications.length > 0}
      >
        <summary className={bookingExpandAccordionSummaryClass}>
          <span>Messages &amp; privacy</span>
          <span className="max-w-[10rem] truncate text-[11px] font-medium text-slate-400 group-open:hidden sm:max-w-[16rem]">
            {inboxSummaryHint}
          </span>
          {accordionChevron}
        </summary>
        <div className={`${bookingExpandAccordionBodyClass} space-y-4`}>
          <SubBlock title="Send a message">
            <div className="rounded-xl border border-slate-200/80 bg-white p-2.5">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Send via</span>
                <GuestMessageChannelSelect value={messageChannel} onChange={setMessageChannel} disabled={messageSending} />
              </div>
              <textarea
                value={messageDraft}
                onChange={(e) => setMessageDraft(e.target.value)}
                rows={3}
                disabled={messageSending}
                placeholder={`SMS / email to ${clientLower}…`}
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm placeholder:text-slate-400 focus:border-brand-300 focus:outline-none focus:ring-1 focus:ring-brand-200 disabled:opacity-50"
              />
              <button
                type="button"
                disabled={messageSending || messageDraft.trim().length === 0}
                onClick={async () => {
                  setMessageSending(true);
                  try {
                    const res = await fetch(`/api/venue/guests/${g.id}/message`, {
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
                        (payload.errors && payload.errors.length > 0 ? payload.errors.join('; ') : payload.error)
                        ?? 'Failed to send message';
                      addToast(detailErr, 'error');
                      return;
                    }
                    if (payload.errors && payload.errors.length > 0) {
                      addToast(`Sent with issues — ${payload.errors.join('; ')}`, 'error');
                    } else {
                      addToast('Message sent', 'success');
                    }
                    setMessageDraft('');
                    await loadDetail(g.id);
                  } finally {
                    setMessageSending(false);
                  }
                }}
                className="mt-2 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
              >
                {messageSending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </SubBlock>

          <SubBlock title="Message log" className="border-t border-slate-200/70 pt-4">
            {detail.communications.length === 0 ? (
              <p className="text-sm text-slate-600">No logged communications yet.</p>
            ) : (
              <ul className="max-h-52 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-100 bg-white">
                {detail.communications.map((c) => (
                  <li key={c.id} className="px-2.5 py-2 text-sm">
                    <div className="font-medium text-slate-800">{c.message_type}</div>
                    <div className="text-xs text-slate-500">
                      {c.channel} · {c.status} · {new Date(c.created_at).toLocaleString()}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SubBlock>

          <SubBlock title="Privacy & data" className="border-t border-slate-200/70 pt-4">
            <ContactGdprSection guestId={g.id} clientLower={clientLower} isAdmin={isAdmin} />
          </SubBlock>
        </div>
      </details>
    </div>
  );
}
