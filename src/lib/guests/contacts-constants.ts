export const CONTACTS_SORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'last_visit_desc', label: 'Last visit (newest)' },
  { value: 'last_visit_asc', label: 'Last visit (oldest)' },
  { value: 'name_asc', label: 'Name (A–Z)' },
  { value: 'name_desc', label: 'Name (Z–A)' },
  { value: 'visit_count_desc', label: 'Most visits' },
  { value: 'paid_deposit_desc', label: 'Paid deposits (high → low)' },
  { value: 'created_desc', label: 'Recently added' },
];

export const CONTACTS_LIFECYCLE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All contacts' },
  { value: 'upcoming', label: 'Has upcoming booking' },
  { value: 'lapsed', label: 'Lapsed (90+ days since last visit)' },
  { value: 'new_this_month', label: 'New this month' },
  { value: 'vip', label: 'VIP only' },
];
