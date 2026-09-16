'use client';

/**
 * The Collective area's Venues tab, for the host (UX spec §2 item 15 "The Venues tab"; W5).
 *
 * One row per venue and per open invitation, with the membership actions that have no other home.
 * Invite a venue links to Settings, Linked accounts: the picker, with its eligibility reasons,
 * lives there, and a second one here could disagree with it. Ask to host is offered only on the
 * shared-services model, where the engine moves the hosting (contract 8); End the collective goes
 * through the collective route, which hands a shared-services collective to the engine.
 */
import Link from 'next/link';
import { useState } from 'react';
import { Button } from '@/components/ui/primitives/Button';
import { ConfirmDialog } from '@/components/ui/primitives/ConfirmDialog';
import { Pill } from '@/components/ui/dashboard/Pill';
import { VenueSyncPill } from './CollectivePills';
import { collectiveCopy } from '@/lib/linked-accounts/collective-copy';
import { EndCollectiveSection, hostingAction } from './CollectiveHostingControls';
import { noticeDate } from '@/lib/linked-accounts/replicas/notice-dates';
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
  /** 'replicas' when hosting moves through the engine; Ask to host is only offered then. */
  serviceModel?: string;
  /** A move of hosting in progress, from the collectives list. */
  pendingHost?: { venueId: string; venueName: string; transferAt: string | null } | null;
  /** Called once the collective has ended, so the page can leave the area. */
  onEnded?: () => void;
}

type Ask = { venue: CollectiveVenueRow; kind: 'remove' | 'cancel' | 'host' | 'cancel_move' } | null;

function askTitle(ask: Ask, collective: string): string {
  if (!ask) return '';
  const venue = ask.venue.venue_name;
  if (ask.kind === 'cancel') return collectiveCopy('ov.venues.cancelTitle', { venue });
  if (ask.kind === 'host') return collectiveCopy('transfer.ask.title', { venue, collective });
  if (ask.kind === 'cancel_move') return collectiveCopy('transfer.cancel.title', { venue });
  return collectiveCopy('ov.venues.removeTitle', { venue, collective });
}

function askMessage(ask: Ask, collective: string): string {
  if (!ask) return '';
  const venue = ask.venue.venue_name;
  if (ask.kind === 'cancel') return collectiveCopy('ov.venues.cancelMessage', { venue });
  if (ask.kind === 'host') return collectiveCopy('transfer.ask.message', { venue, collective });
  if (ask.kind === 'cancel_move') return collectiveCopy('transfer.cancel.message', { venue, collective });
  return collectiveCopy('ov.venues.removeMessage', { venue, collective });
}

function askConfirm(ask: Ask): string {
  if (ask?.kind === 'cancel') return collectiveCopy('bp.members.cancelInvite');
  if (ask?.kind === 'host') return collectiveCopy('transfer.ask.confirm');
  if (ask?.kind === 'cancel_move') return collectiveCopy('transfer.cancel');
  return collectiveCopy('ov.venues.remove');
}

export function CollectiveVenuesPanel({
  collectiveId,
  collectiveName,
  venues,
  groups,
  onChanged,
  onShowHistory,
  serviceModel = 'legacy_copies',
  pendingHost = null,
  onEnded,
}: CollectiveVenuesPanelProps) {
  const [asking, setAsking] = useState<{
    venue: CollectiveVenueRow;
    kind: 'remove' | 'cancel' | 'host' | 'cancel_move';
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const moveHosting = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    const result = await hostingAction(collectiveId, body);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    onChanged();
  };

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

      {pendingHost ? (
        <p className="flex flex-wrap items-center gap-2 rounded-lg border border-brand-200 bg-brand-50/60 px-3 py-2 text-sm text-brand-950">
          {pendingHost.transferAt
            ? collectiveCopy('transfer.pending.scheduled', {
                venue: pendingHost.venueName,
                collective: collectiveName,
                date: noticeDate(pendingHost.transferAt),
              })
            : collectiveCopy('transfer.pending.asked', { venue: pendingHost.venueName })}
          <Button
            type="button"
            variant="link"
            size="sm"
            disabled={busy}
            onClick={() =>
              setAsking({
                venue: { venue_id: pendingHost.venueId, venue_name: pendingHost.venueName, status: 'active', is_host: false },
                kind: 'cancel_move',
              })
            }
          >
            {collectiveCopy('transfer.cancel')}
          </Button>
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
                {!venue.is_host && venue.status === 'active' && serviceModel === 'replicas' && !pendingHost ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => setAsking({ venue, kind: 'host' })}
                  >
                    {collectiveCopy('transfer.ask.button')}
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
        destructive={asking?.kind === 'remove' || asking?.kind === 'cancel' || asking?.kind === 'cancel_move'}
        title={askTitle(asking, collectiveName)}
        message={askMessage(asking, collectiveName)}
        confirmLabel={askConfirm(asking)}
        onConfirm={() => {
          const target = asking;
          setAsking(null);
          if (!target) return;
          if (target.kind === 'host') void moveHosting({ action: 'offer_host', venueId: target.venue.venue_id });
          else if (target.kind === 'cancel_move') void moveHosting({ action: 'cancel_host_transfer' });
          else void remove(target.venue);
        }}
      />

      <EndCollectiveSection
        collectiveId={collectiveId}
        collectiveName={collectiveName}
        onEnded={() => (onEnded ? onEnded() : onChanged())}
      />
    </section>
  );
}
