'use client';

import type { StaffBookingLocationView } from '@/lib/booking/staff-booking-location';

/**
 * Staff-facing "where is this happening" callout for a booking that is not at the business venue.
 *
 * Deliberately a callout rather than another label/value row: a staff member reading a booking for
 * an off-site or online appointment needs the location before anything else, and the previous
 * treatment put it in the same visual weight as "Source" and "Checked in".
 *
 * Render nothing when `view` is null (business venue, or a legacy booking with no snapshot).
 */
export function BookingLocationCallout({
  view,
  dense = false,
}: {
  view: StaffBookingLocationView | null;
  /** Popover and compact contexts: tighter padding and type, same content. */
  dense?: boolean;
}) {
  if (!view) return null;

  const pad = dense ? 'px-2.5 py-2' : 'px-3 py-2.5';
  const heading = dense ? 'text-[10px]' : 'text-[11px]';
  const body = dense ? 'text-[11px]' : 'text-xs';

  if (view.kind === 'online') {
    return (
      <div className={`rounded-lg border border-sky-200 bg-sky-50/80 ${pad}`}>
        <p className={`${heading} font-semibold uppercase tracking-wide text-sky-900`}>
          Online appointment
        </p>
        {view.joinUrl ? (
          <a
            href={view.joinUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`mt-1 block break-all font-medium text-sky-900 underline underline-offset-2 hover:text-sky-950 ${body} [overflow-wrap:anywhere]`}
          >
            {view.joinUrl}
          </a>
        ) : (
          <p className={`mt-1 font-medium text-amber-800 ${body}`}>
            No meeting link is set for this service. Add one in Services so the client receives it.
          </p>
        )}
        {view.joinInfo ? (
          <p className={`mt-1.5 whitespace-pre-line leading-snug text-sky-950/90 ${body}`}>
            {view.joinInfo}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className={`rounded-lg border border-emerald-200 bg-emerald-50/80 ${pad}`}>
      <p className={`${heading} font-semibold uppercase tracking-wide text-emerald-900`}>
        At the client&apos;s address
      </p>
      {view.address && view.mapsUrl ? (
        <>
          <a
            href={view.mapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`mt-1 block font-medium leading-snug text-emerald-950 underline underline-offset-2 hover:text-emerald-800 ${body} [overflow-wrap:anywhere]`}
          >
            {view.address}
          </a>
          <p className={`mt-0.5 text-emerald-800/80 ${dense ? 'text-[10px]' : 'text-[11px]'}`}>
            Tap the address to open Google Maps for directions.
          </p>
        </>
      ) : (
        <p className={`mt-1 font-medium text-amber-800 ${body}`}>
          {view.gap === 'address_hidden'
            ? 'The address is hidden because this booking belongs to a linked venue.'
            : 'No address was recorded. Contact the client to confirm where to go.'}
        </p>
      )}
    </div>
  );
}
