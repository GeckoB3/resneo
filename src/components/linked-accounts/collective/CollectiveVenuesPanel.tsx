'use client';

/**
 * The Collective area's Venues tab, for the host (UX spec §2 item 15 "The Venues tab"; W5).
 *
 * One row per venue and per open invitation, with the membership actions that have no other home.
 * What this tab deliberately does not offer yet, and why:
 *   - Invite a venue: the picker, with its eligibility reasons, lives on Settings, Linked accounts,
 *     so this links there rather than building a second one that could disagree with it.
 *   - Ask to host and End the collective: on the shared-services model these go through the
 *     engine's host transfer and dissolve (contracts 7 and 8), which have no route yet. The older
 *     routes write the host directly, which the engine's locks refuse, so they are not offered.
 */
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/primitives/Button';
import { ConfirmDialog } from '@/components/ui/primitives/ConfirmDialog';
import { Pill } from '@/components/ui/dashboard/Pill';
import { VenueSyncPill } from './CollectivePills';
import { collectiveCopy } from '@/lib/linked-accounts/collective-copy';
import type { CollectiveCalendarGroup } from '@/lib/linked-accounts/replicas/host-calendars';

export interface CollectiveVenueRow {
  venue_id: string;
  venue_name: string;
  status: 'active' | 'invited';
  is_host: boolean;
}

export interface CollectiveVenuesPanelProps {
  collectiveId: string;
  collectiveName: string;
  venues: CollectiveVenueRow[];
  /** The health of each venue that has calendars on the page, by venue id. */
  groups: CollectiveCalendarGroup[];
  onChanged: () => void;
  onShowHistory: (venueId: string) => void;
}

export function CollectiveVenuesPanel({
  collectiveId,
  collectiveName,
  venues,
  groups,
  onChanged,
  onShowHistory,
}: CollectiveVenuesPanelProps) {
  const [asking, setAsking] = useState<{ venue: CollectiveVenueRow; kind: 'remove' | 'cancel' } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const remove = async (venue: CollectiveVenueRow) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/venue/collectives/${collectiveId}/members`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove', venueId: venue.venue_id }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? 'That did not go through. Please try again.');
        return;
      }
      onChanged();
    } catch {
      setError('That did not go through. Please check your connection.');
    } finally {
      setBusy(false);
    }
  };

  const ordered = [...venues].sort((a, b) =>
    a.is_host === b.is_host
      ? a.status === b.status
        ? a.venue_name.localeCompare(b.venue_name)
        : a.status === 'active'
          ? -1
          : 1
      : a.is_host
        ? -1
        : 1,
  );

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">Venues</h2>
        <Link
          href="/dashboard/settings?tab=linked-accounts"
          className="text-sm font-medium text-brand-700 underline underline-offset-2"
        >
          {collectiveCopy('ov.venues.invite')}
        </Link>
      </div>

      {error ? (
        <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {error}
        </p>
      ) : null}

      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
        {ordered.map((venue) => {
          const group = groups.find((g) => g.venue_id === venue.venue_id) ?? null;
          const failed = (group?.sync.failed.length ?? 0) > 0;
          const behind = (group?.sync.pending.length ?? 0) > 0;
          return (
            <li key={venue.venue_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm">
              <span className="font-medium text-slate-900">
                {venue.venue_name}
                {venue.status === 'invited' ? ` ${collectiveCopy('ov.venues.invited')}` : ''}
              </span>
              <Pill variant={venue.is_host ? 'brand' : 'neutral'} size="sm">
                {venue.is_host ? collectiveCopy('ov.venues.host') : collectiveCopy('ov.venues.member')}
              </Pill>
              {venue.status === 'active' && group ? (
                <VenueSyncPill
                  status={failed ? 'failed' : behind ? 'updating' : 'up_to_date'}
                  reason={failed ? group.sync.failed[0]!.message : null}
                />
              ) : null}
              <span className="ml-auto flex flex-wrap items-center gap-2">
                {venue.status === 'active' ? (
                  <Button type="button" variant="link" size="sm" onClick={() => onShowHistory(venue.venue_id)}>
                    {collectiveCopy('bp.members.history')}
                  </Button>
                ) : null}
                {!venue.is_host && venue.status === 'active' ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => setAsking({ venue, kind: 'remove' })}
                  >
                    {collectiveCopy('ov.venues.remove')}
                  </Button>
                ) : null}
                {venue.status === 'invited' ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => setAsking({ venue, kind: 'cancel' })}
                  >
                    {collectiveCopy('bp.members.cancelInvite')}
                  </Button>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>

      <ConfirmDialog
        open={asking !== null}
        onOpenChange={(open) => {
          if (!open) setAsking(null);
        }}
        title={
          asking?.kind === 'cancel'
            ? collectiveCopy('ov.venues.cancelTitle', { venue: asking.venue.venue_name })
            : collectiveCopy('ov.venues.removeTitle', {
                venue: asking?.venue.venue_name ?? '',
                collective: collectiveName,
              })
        }
        message={
          asking?.kind === 'cancel'
            ? collectiveCopy('ov.venues.cancelMessage', { venue: asking.venue.venue_name })
            : collectiveCopy('ov.venues.removeMessage', {
                venue: asking?.venue.venue_name ?? '',
                collective: collectiveName,
              })
        }
        confirmLabel={
          asking?.kind === 'cancel' ? collectiveCopy('bp.members.cancelInvite') : collectiveCopy('ov.venues.remove')
        }
        onConfirm={() => {
          const target = asking;
          setAsking(null);
          if (target) void remove(target.venue);
        }}
      />
    </section>
  );
}
