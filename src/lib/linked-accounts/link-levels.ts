/**
 * The three levels of link the setup wizard offers (Docs/link-and-collective-setup-wizard-plan.md,
 * decision L2).
 *
 * The permission model underneath has three dimensions per direction (spec §5). A new owner does not
 * think in those terms, so the wizard asks one question, "how closely will you work together?", and
 * maps the answer onto the same grant for both directions. "Customise" opens the full editor, and a
 * pair that matches no preset reads back as `custom`.
 */
import { normaliseGrant } from './permissions';
import type { LinkGrant } from './types';

export type LinkLevelId = 'view' | 'manage' | 'full';

export interface LinkLevel {
  id: LinkLevelId;
  title: string;
  /** One line under the title. */
  summary: string;
  /** What each venue will be able to do, in the recipient's words. */
  bullets: string[];
  grant: LinkGrant;
  /** Only full access, both ways and with no calendar limits, can carry a collective. */
  unlocksCollective: boolean;
}

export const LINK_LEVELS: readonly LinkLevel[] = [
  {
    id: 'view',
    title: "See each other's diaries",
    summary: 'Each venue sees the other’s calendar in full, but cannot change anything.',
    bullets: ['See each other’s bookings, services and times', 'No client names or contact details', 'No changes to bookings'],
    grant: { calendar: 'full_details', pii: false, act: 'none' },
    unlocksCollective: false,
  },
  {
    id: 'manage',
    title: "Manage each other's bookings",
    summary: 'Each venue can see client details and change bookings that already exist.',
    bullets: ['See each other’s bookings and client details', 'Move, edit or change existing bookings', 'No new bookings for each other'],
    grant: { calendar: 'full_details', pii: true, act: 'edit_existing' },
    unlocksCollective: false,
  },
  {
    id: 'full',
    title: 'Work as one team',
    summary: 'Each venue can book, change and cancel appointments in the other’s calendar.',
    bullets: [
      'See each other’s bookings and client details',
      'Make, move and cancel bookings for each other',
      'The only level that can run a shared booking page (a collective)',
    ],
    grant: { calendar: 'full_details', pii: true, act: 'create_edit_cancel' },
    unlocksCollective: true,
  },
];

export const DEFAULT_LINK_LEVEL: LinkLevelId = 'full';

export function linkLevel(id: LinkLevelId): LinkLevel {
  return LINK_LEVELS.find((l) => l.id === id) ?? LINK_LEVELS[LINK_LEVELS.length - 1]!;
}

/** The grant a level gives, as a fresh object so callers may edit it. */
export function grantForLevel(id: LinkLevelId): LinkGrant {
  return { ...linkLevel(id).grant, calendarIds: null };
}

function sameGrant(a: LinkGrant, b: LinkGrant): boolean {
  const x = normaliseGrant(a);
  const y = normaliseGrant(b);
  const xScope = x.calendarIds && x.calendarIds.length > 0 ? x.calendarIds : null;
  const yScope = y.calendarIds && y.calendarIds.length > 0 ? y.calendarIds : null;
  return x.calendar === y.calendar && x.pii === y.pii && x.act === y.act && xScope === null && yScope === null;
}

/** Which preset a pair of grants is, or `custom` when the two directions differ or match none. */
export function levelForGrants(mine: LinkGrant, theirs: LinkGrant): LinkLevelId | 'custom' {
  for (const level of LINK_LEVELS) {
    if (sameGrant(mine, level.grant) && sameGrant(theirs, level.grant)) return level.id;
  }
  return 'custom';
}

/** Full calendar detail and create, edit and cancel, both ways, with no calendar limits: the collective gate. */
export function isFullAccessBothWays(mine: LinkGrant, theirs: LinkGrant): boolean {
  return sameGrant(mine, linkLevel('full').grant) && sameGrant(theirs, linkLevel('full').grant);
}
