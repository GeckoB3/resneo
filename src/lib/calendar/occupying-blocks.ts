/**
 * Which diary blocks stop staff placing an appointment, and which are advice.
 *
 * Lives outside `PractitionerCalendarView` so the rule is testable on its own
 * and so there is one answer rather than one per call site: the view previously
 * treated every block as a hard conflict in both `slotOccupied` and
 * `appointmentWindowCollides`, with no discrimination of any kind.
 */

/**
 * Block types staff may place an appointment over.
 *
 * Closures and breaks describe when a venue or a person *normally* works, and
 * staff override them routinely. The 17:15 client when the salon shuts at 17:00
 * is the commonest real reason a receptionist touches the diary, and the
 * shipped help article promises it is allowed with a note rather than a refusal
 * (SA-H5).
 *
 * A closure day used to lock staff out of the bookings already sitting on it
 * (SA-M2). Amended hours produce no block at all: the diary draws an amended
 * day exactly as a normal day, with closed stripes outside the amended window,
 * so the open part is plain grid (SA-H3).
 */
const NON_OCCUPYING_BLOCK_TYPES = new Set([
  'venue_closed',
  'practitioner_closed',
  'venue_and_calendar_closed',
  'break',
]);

/**
 * Whether a block should stop staff placing an appointment over it.
 *
 * `practitioner_leave` is deliberately absent from the permitted set: a closure
 * is a boundary the venue can choose to work past, but leave means the person
 * is not in the building. Classes, events and blocks staff made by hand stay
 * hard conflicts too, and an unrecognised type occupies, so anything added
 * later is refused until someone decides otherwise.
 *
 * So are every linked column's stripes (`linked_venue_closed`, and the resolved
 * `linked_business_closed`, `linked_calendar_closed`, `linked_leave` and
 * `linked_both_closed`): they look like their own-column counterparts, but
 * working past a partner's closing time is not this venue's call to make.
 */
export function isOccupyingBlock(blockType: string | undefined): boolean {
  return !NON_OCCUPYING_BLOCK_TYPES.has(blockType ?? '');
}

/**
 * Whether a block means "not normally worked", for the amber outside-hours note.
 */
export function isNonWorkingBlock(blockType: string | undefined): boolean {
  return !isOccupyingBlock(blockType);
}
