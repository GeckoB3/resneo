'use client';

/**
 * What the Services page says at the top when the venue shares a page with others (UX spec §2
 * items 1 and 3; W5).
 *
 * A host and a member read different things, because they can do different things: the host's
 * services are the collective's services, while a member's own services are parked. Both are told
 * what happens to the services that are not on the page, because that is the part people are
 * surprised by.
 */
import Link from 'next/link';
import { collectiveCopy, formatVenueList } from '@/lib/linked-accounts/collective-copy';

export interface CollectiveServicesBannerProps {
  variant: 'host' | 'member';
  collectiveName: string;
  hostVenueName: string;
  /** The other venues on the page, for "the change reaches ...". */
  memberNames?: string[];
  /** The collective's public page, when it is live. */
  publicPath?: string | null;
  /** A host whose invitations nobody has accepted yet has no members to reach. */
  invitedOnly?: boolean;
  /** Venues that have not caught up, so the host is told before a guest notices. */
  behindVenueNames?: string[];
  onRetry?: () => void;
}

export function CollectiveServicesBanner({
  variant,
  collectiveName,
  hostVenueName,
  memberNames = [],
  publicPath = null,
  invitedOnly = false,
  behindVenueNames = [],
  onRetry,
}: CollectiveServicesBannerProps) {
  const isHost = variant === 'host';
  return (
    <section className="rounded-xl border border-brand-200 bg-brand-50/60 px-4 py-3">
      <h2 className="text-sm font-semibold text-brand-900">
        {isHost
          ? collectiveCopy('svc.host.banner.title', { collective: collectiveName })
          : collectiveCopy('svc.member.banner.title', { collective: collectiveName })}
      </h2>
      <p className="mt-1 text-sm text-brand-950/80">
        {isHost
          ? invitedOnly
            ? collectiveCopy('svc.host.banner.invitedOnly', { collective: collectiveName })
            : collectiveCopy('svc.host.banner.body', {
                collective: collectiveName,
                venueList: formatVenueList(memberNames),
              })
          : collectiveCopy('svc.member.banner.body', { collective: collectiveName, host: hostVenueName })}
      </p>
      {behindVenueNames.length > 0 ? (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-amber-900">
          {collectiveCopy('svc.host.banner.behind', { venue: formatVenueList(behindVenueNames) })}
          {onRetry ? (
            <button type="button" onClick={onRetry} className="font-semibold text-brand-700 underline underline-offset-2">
              {collectiveCopy('svc.host.banner.retry')}
            </button>
          ) : null}
        </p>
      ) : null}
      {publicPath ? (
        <p className="mt-2 text-sm">
          <Link href={publicPath} className="font-medium text-brand-700 underline underline-offset-2">
            {collectiveCopy('svc.host.banner.viewPage', { collective: collectiveName })}
          </Link>
        </p>
      ) : null}
    </section>
  );
}

export type CollectiveServicesFilterValue = 'all' | 'on_page' | 'parked';

/**
 * Show all services, only the ones on the page, or only the parked ones (UX spec §2 item 1). The
 * order of services is the collective page's own order, so it can only be changed with every
 * service in view.
 */
export function CollectiveServicesFilter({
  value,
  onChange,
  collectiveName,
  counts,
  reorderHidden = false,
}: {
  value: CollectiveServicesFilterValue;
  onChange: (next: CollectiveServicesFilterValue) => void;
  collectiveName: string;
  counts?: Partial<Record<CollectiveServicesFilterValue, number>>;
  /** True when a filter is hiding the drag handles, so the page says why. */
  reorderHidden?: boolean;
}) {
  const label = (text: string, key: CollectiveServicesFilterValue) =>
    counts?.[key] === undefined ? text : `${text} (${counts[key]})`;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label htmlFor="collective-service-filter" className="text-slate-600">
        {collectiveCopy('svc.filter.label')}
      </label>
      <select
        id="collective-service-filter"
        value={value}
        onChange={(e) => onChange(e.target.value as CollectiveServicesFilterValue)}
        className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-sm text-slate-800"
      >
        <option value="all">{label(collectiveCopy('svc.filter.all'), 'all')}</option>
        <option value="on_page">
          {label(collectiveCopy('common.srOnly.collective', { collective: collectiveName }), 'on_page')}
        </option>
        <option value="parked">{label(collectiveCopy('common.pill.parked'), 'parked')}</option>
      </select>
      {reorderHidden ? <span className="text-xs text-slate-500">{collectiveCopy('svc.filter.reorderOff')}</span> : null}
    </div>
  );
}
