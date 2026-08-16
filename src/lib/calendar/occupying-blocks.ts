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
 * `venue_amended_hours` is the strangest of the four: it marks the window the
 * venue IS open on an amended day. Treating it as occupied blocked the one part
 * of the day that was actually working, while the guest engine sold that same
 * window (SA-H3). A closure day then locked staff out of the bookings already
 * sitting on it (SA-M2).
 */
const NON_OCCUPYING_BLOCK_TYPES = new Set([
  'venue_closed',
  'venue_amended_hours',
  'practitioner_closed',
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
 */
export function isOccupyingBlock(blockType: string | undefined): boolean {
  return !NON_OCCUPYING_BLOCK_TYPES.has(blockType ?? '');
}

/**
 * Whether a block means "not normally worked", for the amber outside-hours note.
 *
 * Amended hours are excluded: landing inside the window a venue opened
 * specially is not outside hours, it is the most inside-hours a slot gets.
 */
export function isNonWorkingBlock(blockType: string | undefined): boolean {
  return !isOccupyingBlock(blockType) && blockType !== 'venue_amended_hours';
}
