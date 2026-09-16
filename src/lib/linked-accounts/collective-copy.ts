/**
 * Every word the collective surfaces say (UX spec §5, the copy deck; W5).
 *
 * One home for these strings, so a host and a member never read two different sentences about the
 * same fact, and so the wording can be reviewed in one place rather than hunted through components.
 * Placeholders are `{braces}` and filled by `collectiveCopy`; a placeholder left unfilled is a bug
 * the unit test catches, not something a venue should ever read.
 *
 * House style (CLAUDE.md): plain, warm, second person, short sentences, and no em-dashes anywhere.
 */

export const COLLECTIVE_COPY = {
  // Badges (CollectivePills.tsx)
  'common.pill.collective': 'Collective',
  'common.srOnly.collective': 'On the {collective} page',
  'common.pill.fromHost': 'From {host}',
  'common.pill.parked': 'Parked',
  'common.srOnly.parked': 'Not bookable while {venue} is part of {collective}',
  'common.pill.retired': 'Retired',
  'common.pill.settingUp': 'Setting up',
  'common.pill.updating': 'Updating',
  'common.pill.upToDate': 'Up to date',
  'common.pill.couldNotUpdate': 'Could not update',
  'common.pill.paused': 'Paused',
  // Added while building the pill: the deck's `svc.card.hiddenAt` names a venue, and the pill
  // itself often stands where no single venue can be named. The reason sentence says where.
  'common.pill.hidden': 'Hidden',
  'common.pill.turnedOffByHost': 'Turned off by {host}',

  // Reach lines (EditReachNote)
  'reach.host.master': 'This service is on the {collective} page. Saving updates it at {venueList}.',
  'reach.host.parked':
    'This service is not on the {collective} page, so it is parked: nobody can book it while {collective} is live. Bookings already made are not changed.',
  'reach.member.replica':
    '{host} manages this service for {collective}. You choose which of your calendars offer it. For anything else, ask {host}.',
  'reach.member.parked':
    'This service is parked while you are part of {collective}, so nobody can book it, your team included. Bookings already made are not changed. You can edit it, and it is bookable again as soon as you leave.',
  'reach.calendar.values': 'These values apply to {calendar} at {venue} only, wherever it is booked.',
  'reach.member.calendarTicks':
    'Ticking a service adds this calendar to it on the {collective} page. Unticking takes it off.',
  'reach.staff.toggles': 'Your choice updates the {collective} page straight away.',

  // Services page, host (AppointmentServicesView.tsx)
  'svc.host.banner.title': 'You host {collective}',
  'svc.host.banner.body':
    'Services marked Collective are on the {collective} page. When you save one, the change reaches {venueList}. Your other services are parked while {collective} is live: nobody can book them, but bookings already made are not changed.',
  'svc.host.banner.invitedOnly':
    'You host {collective}. When venues accept your invitation, the services you put on the page are set up in their accounts.',
  'svc.host.banner.viewPage': 'View the {collective} page',
  'svc.host.banner.behind': '{venue} has not received your latest changes yet.',
  'svc.host.banner.retry': 'Retry',
  'svc.host.emptyCollective': 'Services you add can be put on the {collective} page.',
  'svc.filter.label': 'Show',
  'svc.filter.all': 'All services',
  'svc.filter.reorderOff': 'Show all services to change their order.',
  'svc.card.updatingAt': 'Updating at {venue}',
  'svc.card.failedAt': 'Could not update at {venue}',
  'svc.card.failedDetail': '{venue}: {reason}',
  'svc.card.hiddenAt': 'Hidden at {venue}',
  'svc.card.inactiveOffered': 'Turned off, so it is hidden on the {collective} page and at {venueList}.',
  'svc.card.noCalendars': 'No calendars offer this yet, so guests cannot book it.',
  'svc.card.parked': 'Parked while {collective} is live. Put it on the page to take bookings for it.',

  // Services page, member (AppointmentServicesView.tsx)
  'svc.member.subtitle':
    'Services from {host} are managed by {host}. You choose which of your calendars offer them.',
  'svc.member.banner.title': 'You are part of {collective}',
  'svc.member.banner.body':
    '{host} manages the services on the {collective} page, including their prices, deposits and forms. You choose which of your calendars offer each one. Your other services are parked while you are part of {collective}, so nobody can book them until you leave.',
  'svc.member.banner.leave': 'Leaving {collective}',
  'svc.member.section.fromHostCaption': 'Managed by {host} for {collective}',
  'svc.member.section.retired': 'No longer offered by {host}',
  'svc.member.section.retiredCaption':
    '{host} took these off the {collective} page. They cannot be booked. Bookings already made are not changed.',
  'svc.member.section.parkedTitle': 'Parked while you are part of {collective}',
  'svc.member.section.parkedCaption':
    'Yours to edit, but nobody can book these while you are part of {collective}. Bookings already made are not changed. To offer one now, suggest it to {host}.',
  'svc.member.card.view': 'View',
  'svc.member.card.settingUp': 'Setting up. Guests can book it on your calendars once this finishes.',
  'svc.member.card.updating': 'Updating from {host}. Guests can book it on your calendars again in a moment.',
  'svc.member.card.failed':
    'This service is not up to date with {host}, so guests cannot book it on your calendars. {host} has been told.',
  'svc.member.card.noStripe':
    'Guests cannot book this online with you until you connect Stripe, because it takes {paymentKind}.',
  'svc.member.card.connectStripe': 'Connect Stripe',
  'svc.member.card.formsOff':
    'This service asks for {forms}. Turn on compliance records so your calendars can offer it online.',
  'svc.member.card.turnOn': 'Turn on',
  'svc.member.card.noCalendars': 'None of your calendars offer this yet.',
  'svc.member.card.cameFrom': 'Came from {host}',
  'svc.member.view.lastUpdated': 'Last updated from {host} {relativeTime}',
  'svc.member.view.calendarsHeading': 'Your calendars that offer this service',
  'svc.member.view.calendarsHelp': 'When you save, ticked calendars offer {service} on the {collective} page.',
  'svc.member.view.linkLabel': 'Link for your calendars',
  'svc.member.view.hostHeading': 'What {host} has set',
  'svc.member.view.retiredNote':
    '{host} has taken this off the {collective} page. It takes no new bookings, and the bookings you already have are not changed.',
  'svc.member.section.fromHostTitle': 'From {host}',

  // The service form (AppointmentServiceFormFields.tsx)
  'svc.form.location.linkLabel': 'Link for your calendars',
  'svc.form.location.infoLabel': 'Joining information for your clients',
  'svc.form.location.linkHelp': 'Each venue adds its own link for its own calendars.',
  'svc.form.staffOnly.label': 'Staff bookings only',
  'svc.form.staffOnly.help':
    'Your team can book this from the diary. Guests do not see it on your booking page.',
  'svc.form.staffOnly.help.collective':
    'Teams at every venue in {collective} can book this from the diary. Guests do not see it on the {collective} page.',
  'svc.form.staffMay.nameLocked':
    'Not available for services on the {collective} page, so guests see the same name and description on every calendar.',
  'svc.form.staffMay.reach':
    'These apply to every calendar that offers this service, including calendars at {venueList}.',
  'svc.form.footerReach': 'Saving updates {service} at every venue in {collective}.',

  // The save summary, the undo and the stale ask
  'svc.save.allDone': 'Saved. {service} is up to date at {venueList}.',
  'svc.save.pending':
    'Saved. {venue} is updating. Its calendars take new bookings for {service} again in a moment.',
  'svc.save.failed': 'Saved here, but {venue} could not be updated yet: {reason}. We will keep trying.',
  'svc.save.retry': 'Retry now',
  'svc.save.calendarFailed': '{calendar} at {venue} could not be changed: {reason}.',
  'sync.reason.busy': '{venue} was busy. We will try again in a moment.',
  'sync.reason.subscription': "{venue}'s subscription has lapsed.",
  'sync.reason.unknown': 'something went wrong on our side',
  'ov.undo.offer': 'Put it back',
  'ov.undo.done': 'We put {service} back to how it was, at every venue.',
  'ov.undo.expired':
    'That change is now part of your history, so it cannot be undone here. Edit the service to change it again.',
  'svc.stale.title': '{service} changed while you were editing',
  'svc.stale.message':
    'Someone saved a change to {service} after you opened it. Reload it to see the latest version, then make your change again.',
  'svc.stale.confirm': 'Reload service',

  // CollectiveCalendarsSection
  'svc.cal.heading': 'Calendars that offer this service',
  'svc.cal.help.collective':
    'Tick the calendars that should offer this service, at any venue in {collective}.',
  'svc.cal.venueYou': '{venue} (you)',
  'svc.cal.noCalendars': '{venue} has no active calendars yet.',
  'svc.cal.notSaved.add': 'Not saved yet',
  'svc.cal.notSaved.remove': 'Not saved yet: will stop offering',
  'svc.cal.editValues': 'Edit values',
  'svc.cal.chip.price': 'Custom price {price}',
  'svc.cal.chip.length': 'Custom length {minutes} min',
  'svc.cal.chip.buffer': 'Custom buffer {minutes} min',
  'svc.cal.chip.deposit': 'Custom deposit {price}',
  'svc.cal.chip.colour': 'Custom colour',
  'svc.cal.chip.name': 'Custom name',
  'svc.cal.lastChanged': 'Last changed by {venue}, {date}',
  'svc.cal.compare': 'Compare values for every calendar',
  'svc.cal.compare.standard': 'Standard',
  'svc.cal.inactiveOther': '(not available: calendar turned off at {venue})',
  'svc.cal.warn.noStripe':
    '{venue} cannot take card payments yet, so guests cannot book its calendars for this service online. Its team can still book it.',
  'svc.cal.warn.formsOff':
    '{venue} has forms switched off, so its calendars are hidden for this service until it turns them on.',
  'svc.cal.warn.suspended':
    "{venue}'s subscription has lapsed, so its calendars are hidden from the {collective} page until it is put right.",
  'svc.cal.warn.settingUp': 'Setting up at {venue}. Its calendars can take bookings once this finishes.',
  'svc.cal.warn.failed': 'Could not update at {venue}: {reason}.',

  // "What needs you" (collective-todos.ts)
  'ov.todo.heading': 'What needs you',
  'ov.todo.noCalendars': '{service} is on the page but no calendar offers it, so guests cannot book it.',
  'ov.todo.newVenue': '{venue} has joined. Choose their calendars on {count} services.',
  'ov.todo.newVenueOne': '{venue} has joined. Choose their calendars on {count} service.',
  'ov.todo.failed': '{count} services could not be updated at {venue}.',
  'ov.todo.failedOne': '{count} service could not be updated at {venue}.',
  'ov.todo.noStripe':
    '{venue} cannot take card payments yet, so {count} paid services are hidden from guests there.',
  'ov.todo.noStripeOne':
    '{venue} cannot take card payments yet, so {count} paid service is hidden from guests there.',
  'ov.todo.formsOff':
    '{venue} has forms switched off, so {count} services that need a form are hidden from guests there.',
  'ov.todo.formsOffOne':
    '{venue} has forms switched off, so {count} service that needs a form is hidden from guests there.',
  'svc.offer.chooseCalendars': 'Choose calendars',

  // The Collective area (CollectiveAreaClient.tsx; UX spec §2 item 15)
  'ov.subtitle': 'Who is in it, what is on the page, and which calendars offer what.',
  'ov.venue.counts': '{services} services, {calendars} calendars on the page',
  'ov.venue.upToDate': 'Up to date with the page.',
  'ov.venue.updating': 'Updating. Its calendars take new bookings again in a moment.',
  'ov.venue.failed': 'An update did not go through.',

  // The services grid and its bulk lane (CollectiveServicesGrid.tsx; UX spec §2 item 15)
  'ov.filter.all': 'All services',
  'ov.filter.attention': 'Needs attention',
  'ov.filter.offPage': 'Not on the page',
  'ov.bulk.selected': '{services} services at {venues} venues selected',
  'ov.bulk.offer': 'Put on the page',
  'ov.bulk.withdraw': 'Take off the page',
  'ov.bulk.addCalendars': 'Choose calendars',
  'ov.bulk.removeCalendars': 'Remove calendars',
  'ov.bulk.retry': 'Try these again',
  'ov.bulk.save': 'Save {count} changes',
  'ov.bulk.saveOne': 'Save {count} change',
  'ov.bulk.discard': 'Discard',
  'ov.bulk.someFailed': '{count} changes did not go through. They are still here, so you can try again.',
  'ov.bulk.someFailedOne': '1 change did not go through. It is still here, so you can try again.',
  'ov.bulk.confirm.title': 'Save these changes?',
  'ov.bulk.confirm.message': 'This changes {count} services at {venueList}.',
  'ov.bulk.confirm.confirm': 'Save changes',
  'ov.grid.cell.all': 'All calendars',
  'ov.grid.cell.some': 'Some calendars',
  'ov.grid.cell.none': 'No calendars',
  'ov.grid.cell.staged': '{count} staged',
  'ov.grid.search': 'Search services',
  'ov.grid.empty': 'No services match.',
  'ov.grid.done': 'Done',

  // Notices (collective-notices.ts; UX spec §4)
  'notify.offered.subject': '{host} added {service} to {collective}',
  'notify.offered.body': '{service} is set up in your account. Choose which of your calendars offer it.',
  'notify.hostCalendar.added.subject': '{host} added {calendar} to {service}',
  'notify.hostCalendar.added.body':
    'Guests can now book {service} with {calendar} on the {collective} page. You can change this on Calendar Availability.',
  'notify.hostCalendar.removed.subject': '{host} took {calendar} off {service}',
  'notify.hostCalendar.removed.body':
    '{calendar} no longer offers {service} for new bookings. {count} upcoming bookings stay as they are.',
  'notify.values.subject': "{host} changed {calendar}'s {field} for {service}",
  'notify.values.body': '{calendar} now uses {value} for {service}.',
  'notify.valuesCleared.subject': 'Custom values for {service} were cleared',
  'notify.valuesCleared.body':
    '{host} no longer lets calendars set their own {field} for {service}. {calendars} now use the standard value, {value}.',
  'notify.pageBooking.subject': 'New booking with {venue} on the {collective} page',
  'notify.pageBooking.body':
    "A guest booked {service} with {calendar} at {venue} for {date}. {venue} holds the booking and the client's details.",

  // The commercial change ask
  'svc.commercial.title': 'Update {service} at every venue?',
  'svc.commercial.message': 'These changes apply to new bookings at {venueList}.',
  'svc.commercial.bookingsKept': 'Bookings already made keep the price and terms they were booked with.',
  'svc.commercial.membersTold': '{venueList} are told about these changes by email.',
  'svc.commercial.clearValues.heading': 'Custom values that will be cleared',
  'svc.commercial.clearValues.row': '{calendar} at {venue}: {field} goes back to {value}',
  'svc.commercial.confirm': 'Save and update',
  'diff.row': '{label}: {from} to {to}',
  'diff.none': 'None',
} as const;

export type CollectiveCopyId = keyof typeof COLLECTIVE_COPY;

/** The ids that are deliberately the same sentence somewhere else, so nothing is written twice. */
export const COLLECTIVE_COPY_ALIASES = {
  'svc.filter.onPage': 'common.srOnly.collective',
  'svc.filter.parked': 'common.pill.parked',
  'svc.card.onPageSwitch': 'common.srOnly.collective',
  'svc.member.section.fromHost': 'common.pill.fromHost',
  'svc.member.section.parked': 'common.pill.parked',
} as const satisfies Record<string, CollectiveCopyId>;

/** Labels for the fields a commercial change lists in its ask (`diff.row`). */
export const COLLECTIVE_DIFF_LABELS = {
  price: 'Price',
  deposit: 'Deposit',
  noShowFee: 'No-show fee',
  payment: 'Online payment',
  length: 'Length',
  buffer: 'Buffer',
  cancellation: 'Cancellation notice',
  options: 'Options',
  addons: 'Add-ons',
  forms: 'Forms',
} as const;

/**
 * "A", "A and B", "A, B and C", then "A, B and 2 more", so a host with thirty members reads a
 * sentence rather than a list.
 */
export function formatVenueList(names: string[], namesShownWhenLong = 2): string {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (clean.length === 0) return '';
  if (clean.length === 1) return clean[0]!;
  if (clean.length <= 3) return `${clean.slice(0, -1).join(', ')} and ${clean[clean.length - 1]}`;
  const shown = clean.slice(0, namesShownWhenLong);
  return `${shown.join(', ')} and ${clean.length - shown.length} more`;
}

export type CollectiveCopyParams = Record<string, string | number | undefined | null>;

/**
 * The sentence for `id`, with its placeholders filled. A placeholder with no value is left as it
 * is, which the unit test forbids, rather than becoming an empty gap a venue would have to guess at.
 */
export function collectiveCopy(id: CollectiveCopyId, params: CollectiveCopyParams = {}): string {
  return COLLECTIVE_COPY[id].replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = params[key];
    return value === undefined || value === null || value === '' ? whole : String(value);
  });
}

/** Which placeholders a sentence needs, so a caller can be checked against it. */
export function collectiveCopyPlaceholders(id: CollectiveCopyId): string[] {
  return [...new Set([...COLLECTIVE_COPY[id].matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))];
}
