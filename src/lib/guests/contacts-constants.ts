export const CONTACTS_SORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'last_visit_desc', label: 'Last visit (newest)' },
  { value: 'last_visit_asc', label: 'Last visit (oldest)' },
  { value: 'name_asc', label: 'Name (A to Z)' },
  { value: 'name_desc', label: 'Name (Z to A)' },
  { value: 'visit_count_desc', label: 'Most visits' },
  { value: 'created_desc', label: 'Recently added' },
];

/** Directory segment filters (see `ContactsSegment` in guest-contacts-list). */
export const CONTACTS_SEGMENT_OPTIONS: Array<{ value: string; label: string; description?: string }> = [
  { value: 'all', label: 'Everyone', description: 'No extra rules. Show everyone allowed by Who to include above.' },
  {
    value: 'new',
    label: 'New this period',
    description: 'Added within your dates below. Leave dates blank to use this calendar month through today.',
  },
  {
    value: 'upcoming',
    label: 'Has an upcoming visit',
    description: 'Must have a future booking in the date range below. Leave dates blank to look one year ahead from today.',
  },
  {
    value: 'visit',
    label: 'By last visit',
    description:
      'Only contacts with a saved last visit date in the range below (completed visits through today). Set at least one date.',
  },
  {
    value: 'marketing',
    label: 'Marketing consent',
    description: 'Filter by subscribed or not. Optionally narrow by when consent was recorded.',
  },
  {
    value: 'last_staff',
    label: 'Last booking staff member',
    description: 'Their latest booking used this staff member. Optionally narrow by when that booking happened.',
  },
  {
    value: 'last_service',
    label: 'Last booked service',
    description: 'Their latest booking included this service. Optionally narrow by when that booking happened.',
  },
  {
    value: 'tag',
    label: 'Filter by tag',
    description: 'Show contacts who have a specific tag. Pick a suggestion or type any tag; matching is not case sensitive.',
  },
];

/** @deprecated Legacy lifecycle URL keys; prefer `segment`. */
export const CONTACTS_LIFECYCLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All contacts' },
  { value: 'upcoming', label: 'Has upcoming booking' },
  { value: 'lapsed', label: 'Lapsed (90+ days since last visit)' },
  { value: 'new_this_month', label: 'New this month' },
  { value: 'vip', label: 'VIP only' },
];
