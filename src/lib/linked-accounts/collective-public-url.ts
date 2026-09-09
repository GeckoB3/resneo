import type { CollectiveView } from './collectives';

/** The parts of a collective view that decide where its combined page is served. */
export type CollectiveAddressSource = Pick<CollectiveView, 'slug' | 'slugStrategy' | 'adoptedVenueId'> & {
  members: Pick<CollectiveView['members'][number], 'venueId' | 'venueSlug'>[];
};

/**
 * The path guests use to reach the combined page: a member venue's own booking
 * address when the collective adopted it (and that member still has a slug),
 * otherwise the dedicated `/book/c/{slug}` address.
 */
export function collectivePublicPath(collective: CollectiveAddressSource): string {
  const adoptedSlug =
    collective.slugStrategy === 'adopt_member' && collective.adoptedVenueId
      ? (collective.members.find((m) => m.venueId === collective.adoptedVenueId)?.venueSlug ?? null)
      : null;
  return adoptedSlug ? `/book/${adoptedSlug}` : `/book/c/${collective.slug}`;
}

/** The full address, using the browser's origin when there is one. */
export function collectivePublicUrl(collective: CollectiveAddressSource, origin?: string): string {
  const base = origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}${collectivePublicPath(collective)}`;
}
