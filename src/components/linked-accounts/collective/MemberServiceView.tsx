'use client';

/**
 * A service from the host, as its member reads it (UX spec §2 item 3, rewritten 2026-09-14; W6).
 *
 * Not a disabled form. A disabled form shows the controls for choosing a value instead of the
 * value, has no contrast floor, and would repeat "set by the host" down a dozen sections. So this
 * is three zones instead:
 *
 *   1. At a glance: what it is, how its copy is doing, and the numbers a member needs most days.
 *   2. Your settings: everything the member may actually change, in one place.
 *   3. What {host} has set: plain values, written out, with "No deposit" rather than a dash so
 *      nothing reads as missing data.
 */
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/primitives/Button';
import { Dialog } from '@/components/ui/primitives/Dialog';
import { FromHostPill, RetiredPill, VenueSyncPill, EditReachNote } from './CollectivePills';
import { collectiveCopy } from '@/lib/linked-accounts/collective-copy';
import type { CollectiveServiceBlock } from '@/lib/linked-accounts/replicas/service-blocks';

export interface MemberServiceCalendar {
  id: string;
  name: string;
  is_active?: boolean;
  /** True when this calendar already offers the service. */
  offers: boolean;
  /** Who last changed this calendar's row, when it was in the last 30 days. */
  last_changed?: { venue_name: string; at: string } | null;
}

export interface MemberServiceValues {
  name: string;
  description?: string | null;
  price_pence?: number | null;
  deposit_pence?: number | null;
  payment_requirement?: string | null;
  duration_minutes?: number | null;
  buffer_minutes?: number | null;
  cancellation_notice_hours?: number | null;
  location_type?: string | null;
  online_meeting_url?: string | null;
  online_meeting_info?: string | null;
  pre_appointment_instructions?: string | null;
  variants?: { id?: string; name: string; is_active?: boolean }[];
  addon_groups?: { group: { id: string; name: string } }[];
  compliance_type_names?: string[];
}

export interface MemberServiceSave {
  practitioner_ids: string[];
  online_meeting_url?: string;
  online_meeting_info?: string;
  pre_appointment_instructions?: string;
}

export interface MemberServiceViewProps {
  open: boolean;
  onClose: () => void;
  service: MemberServiceValues;
  block: CollectiveServiceBlock;
  calendars: MemberServiceCalendar[];
  currencySymbol?: string;
  saving?: boolean;
  error?: string | null;
  /**
   * Set when the last save listed upcoming bookings on a calendar being unticked: the next save
   * keeps them and goes ahead, and the button says so.
   */
  confirmRemoval?: boolean;
  onSave: (values: MemberServiceSave) => void;
}

export function MemberServiceView({
  open,
  onClose,
  service,
  block,
  calendars,
  currencySymbol = '£',
  saving = false,
  error = null,
  confirmRemoval = false,
  onSave,
}: MemberServiceViewProps) {
  const savedCalendarIds = useMemo(
    () => calendars.filter((c) => c.offers).map((c) => c.id),
    [calendars],
  );
  const [chosen, setChosen] = useState<string[]>(savedCalendarIds);
  const [meetingUrl, setMeetingUrl] = useState(service.online_meeting_url ?? '');
  const [meetingInfo, setMeetingInfo] = useState(service.online_meeting_info ?? '');
  const [instructions, setInstructions] = useState(service.pre_appointment_instructions ?? '');

  const changed =
    chosen.length !== savedCalendarIds.length ||
    chosen.some((id) => !savedCalendarIds.includes(id)) ||
    meetingUrl !== (service.online_meeting_url ?? '') ||
    meetingInfo !== (service.online_meeting_info ?? '') ||
    instructions !== (service.pre_appointment_instructions ?? '');

  const isOnline = service.location_type === 'online';
  const host = block.host_venue_name;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !saving) onClose();
      }}
      title={service.name}
      description={collectiveCopy('reach.member.replica', { host, collective: block.collective_name })}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={() => onSave({
                practitioner_ids: chosen,
                online_meeting_url: meetingUrl,
                online_meeting_info: meetingInfo,
                pre_appointment_instructions: instructions,
              })} loading={saving} disabled={!changed || saving}>
            {confirmRemoval ? 'Remove and keep bookings' : 'Save your settings'}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Close
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {error ? (
          <p
            role="alert"
            className={`rounded-lg border px-3 py-2 text-sm ${
              confirmRemoval ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-rose-200 bg-rose-50 text-rose-800'
            }`}
          >
            {error}
          </p>
        ) : null}

        {/* 1. At a glance. */}
        <section className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {block.role === 'retired' ? <RetiredPill /> : <FromHostPill hostName={host} />}
            <VenueSyncPill status={block.status} reason={block.status_reason} />
          </div>
          {block.status_reason ? <p className="text-sm text-slate-600">{block.status_reason}</p> : null}
          {block.role === 'retired' ? (
            <p className="text-sm text-amber-800">
              {host} has taken this off the {block.collective_name} page. It takes no new bookings, and the
              bookings you already have are not changed.
            </p>
          ) : null}
          <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <Fact label="Price" value={money(service.price_pence, currencySymbol)} />
            <Fact label="Length" value={minutes(service.duration_minutes)} />
            <Fact label="Deposit" value={money(service.deposit_pence, currencySymbol, 'No deposit')} />
            <Fact
              label="Forms"
              value={
                service.compliance_type_names && service.compliance_type_names.length > 0
                  ? service.compliance_type_names.join(', ')
                  : 'No forms'
              }
            />
          </dl>
        </section>

        {/* 2. Your settings. */}
        <section className="space-y-3 rounded-xl border border-brand-200 bg-brand-50/50 p-3">
          <h3 className="text-sm font-semibold text-brand-900">Your settings</h3>

          <div>
            <p className="text-sm font-medium text-slate-800">
              {collectiveCopy('svc.member.view.calendarsHeading')}
            </p>
            <EditReachNote>
              {collectiveCopy('svc.member.view.calendarsHelp', { service: service.name, collective: block.collective_name })}
            </EditReachNote>
            {calendars.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">{collectiveCopy('svc.member.card.noCalendars')}</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {calendars.map((calendar) => (
                  <li key={calendar.id} className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 text-sm text-slate-800">
                      <input
                        type="checkbox"
                        checked={chosen.includes(calendar.id)}
                        disabled={block.role === 'retired'}
                        onChange={(e) =>
                          setChosen((prev) =>
                            e.target.checked ? [...prev, calendar.id] : prev.filter((id) => id !== calendar.id),
                          )
                        }
                        className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                      />
                      <span>{calendar.name}</span>
                    </label>
                    {calendar.last_changed ? (
                      <span className="text-xs text-slate-500">
                        {collectiveCopy('svc.cal.lastChanged', {
                          venue: calendar.last_changed.venue_name,
                          date: formatDay(calendar.last_changed.at),
                        })}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {isOnline ? (
            <div className="space-y-2">
              <label className="block text-sm">
                <span className="font-medium text-slate-800">{collectiveCopy('svc.member.view.linkLabel')}</span>
                <input
                  type="url"
                  value={meetingUrl}
                  onChange={(e) => setMeetingUrl(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1 text-sm"
                />
              </label>
              <label className="block text-sm">
                <span className="font-medium text-slate-800">{collectiveCopy('svc.form.location.infoLabel')}</span>
                <textarea
                  value={meetingInfo}
                  onChange={(e) => setMeetingInfo(e.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1 text-sm"
                />
              </label>
              <EditReachNote>{collectiveCopy('svc.form.location.linkHelp')}</EditReachNote>
            </div>
          ) : null}

          <label className="block text-sm">
            <span className="font-medium text-slate-800">{collectiveCopy('svc.member.view.instructionsLabel')}</span>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={2}
              maxLength={2000}
              className="mt-1 w-full rounded-lg border border-slate-200 px-2 py-1 text-sm"
            />
            <EditReachNote>{collectiveCopy('svc.member.view.instructionsHelp', { host })}</EditReachNote>
          </label>
        </section>

        {/* 3. What the host has set. */}
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-slate-900">
            {collectiveCopy('svc.member.view.hostHeading', { host })}
          </h3>
          <dl className="space-y-1 text-sm">
            <Row label="Description" value={service.description || 'No description'} />
            <Row label="Online payment" value={paymentWords(service.payment_requirement)} />
            <Row label="Buffer" value={service.buffer_minutes ? minutes(service.buffer_minutes) : 'No buffer'} />
            <Row
              label="Cancellation notice"
              value={
                service.cancellation_notice_hours
                  ? `${service.cancellation_notice_hours} hours`
                  : 'No notice needed'
              }
            />
            <Row
              label="Options"
              value={
                (service.variants ?? []).filter((v) => v.is_active !== false).map((v) => v.name).join(', ') ||
                'No options'
              }
            />
            <Row
              label="Add-ons"
              value={(service.addon_groups ?? []).map((g) => g.group.name).join(', ') || 'No add-ons'}
            />
            <Row label="Staff bookings only" value={block.role === 'retired' ? 'Not bookable' : undefined} />
          </dl>
        </section>
      </div>
    </Dialog>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="font-medium text-slate-900">{value}</dd>
    </div>
  );
}

function Row({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="text-slate-500">{label}:</dt>
      <dd className="text-slate-800">{value}</dd>
    </div>
  );
}

const money = (pence: number | null | undefined, symbol: string, whenEmpty = 'Free'): string =>
  pence == null || pence <= 0 ? whenEmpty : `${symbol}${(pence / 100).toFixed(2)}`;

const minutes = (value: number | null | undefined): string => (value == null ? 'Not set' : `${value} min`);

function paymentWords(requirement: string | null | undefined): string {
  if (requirement === 'deposit') return 'A deposit when booking';
  if (requirement === 'full_payment') return 'Paid in full when booking';
  if (requirement === 'card_hold') return 'A card held for no-shows';
  return 'Nothing to pay online';
}

function formatDay(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
