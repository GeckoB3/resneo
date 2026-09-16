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
  'svc.card.onPageSwitch': 'On the {collective} page',
  'svc.offer.title': 'Add {service} to the {collective} page?',
  'svc.offer.message':
    '{service} is set up at {venueList} with your settings, and you control it for every venue. Their calendars do not offer it until you or they choose calendars.',
  'svc.offer.confirm': 'Add to the page',
  'svc.offer.done': 'Added to the {collective} page and set up at {venueList}.',
  'svc.offer.error': 'Could not add {service} to the {collective} page. Please try again.',
  'svc.withdraw.title': 'Take {service} off the {collective} page?',
  'svc.withdraw.message':
    'Guests will no longer see {service} on the {collective} page. At {venueList} it becomes a retired service and their calendars stop offering it. Bookings already made are not changed. At your venue it stays in your services, parked.',
  'svc.withdraw.confirm': 'Take off the page',
  'svc.withdraw.done': 'Taken off the {collective} page.',
  'svc.add.onPageCheckbox': 'Show on the {collective} page',
  'svc.add.onPageHelp':
    'Sets it up at {venueList} too, with your settings. You can choose their calendars after saving. If you untick this, the service is parked while {collective} is live.',

  // The Collective area (CollectiveAreaClient.tsx; UX spec §2 item 15)
  'ov.subtitle': 'Who is in it, what is on the page, and which calendars offer what.',
  'ov.venue.counts': '{services} services, {calendars} calendars on the page',
  'ov.venue.upToDate': 'Up to date with the page.',
  'ov.venue.updating': 'Updating. Its calendars take new bookings again in a moment.',
  'ov.venue.failed': 'An update did not go through.',

  // The Collective area's tabs
  'ov.tab.overview': 'Services',
  'ov.tab.venues': 'Venues',
  'ov.tab.history': 'History',
  'ov.venues.invite': 'Invite a venue',
  'ov.venues.invited': '(invited)',
  'ov.venues.host': 'Host',
  'ov.venues.member': 'Member',
  'ov.venues.remove': 'Remove',
  'ov.venues.removeTitle': 'Remove {venue} from {collective}?',
  'ov.venues.removeMessage':
    '{venue} stops being part of {collective}. Its copies of your services become its own, and bookings already made are not changed.',
  'ov.venues.cancelTitle': 'Cancel the invitation to {venue}?',
  'ov.venues.cancelMessage': '{venue} will no longer be able to join. You can invite it again later.',
  'bp.members.cancelInvite': 'Cancel invitation',
  'bp.members.askToHost': 'Ask to host',
  'bp.members.history': 'History',

  // History (CollectiveHistoryPanel.tsx)
  'history.title': '{collective} history',
  'history.filter.all': 'All changes',
  'history.filter.services': 'Services',
  'history.filter.calendars': 'Calendars',
  'history.filter.members': 'Members',
  'history.filter.venue': 'Venue',
  'history.filter.anyVenue': 'Every venue',
  'history.filter.from': 'From',
  'history.filter.to': 'To',
  'history.empty': 'Nothing has changed yet.',
  'history.more': 'Load more',
  'history.export': 'Download this history',

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
  'ov.bulk.confirm.messageOne': 'This changes {count} service at {venueList}.',
  'ov.bulk.confirm.confirm': 'Save changes',
  'ov.preview.button': 'See what each venue will show',
  'ov.preview.title': 'What guests will see',
  'ov.preview.willHide': 'This will not be bookable at {venue}, because {reason}.',
  // Added while building the preview: the deck names what hides, and the dialog also has to say
  // what shows, and what to say when a venue would show nothing at all.
  'ov.preview.shows': 'Guests can book: {services}.',
  'ov.preview.nothing': 'Guests will not be able to book anything with {venue} on the page.',
  'ov.preview.loading': 'Working out what each venue will show...',
  'ov.preview.failed': 'Could not work out the preview. Your changes are still here.',
  'ov.grid.cell.all': 'All calendars',
  'ov.grid.cell.some': 'Some calendars',
  'ov.grid.cell.none': 'No calendars',
  'ov.grid.cell.staged': '{count} staged',
  'ov.grid.search': 'Search services',
  'ov.grid.empty': 'No services match.',
  'ov.grid.done': 'Done',

  // Moving the hosting (hosting-actions.ts, the Venues tab and the candidate's banner)
  'transfer.ask.button': 'Ask to host',
  'transfer.ask.title': 'Ask {venue} to host {collective}?',
  'transfer.ask.message':
    "If {venue} accepts, it controls the services on the {collective} page for every venue, including yours. The page then shows {venue}'s address, phone and opening hours. Every venue is told, and hosting moves 14 days after {venue} accepts.",
  'transfer.ask.confirm': 'Send request',
  'transfer.pending.asked': 'Asked {venue} to host. Waiting for {venue} to answer.',
  'transfer.pending.scheduled': '{venue} will host {collective} from {date}.',
  'transfer.cancel': 'Cancel the move',
  'transfer.cancel.title': 'Cancel the move of hosting to {venue}?',
  'transfer.cancel.message': '{venue} is told, and {collective} keeps its current host.',
  'transfer.request.title': '{host} asked you to host {collective}',
  'transfer.accept.title': 'Take over hosting {collective}?',
  'transfer.accept.1':
    'You will control the services on the page for every venue: names, prices, deposits, payment rules, options, add-ons and forms.',
  'transfer.accept.2': "{host}'s services on the page become services you manage, in {host}'s account.",
  'transfer.accept.3': 'The {collective} page will show your address, phone and opening hours.',
  'transfer.accept.4': 'Clients keep paying the venue whose calendar they book.',
  'transfer.accept.consent': 'I agree to host {collective} and manage its services for every venue.',
  'transfer.accept.confirm': 'Accept and host',
  'transfer.decline': 'Say no',
  'transfer.review': 'Review request',
  'transfer.error.consent': 'Please read what hosting involves and tick the box to agree before accepting.',
  'transfer.paused.title': '{collective} is paused',
  'transfer.paused.body':
    '{collective} has no host, so its page is not taking bookings. One venue can take over hosting, or {collective} ends after 30 days and every venue keeps everything.',
  'transfer.paused.takeOver': 'Take over hosting',
  'dissolve.button': 'End {collective}',
  'dissolve.title': 'End {collective}?',
  'dissolve.message':
    "The {collective} page stops taking bookings straight away. Every venue keeps its services, calendars, clients and bookings, and its own booking page comes back. For 90 days, old links to the {collective} page show a page listing each venue's own booking page.",
  'dissolve.typeToConfirm': 'Type {collective} to confirm',

  // Notices (collective-notices.ts; UX spec §4)
  'notify.failedHost.subject': '{service} could not be updated at {venue}',
  'notify.failedHost.body':
    "Your latest change to {service} has not reached {venue}: {reason}. Until it does, guests cannot book {service} on {venue}'s calendars. We are still trying.",
  'notify.failedHost.bodyMany':
    "Your latest changes to {service} have not reached {venue}: {reason}. Until they do, guests cannot book them on {venue}'s calendars. We are still trying.",
  'notify.failedMember.subject': '{service} from {host} is not up to date',
  'notify.failedMember.subjectMany': '{service} from {host} are not up to date',
  'notify.failedMember.body':
    'Guests cannot book {service} on your calendars until it updates. {host} has been told, and we are still trying.',
  'notify.failedMember.bodyMany':
    'Guests cannot book {service} on your calendars until they update. {host} has been told, and we are still trying.',
  'notify.commercial.subject': '{host} changed {service}',
  'notify.commercial.subjectMany': '{host} changed {count} services',
  'notify.commercial.body':
    'These changes apply to new bookings on your calendars from now. Bookings already made keep the price and terms they were booked with.',
  'notify.commercial.putBack': '{host} put {service} back to how it was.',
  'notify.digest.subject': 'Changes from {host} today',
  'notify.digest.body': 'Here is what {host} changed in services on the {collective} page today.',
  'notify.hostRequest.subject': '{host} asked you to host {collective}',
  'notify.hostRequest.body':
    'If you accept, you manage the services on the {collective} page for every venue, including their prices and forms.',
  'notify.hostMoving.subject': '{newHost} will host {collective} from {date}',
  'notify.hostMoving.body':
    'From {date}, {newHost} manages the services on the {collective} page, including the prices and forms used on your calendars. You can leave at any time.',
  'notify.hostMoved.subject': '{newHost} now hosts {collective}',
  'notify.hostMoved.body':
    '{newHost} manages the services on the {collective} page from today. Bookings already made are not changed.',
  'notify.paused.subject': '{collective} is paused',
  'notify.paused.body':
    '{oldHost} is no longer part of {collective}, so its page is paused. One of you can take over hosting before {date}, or {collective} ends and every venue keeps everything.',
  'notify.dissolved.subject': '{collective} has ended',
  'notify.dissolved.body':
    'Every venue keeps its services, calendars, clients and bookings. Your own booking page is back. Your account links are unchanged.',
  // Added while building the lifecycle: the plan tells both sides when a move is called off, and
  // the deck had no sentence for it.
  'notify.hostDeclined.subject': '{venue} will not host {collective}',
  'notify.hostDeclined.body': '{venue} said no to hosting {collective}. Nothing has changed.',
  'notify.hostMoveCancelled.subject': 'The move of hosting to your venue was cancelled',
  'notify.hostMoveCancelled.body': '{venue} cancelled the move, and keeps hosting {collective}. Nothing has changed.',
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
  'notify.valuesCleared.bodyOne':
    '{host} no longer lets calendars set their own {field} for {service}. {calendars} now uses the standard value, {value}.',
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
