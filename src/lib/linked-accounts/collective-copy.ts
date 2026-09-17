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
  'svc.member.card.suggest': 'Suggest to {host}',
  'svc.member.suggest.title': 'Suggest {service} for {collective}?',
  'svc.member.suggest.message':
    '{host} is asked to add {service} to the {collective} page. If {host} adds it, {host} controls it from then on, and you choose whether your {service} is used for it.',
  'svc.member.suggest.confirm': 'Send suggestion',
  'svc.member.suggest.done': 'Suggestion sent to {host}.',
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
  // Using a member's page address (UX spec `bp.address.adopt.*`, N38, decided 2026-09-14).
  'bp.address.adopt.pending': 'Waiting for {venue} to agree. Until it does, the {collective} page keeps {collectiveAddress}.',
  'bp.address.adopt.ask':
    '{host} would like the {collective} page to use your page address, {ownAddress}. Nothing changes unless you agree, and you get the address back if you leave.',
  'bp.address.adopt.confirm': 'Agree',
  'bp.address.adopt.decline': 'Not now',
  'history.addressAdopted': '{venue} agreed that the {collective} page uses its page address, {address}',
  'notify.adoptAddress.subject': '{host} would like to use your page address for {collective}',
  'notify.adoptAddress.body':
    '{host} has asked to use {ownAddress} as the address of the {collective} page. Nothing changes unless you agree, and you get the address back if you leave.',
  // Added (W10): the notice's button, which opens the Booking Page tab where the member answers.
  'notify.adoptAddress.cta': 'Answer the request',
  // The own page's status line on the Booking Page tab (UX spec item 11, `bp.status.*`, `bp.reason.*`).
  'bp.status.redirecting': 'Guests who visit your own booking page are sent to the {collective} page.',
  'bp.status.showing': 'Your own page is showing because {reason}.',
  'bp.reason.notLive': 'the {collective} page is not live yet',
  'bp.reason.noCalendars': 'none of your calendars offer a service on the {collective} page yet',
  'bp.reason.paused': 'booking is paused on the {collective} page',
  'bp.reason.settingUp': 'your services from {host} are still being set up',
  'bp.reason.unavailable': 'the {collective} page is unavailable right now',
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

  // Settings a collective depends on (collective-venue-locks.ts; UX spec `profile.timezone.*`, `bm.*`)
  'profile.timezone.locked':
    'You cannot change your timezone while you are part of {collective}, because every venue in it uses the same timezone.',
  'profile.timezone.error': 'Your venue is part of {collective}, so its timezone cannot change. Leave {collective} first.',
  'bm.model.locked':
    'You cannot switch appointments off while {venue} is in a collective, because the collective page needs them.',
  'bm.currency.blocked':
    '{venue} takes payment in {currency} and the collective uses {hostCurrency}. Every venue in a collective has to use the same currency.',

  // Leaving, removal and the review after (release-actions.ts, release-followups.ts, release-review.ts;
  // UX spec J7, J8, `leave.*`, `remove.*`, `review.*`)
  'leave.title': 'Leave {collective}?',
  'leave.message':
    'You keep every service, calendar and booking. Services from {host} become yours to edit, and guests book you on your own booking page again.',
  'leave.body.services':
    '{count} services from {host} become your own services, with the settings they have now.',
  'leave.body.noStripe':
    '{count} of them take a payment online. You have not connected Stripe, so they stop taking payments online until you do.',
  'leave.body.bookings': 'Bookings made through the {collective} page stay with you.',
  'leave.body.lastMember': '{collective} needs at least two venues, so it ends when you leave.',
  'leave.body.access':
    "Your account links with {venueList} stay exactly as they are, so you can still see and manage each other's bookings and clients. To change a link, go to Linked accounts.",
  'leave.confirm': 'Leave {collective}',
  'review.title': 'You left {collective}. Review your services',
  'review.titleRemoved': 'You are no longer part of {collective}. Review your services',
  'review.prices': 'Check prices and deposits on {count} services that came from {host}',
  'review.link': 'Add your own online meeting link to {count} services',
  'review.stripe': 'Connect Stripe to take payments online again',
  'review.library': 'Check headings, add-ons and forms that came from {host}',
  'review.photos.copying': 'Copying photos from {host}...',
  'review.photos.done': 'Photos copied',
  'review.photos.failed': 'Some photos could not be copied.',
  'review.sameName':
    'You now have two services called {service}: yours, and the one that came from {host}. Both are active. Rename or turn off the one you do not need.',
  'review.unparked':
    '{count} services that were parked while you were part of {collective} are bookable again.',
  'review.dismiss': 'Done',
  // Singular forms, so one service never reads "1 services".
  'review.pricesOne': 'Check prices and deposits on 1 service that came from {host}',
  'review.linkOne': 'Add your own online meeting link to 1 service',
  'review.unparkedOne': '1 service that was parked while you were part of {collective} is bookable again.',
  'leave.body.servicesOne': '1 service from {host} becomes your own service, with the settings it has now.',
  'leave.body.noStripeOne':
    'It takes a payment online. You have not connected Stripe, so it stops taking payments online until you do.',
  'remove.title': 'Remove {venue} from {collective}?',
  'remove.message':
    '{venue} keeps every service, calendar and booking, and its own booking page comes back. Its calendars leave the {collective} page straight away.',
  'remove.lastMember': '{collective} needs at least two venues, so removing {venue} ends {collective}.',
  'remove.confirm': 'Remove {venue}',
  'notify.left.subject': '{venue} left {collective}',
  'notify.left.body':
    "{venue}'s calendars are no longer on the {collective} page. It keeps the services it had from you as its own services. Your account link with {venue} is unchanged.",
  'notify.removed.subject': 'You are no longer part of {collective}',
  'notify.removed.body':
    '{host} removed {venue} from {collective}. You keep every service, calendar and booking. Services from {host} are now yours to edit, and your own booking page is back. Your account links are unchanged.',
  'notify.linkEnded.subject': '{venue} left {collective} because a link ended',
  'notify.linkEnded.body':
    'The link between {venue} and {host} ended, so {venue} is no longer part of {collective}. It keeps every service, calendar and booking.',
  'notify.review.cta': 'Review your services',

  // Adding a member's service, and the member's answer (adoptions.ts, AddFromVenueDialog.tsx,
  // AdoptionReviewDialog.tsx; UX spec `svc.addFrom.*`, `svc.member.adopt.*`, N26)
  'svc.addFrom.button': 'Add from another venue',
  'svc.addFrom.title': 'Add a service from another venue',
  'svc.addFrom.help':
    'Choose a service that only one venue has. It is copied into your services, put on the {collective} page and set up at every venue. You control it from then on.',
  'svc.addFrom.venueLabel': 'Venue',
  'svc.addFrom.empty': '{venue} has no services of its own to add.',
  'svc.addFrom.adoptNote':
    '{venue} is asked whether to use its own {service} for this. If it does, its calendars and bookings for it stay as they are.',
  'svc.addFrom.confirm': 'Copy and add to the page',
  'svc.addFrom.done': '{service} is on the {collective} page. We have asked {venue} whether to use its own {service} for it.',
  'svc.member.adopt.title': '{host} wants to use your {service}',
  'svc.member.adopt.message':
    '{host} has put {service} on the {collective} page. You can use your own {service} for it, so its calendars and bookings stay as they are, or keep yours separate. If you keep yours separate, it is parked while you are part of {collective}.',
  'svc.member.adopt.useMine': 'Use my {service}',
  'svc.member.adopt.keepSeparate': 'Keep mine separate',
  // Added (W7): the button on the question's line; the deck names only the choices.
  'svc.member.adopt.open': 'Choose',
  'notify.adopt.subject': '{host} wants to use your {service}',
  // Added (W7): the deck gives N26 no button label.
  'notify.adopt.cta': 'Choose on your Services page',
  'notify.adopt.body':
    '{host} has put {service} on the {collective} page. Choose whether to use your own {service} for it, so its calendars and bookings stay as they are.',

  // After a collective ends (dissolved-page.ts; UX spec `public.dissolved.*`, `la.row.*`)
  'guest.bookedThrough': 'Booked through {collective}',
  // Public identity (UX spec §3 "Public identity", D48).
  'public.meta.title': 'Book with {collective}',
  'public.meta.description': 'Book online with {collective}. {venueCount} venues, one booking page.',
  'public.header.venues': '{venueCount} venues',
  'public.calendar.venue': '{venue}',
  'public.group.sameVenue':
    'Everyone in a group booking is seen at the same place. To book with more than one venue, make a separate booking for each.',
  'email.confirm.through': 'You booked through {collective}.',
  // Who the guest is booking with on a collective page (UX spec item 14; PUB-03, RT2-14, PB-15).
  'public.trader': 'You are booking with {business}, {address}.',
  // Added (W10): the same line for a business with no address on file.
  'public.traderNoAddress': 'You are booking with {business}.',
  'public.payment.payee': 'Your payment goes to {business}.',
  'public.marketing.collective': 'Send me offers and news from {business} by email.',
  'public.confirmation.through': 'Booked with {business} through {collective}.',
  // Added (W10): the card on a venue's own page when its appointments are booked on the collective
  // page but its other booking types stay (UX spec item 14, "a card that links to the collective page").
  'public.handover.title': 'Appointments are booked with {collective}',
  'public.handover.body': 'Choose a service and a time on the {collective} booking page.',
  'public.handover.button': 'Book an appointment',
  'public.dissolved.title': '{collective} is no longer taking bookings',
  'public.dissolved.body': 'You can still book with these businesses:',
  'public.dissolved.book': 'Book with {venue}',
  'public.dissolved.none': 'Please contact the business directly.',
  'public.dissolved.existing':
    'If you already have a booking, the link in your confirmation email still lets you manage it.',
  'la.row.ended': 'Ended on {date}',
  'la.row.listOnOldPage': 'List {venue} on the old {collective} page',

  // Invitations (lifecycle-reminders.ts and the notice drain; UX spec N1, N34, N35)
  'notify.invite.subject': '{host} invited you to join {collective}',
  'notify.invite.body':
    "{host} has invited {venue} to join {collective}, so your calendars and theirs work as one business with one booking page. If you join, {host} manages the services on the page, including their prices and forms, and clients pay you directly. Each venue keeps its own clients and bookings, and while the collective runs the venues can see each other's client records and takings. You can leave at any time.",
  'notify.invite.cta': 'Review invitation',
  'notify.inviteWithdrawn.subject': '{host} withdrew the invitation to {collective}',
  'notify.inviteWithdrawn.body':
    '{host} has withdrawn its invitation for {venue} to join {collective}. Nothing has changed in your account, and {host} can invite you again later.',
  'notify.inviteExpired.subject': 'The invitation to {collective} has expired',
  'notify.inviteExpired.body':
    'The invitation for {venue} to join {collective} was not answered within 30 days, so it has closed. {host} can send a new one.',

  // The staff form's contact picker inside a live collective (collective-contact-search.ts)
  'staff.contact.ownerLine': "{venue}'s client",
  // A booking on a venue's copy that is still catching up with the host (D33, UX spec 0.5).
  'staff.error.updating': 'This service is being updated at {venue}. Please try again in a moment.',
  'public.error.updating': 'This service has just been updated. Please choose your time again.',

  // Creating a collective (CreateCollectiveDialog.tsx, collective-candidates.ts; UX spec J1)
  'create.title': 'Create a collective',
  'create.step': 'Step {n} of 4',
  'create.what.title': 'What a collective is',
  'create.what.1': 'Two or more venues sell their appointments on one booking page, as one business.',
  'create.what.2':
    'The host puts services on that page and sets their prices, deposits and forms for every venue.',
  'create.what.3': 'Each venue keeps its own calendars, clients, bookings and payments.',
  'create.what.host': '{venue} will be the host.',
  'create.name.label': 'Collective name',
  'create.name.help': 'Guests see this name on the booking page and in their emails.',
  'create.address.preview': '{origin}/book/c/{slug}',
  'create.address.checking': 'Checking this address...',
  'create.address.free': 'This address is free.',
  'create.address.taken': 'That address is taken. Try another.',
  'create.address.format': 'Use lower-case letters, numbers and hyphens only.',
  'create.disabled.address': 'Choose a free address to continue.',
  'create.venues.ok': 'Can join',
  'create.venues.pill.noPayments': 'No card payments',
  'create.venues.warn.noStripe':
    '{venue} has not connected Stripe. It can join, but guests cannot book its calendars online for services that take a payment.',
  'create.venues.pill.cannotJoin': 'Cannot join yet',
  'create.venues.blocked.otherCollective': 'Already part of another collective',
  'create.venues.blocked.timezone': 'In {timezone}, not {yourTimezone}',
  'create.venues.blocked.currency': 'Uses {currency}, not {yourCurrency}',
  'create.venues.blocked.plan': 'Their plan does not include collectives',
  'create.venues.blocked.permissions': 'Your link with {venue} does not share full calendar details yet.',
  'create.venues.fixPermissions': "Change the link's permissions",
  'create.venues.selected': '{count} venues selected',
  'create.venues.empty.title': 'No venues to invite yet',
  'create.venues.empty.body':
    'You can invite venues you have an active link with. Set one up under Active links first.',
  'create.changes.title': 'What changes when {collective} starts',
  'create.changes.intro':
    'Here is what happens for you and for each venue you invite, once two venues are in.',
  'create.changes.address.note': 'Guests who visit any of these addresses land on the {collective} page.',
  'create.changes.address.when':
    'This starts once two venues are in and at least one calendar offers a service. Until then, every page stays as it is.',
  'create.changes.services.title': 'The services come from you',
  'create.changes.services.body':
    "Services you put on the page are set up in each venue's account, with your prices, deposits and forms. You change them for every venue at once.",
  'create.changes.owns.title': 'Each venue keeps what is its own',
  'create.changes.owns.body':
    'Its calendars, working hours, clients, bookings and payments stay with that venue. Clients pay the venue they book with.',
  'create.changes.clients.title': 'Your account links stay as they are',
  'create.changes.clients.body':
    "Every venue in {collective} is already linked with the others, which is how you see each other's clients and bookings. {collective} does not change those links, and leaving or ending it does not end them. Its reports show every venue's takings, each named.",
  'create.changes.ending':
    'Any venue can leave at any time, and you can end {collective} at any time. Every venue keeps its services, calendars, clients and bookings.',
  'create.changes.ack': 'I understand what changes for {venue} and for the venues I invite.',
  'create.changes.help': 'Read more about collectives',
  'create.check.role': 'Host',
  'create.check.notLive':
    'The {collective} page is not live yet. It goes live once an invited venue accepts and at least one calendar offers a service.',
  'create.check.emailPreview': 'What {venueList} will read',
  'create.cta.create': 'Create and send invitations',
  'create.cta.creating': 'Creating...',
  'create.done.title': '{collective} is created',
  'create.done.body':
    'Invitations are on their way to {venueList}. The page goes live once a venue accepts and a calendar offers a service.',
  'create.done.copy': 'Copy address',
  'create.done.cta': 'Go to Collective',
  'create.done.later': 'Do this later',
  // Added (W7): the deck names step 5's three next steps but gives them no words.
  'create.next.invitees': 'Waiting for {count} invited venues',
  'create.next.invitees.body': 'See who has answered on the Venues tab.',
  'create.next.services': 'Put services on the page',
  'create.next.services.body': 'Choose which of your services the {collective} page offers, on your Services page.',
  'create.next.design': 'Design the page',
  'create.next.design.body': 'Choose how the {collective} page looks, under Settings, Booking Page.',
  'create.toast.done': '{collective} created. Invitations sent to {venueList}.',
  'row.pill.waiting': 'Waiting for venues',
  'row.pill.noServices': 'Nothing on the page yet',
  'row.pill.live': 'Live',
  'row.members.line': '{activeCount} venues in and {invitedCount} invited: {venueList}',
  'row.notLive.reason': 'Not live yet: {reason}',
  'bm.invite.noAppointments':
    '{venue} does not offer appointments, so it cannot join a collective yet. A collective page shows appointments only.',
  'bm.join.otherModels':
    'You also run {modelList}. Those stay on your own booking page and are not shown on the {collective} page.',
  'bm.redirect.otherModels':
    'Your own booking page now opens the {collective} page. Your {modelList} are still bookable at {link}.',
  'bm.resource.notShared':
    "Rooms and equipment are not shared between venues. If two venues use the same room, keep it on one venue's calendars only.",
  'bm.visit.sameVenue': 'All the services in one visit have to be with the same person, so they are at one venue.',
  // Added (W20): the plan's host line (§6.14 item 4), which the deck names but gives no id.
  'bm.members.alsoRuns': 'Also runs {modelList}, which stay on its own booking page.',

  // Added (W6): the deck points at "the form's existing label", but no form ever had this field.
  'svc.member.view.instructionsLabel': 'Before the appointment',
  'svc.member.view.instructionsHelp':
    'What guests booking with you should know beforehand, such as where to park. Only your guests see this; {host} does not set it.',

  // The Categories tab (ServiceCategoriesManager.tsx; UX spec §2 item 6)
  'cat.host.description':
    'Group your services under headings on the {collective} page, so customers find what they want faster. Drag the handle (or use the arrows) to set their order. Headings used by services on the page reach {venueList}.',
  'cat.host.deleteOnPage':
    '{count} services move to "Other services" on the {collective} page and at {venueList}. Nothing about a service is deleted.',
  'cat.member.description':
    "Group your services under headings. Headings from {host} follow {host}'s names. Their order here only changes your own lists, not the {collective} page.",
  'cat.member.lockedTooltip': '{host} manages this heading for {collective}.',

  // Per-calendar values (StaffServiceOverrideModal.tsx; UX spec item 9)
  'values.help.member': '{host} decides which values you can change here. They apply to {calendar} only.',
  'values.standard': 'Standard: {value}',

  // The diary (PractitionerCalendarView.tsx, StaffAppointmentModifyForm.tsx; UX spec item 13, D46, D47)
  // D46 revised 2026-09-16 (option 2): a booking with nothing attached moves to the other venue.
  'move.otherVenue.title': 'Move this booking to {venue}?',
  'move.otherVenue.body':
    "{calendar} at {venue} will have this booking at {time}, at the same price. It comes off {ownVenue}'s diary, and the client gets one message with the new details.",
  'move.otherVenue.confirm': 'Move to {venue}',
  'move.otherVenue.moving': 'Moving…',
  'move.otherVenue.done': 'Moved to {calendar} at {venue}.',
  'move.otherVenue.doneNotTold':
    'Moved to {calendar} at {venue}. The client was not sent a message, because {venue} has booking change messages turned off.',
  'move.refused.payment':
    'This booking has a deposit, card hold or payment, so it stays with the venue that took it. You can move it within that venue.',
  'move.refused.forms':
    'The client has completed forms for this booking, so it stays with the venue that holds them. You can move it within that venue.',
  'move.refused.visit':
    'This booking is part of a visit or group, so it cannot be moved to {venue} on its own.',
  'move.refused.status': 'Only upcoming bookings can be moved to {venue}.',
  'move.refused.service': 'That calendar at {venue} does not offer this service, so the booking cannot move there.',
  'move.refused.notAllowed': 'This booking cannot be moved to {venue}.',
  'move.guest.changed': 'Your appointment is now with {calendar} at {venue}.',
  'clash.samePerson':
    '{calendar} at {venue} looks like the same person as {otherCalendar} at {otherVenue}, who already has a booking at this time.',

  // Joining (join.ts and JoinCollectiveDialog.tsx; UX spec `join.*`)
  'join.title': 'Join {collective}',
  'join.step': 'Step {n} of {total}',
  'join.step.means': 'What joining means',
  'join.step.services': 'Your services',
  'join.step.forms': 'Forms you already use',
  'join.step.check': 'Check and join',
  'join.means.1':
    '{host} sets up the services on the {collective} page in your account and controls them: names, descriptions, prices, deposits, payment rules, options, add-ons and forms.',
  'join.means.2': 'Clients pay you, through your own Stripe account, at the prices {host} sets.',
  'join.means.3':
    'You choose which of your calendars offer each service. Your working hours and closures stay yours.',
  'join.means.4': 'Your clients and bookings stay yours.',
  'join.means.5':
    'While you are part of {collective}, guests who visit your own booking page land on the {collective} page.',
  'join.means.6':
    'Your services that are not on the {collective} page are parked while you are part of {collective}: nobody can book them, your team included. They stay yours to edit, bookings already made for them are not changed, and you can ask {host} to add any of them.',
  'join.means.7': 'You can leave at any time. You keep every service and booking.',
  'join.warn.noStripe':
    'You have not connected Stripe. {count} services on the page take a deposit, full payment or card hold, so guests cannot book those with you online until you connect it.',
  'join.warn.formsOn':
    'Some services ask for forms. Your calendars can offer those only while compliance records are switched on for your venue, and once on they stay on while you are part of {collective}. We do not switch them on for you.',
  'join.block.timezone':
    'You cannot join because your venue is in {yourTimezone} and {collective} is in {timezone}. Change your timezone under Profile first.',
  'join.block.currency': 'You cannot join because your venue uses {yourCurrency} and {collective} uses {currency}.',
  // Added while building the join: the deck names another collective by name, which the engine's
  // blocker does not return; and it has no sentence for the booking-model and account-link checks.
  'join.block.otherCollective': 'Your venue is already part of {otherCollective}. Leave it before joining another.',
  'join.block.otherCollectiveGeneric': 'Your venue is already part of another collective. Leave it before joining this one.',
  // Added with the exclusivity check at invite (W7): the deck only has the wizard's short label.
  'invite.block.otherCollective': '{venue} is already part of another collective, so it cannot be invited until it leaves.',
  'join.block.bookingModel': 'You cannot join because your venue takes bookings in a different way from {collective}.',
  'join.block.links':
    'You cannot join yet because your account links with every venue in {collective} need full access both ways. Check them under Linked accounts.',
  'join.block.unknown': 'You cannot join right now. Please try again, or contact support if this keeps happening.',
  'join.services.sameName.heading': 'Services with the same name',
  'join.services.sameName.help':
    "You already have services with these names. Choose whether to use yours or add {host}'s as new.",
  'join.services.addNew': "Add {host}'s as a new service",
  'join.services.useMine': 'Use my {service}',
  'join.services.useMine.note':
    "Your {service} keeps its calendars and bookings. Its settings change to {host}'s. Bookings already made keep their price.",
  'join.map.heading': 'Match your options',
  'join.map.yours': 'Your option',
  'join.map.theirs': "{host}'s option",
  'join.map.keepOld': 'Keep for existing bookings only',
  'join.services.own.heading': 'Your other services',
  'join.services.own.help':
    'These are not on the {collective} page, so they are parked while you are part of {collective}. Bookings already made for them are not changed. If one should be on the page, ask {host} to add it.',
  'join.services.park': 'Park it until I leave',
  'join.services.ask': 'Ask {host} to add it to {collective}',
  'join.services.none': 'You have no services of your own to decide about.',
  'join.forms.useExisting': 'Use my existing {form}, so records my clients already gave still count',
  'join.forms.useTheirs': "Use {host}'s version as a separate form",
  'join.forms.note': 'Either way, {host} decides which forms its services ask for.',
  'join.forms.none': 'None of your forms share a name with the ones {collective} uses.',
  'join.summary.setup': '{count} services from {host} will be set up in your account.',
  'join.summary.useMine': '{count} of your services will be used for services from {host}.',
  'join.summary.park': '{count} of your services will be parked until you leave {collective}.',
  'join.summary.ask': '{host} will be asked to add {count} of your services.',
  'join.consent':
    "I understand that guests who visit {venue}'s booking page will be sent to the {collective} page, that {host} manages the services on it for {venue}, and that the venues in {collective} can see each other's clients, bookings and takings through our account links.",
  'join.confirm': 'Join {collective}',
  'join.next': 'Next',
  'join.back': 'Back',
  // Only an older app's one-tap accept reaches this: the web dialog always sends the consent.
  'join.error.consent': 'Please open ResNeo on the web to read what joining means, then accept there.',
  'join.loading': 'Getting your services ready to compare...',

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
  'notify.joined.subject': '{venue} joined {collective}',
  'notify.joined.body':
    'Your services on the {collective} page are being set up at {venue}. Choose which of its calendars offer each service on your Services page, or let {venue} choose.',
  'notify.suggestion.subject': '{venue} suggests {service} for {collective}',
  'notify.suggestion.body':
    '{venue} would like {service} on the {collective} page. If you add it, you control it for every venue.',
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
  'notify.suspended.subject': 'Your calendars are hidden from the {collective} page',
  'notify.suspended.body':
    "{venue}'s subscription needs attention, so its calendars are hidden from the {collective} page and guests cannot book them there. They come back as soon as the subscription is put right. Bookings already made are not changed.",
  'notify.resumed.subject': 'Your calendars are back on the {collective} page',
  'notify.resumed.body': "{venue}'s subscription is active again, so its calendars are back on the {collective} page.",
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
