'use client';

import { useMemo, useState } from 'react';
import { BookPublicBookingFlow } from '@/components/booking/BookPublicBookingFlow';
import type { LockedPractitionerBooking } from '@/components/booking/BookingFlowRouter';
import type { VenuePublic } from '@/components/booking/types';
import type { PublicCollective } from '@/lib/linked-accounts/collectives';

interface Selection {
  venueId: string;
  /** Set when the customer chose a specific practitioner to book with. */
  locked: LockedPractitionerBooking | null;
}

function formatPrice(pence: number | null): string {
  if (pence == null) return '';
  return `£${(pence / 100).toFixed(2)}`;
}

/**
 * The combined collective booking experience (§7.1). A routing layer over the
 * per-venue `BookPublicBookingFlow`: the customer browses practitioners /
 * services across every member venue, and on selection the chosen venue's
 * normal booking flow is mounted in-page. Every booking is still a normal
 * `bookings` row in exactly one venue; `collectiveId` is passed only for
 * attribution (§7.7).
 */
export function CollectiveBookingFlow({
  collective,
  memberVenues,
  accent,
}: {
  collective: PublicCollective;
  /** venueId → VenuePublic, for members whose booking page is live. */
  memberVenues: Record<string, VenuePublic>;
  accent: string;
}) {
  const [selection, setSelection] = useState<Selection | null>(null);

  const selectedVenue = selection ? memberVenues[selection.venueId] ?? null : null;
  const selectedMember = selection
    ? collective.members.find((m) => m.venueId === selection.venueId) ?? null
    : null;

  if (selection && selectedVenue) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => setSelection(null)}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-600 hover:text-slate-900"
        >
          <span aria-hidden>←</span> Back to {collective.name}
        </button>
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="mb-4 border-b border-slate-100 pb-3">
            <h2 className="text-lg font-bold text-slate-900">
              {selectedMember?.venueName ?? selectedVenue.name}
            </h2>
            {selection.locked ? (
              <p className="text-sm text-slate-500">with {selection.locked.name}</p>
            ) : null}
          </div>
          <BookPublicBookingFlow
            venue={selectedVenue}
            lockedPractitioner={selection.locked}
            accentColour={accent}
            collectiveId={collective.id}
          />
        </div>
      </div>
    );
  }

  return collective.serviceGrouping === 'by_service_type' ? (
    <ServiceTypeBrowse
      collective={collective}
      memberVenues={memberVenues}
      accent={accent}
      onSelect={setSelection}
    />
  ) : (
    <PractitionerBrowse
      collective={collective}
      memberVenues={memberVenues}
      accent={accent}
      onSelect={setSelection}
    />
  );
}

function selectButton(accent: string, label: string, onClick: () => void) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex shrink-0 items-center justify-center rounded-lg px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:opacity-90"
      style={{ backgroundColor: accent }}
    >
      {label}
    </button>
  );
}

function PractitionerBrowse({
  collective,
  memberVenues,
  accent,
  onSelect,
}: {
  collective: PublicCollective;
  memberVenues: Record<string, VenuePublic>;
  accent: string;
  onSelect: (s: Selection) => void;
}) {
  return (
    <div className="space-y-4">
      {collective.members.map((m) => {
        const bookable = Boolean(memberVenues[m.venueId]);
        return (
          <section
            key={m.venueId}
            className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-bold text-slate-900">{m.venueName}</h2>
              {bookable ? (
                selectButton(accent, 'Book at this venue', () =>
                  onSelect({ venueId: m.venueId, locked: null }),
                )
              ) : (
                <span className="text-xs text-slate-400">Booking unavailable</span>
              )}
            </div>
            {m.practitioners.length > 0 ? (
              <ul className="mt-3 divide-y divide-slate-100">
                {m.practitioners.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                    <span className="text-sm text-slate-700">{p.name}</span>
                    {bookable
                      ? selectButton(accent, 'Book', () =>
                          onSelect({
                            venueId: m.venueId,
                            locked: p.slug
                              ? { id: p.id, name: p.name, bookingSlug: p.slug }
                              : null,
                          }),
                        )
                      : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-slate-500">
                Choose &ldquo;Book at this venue&rdquo; to see available times.
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function ServiceTypeBrowse({
  collective,
  memberVenues,
  accent,
  onSelect,
}: {
  collective: PublicCollective;
  memberVenues: Record<string, VenuePublic>;
  accent: string;
  onSelect: (s: Selection) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<
      string,
      { name: string; offers: { venueId: string; venueName: string; price: number | null }[] }
    >();
    for (const m of collective.members) {
      for (const s of m.services) {
        const key = s.name.toLowerCase().trim();
        const group = map.get(key) ?? { name: s.name, offers: [] };
        group.offers.push({
          venueId: m.venueId,
          venueName: m.venueName,
          price: s.pricePence,
        });
        map.set(key, group);
      }
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [collective.members]);

  if (groups.length === 0) {
    return (
      <section className="rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500 shadow-sm">
        No services are currently published for this collective.
      </section>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <section
          key={group.name}
          className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
        >
          <h2 className="text-base font-bold text-slate-900">{group.name}</h2>
          <ul className="mt-3 divide-y divide-slate-100">
            {group.offers.map((offer) => {
              const bookable = Boolean(memberVenues[offer.venueId]);
              return (
                <li
                  key={`${group.name}-${offer.venueId}`}
                  className="flex items-center justify-between gap-2 py-2"
                >
                  <span className="text-sm text-slate-700">
                    {offer.venueName}
                    {offer.price != null ? (
                      <span className="ml-2 text-xs text-slate-500">
                        {formatPrice(offer.price)}
                      </span>
                    ) : null}
                  </span>
                  {bookable ? (
                    selectButton(accent, 'Book', () =>
                      onSelect({ venueId: offer.venueId, locked: null }),
                    )
                  ) : (
                    <span className="text-xs text-slate-400">Unavailable</span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
