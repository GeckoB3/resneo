'use client';

/**
 * The badges that say what a service is to a collective (UX spec §0.3; W5).
 *
 * Five small pills, used by the host's Services page, the member's, the calendar cards and the
 * grid, so the same fact never wears two labels. The text always carries the state: colour is a
 * second signal, never the only one, and anything a colour alone would say is in the sr-only text.
 */
import type { ReactNode } from 'react';
import { Pill } from '@/components/ui/dashboard/Pill';
import { collectiveCopy } from '@/lib/linked-accounts/collective-copy';
import type { CollectiveServiceStatus } from '@/lib/linked-accounts/replicas/status';

/** A host's service that is on the collective page. */
export function CollectivePill({ collectiveName }: { collectiveName: string }) {
  return (
    <Pill variant="brand" size="sm" dot>
      {collectiveCopy('common.pill.collective')}
      <span className="sr-only">
        {' '}
        {collectiveCopy('common.srOnly.collective', { collective: collectiveName })}
      </span>
    </Pill>
  );
}

/** A member's copy of a service the host manages. */
export function FromHostPill({ hostName }: { hostName: string }) {
  return (
    <Pill variant="info" size="sm">
      <LockIcon />
      {collectiveCopy('common.pill.fromHost', { host: hostName })}
    </Pill>
  );
}

/**
 * A venue's own service, not on the page, so nobody can book it while the collective is live. On a
 * venue's own page the venue is the reader, so the name defaults to "your venue".
 */
export function ParkedPill({ venueName = 'your venue', collectiveName }: { venueName?: string; collectiveName: string }) {
  return (
    <Pill variant="neutral" size="sm">
      {collectiveCopy('common.pill.parked')}
      <span className="sr-only">
        {' '}
        {collectiveCopy('common.srOnly.parked', { venue: venueName, collective: collectiveName })}
      </span>
    </Pill>
  );
}

/** A copy of a service the host has taken off the page: it keeps its bookings, takes no new ones. */
export function RetiredPill() {
  return (
    <Pill variant="neutral" size="sm">
      {collectiveCopy('common.pill.retired')}
    </Pill>
  );
}

const SYNC_PILL: Record<CollectiveServiceStatus, { label: string; variant: 'success' | 'info' | 'danger' | 'warning'; dot?: boolean }> = {
  up_to_date: { label: collectiveCopy('common.pill.upToDate'), variant: 'success' },
  updating: { label: collectiveCopy('common.pill.updating'), variant: 'info', dot: true },
  setting_up: { label: collectiveCopy('common.pill.settingUp'), variant: 'info', dot: true },
  failed: { label: collectiveCopy('common.pill.couldNotUpdate'), variant: 'danger' },
  hidden: { label: collectiveCopy('common.pill.hidden'), variant: 'warning' },
  paused: { label: collectiveCopy('common.pill.paused'), variant: 'warning' },
};

/**
 * How a service's copies are doing, in one word, with the explaining sentence from the API as the
 * pill's title so the reason is never invented twice.
 */
export function VenueSyncPill({
  status,
  reason,
  className = '',
}: {
  status: CollectiveServiceStatus;
  reason?: string | null;
  className?: string;
}) {
  const pill = SYNC_PILL[status];
  return (
    <span title={reason ?? undefined} className={className}>
      <Pill variant={pill.variant} size="sm" dot={pill.dot}>
        {pill.label}
      </Pill>
      {reason ? <span className="sr-only"> {reason}</span> : null}
    </span>
  );
}

/**
 * The sentence under a control that says how far a change reaches (UX spec §0.2). Every control
 * that writes a fact other venues see shows one, in the same visual group as the control.
 */
export function EditReachNote({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p className={`mt-1.5 flex items-start gap-1.5 text-xs text-slate-500 ${className}`}>
      <GlobeIcon />
      <span>{children}</span>
    </p>
  );
}

function LockIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3 w-3 shrink-0" fill="currentColor">
      <path d="M8 1a3 3 0 0 0-3 3v2H4.5A1.5 1.5 0 0 0 3 7.5v6A1.5 1.5 0 0 0 4.5 15h7a1.5 1.5 0 0 0 1.5-1.5v-6A1.5 1.5 0 0 0 11.5 6H11V4a3 3 0 0 0-3-3Zm1.5 5h-3V4a1.5 1.5 0 0 1 3 0v2Z" />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="mt-0.5 h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.3">
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c1.6 1.8 2.4 3.8 2.4 6S9.6 12.2 8 14c-1.6-1.8-2.4-3.8-2.4-6S6.4 3.8 8 2Z" />
    </svg>
  );
}
