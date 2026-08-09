/**
 * Where the appointment booking flow goes next.
 *
 * `AppointmentBookingFlow` is a hand-rolled step machine whose ordering
 * decisions were spread across a dozen inline conditional cascades. Holding
 * them here lets both orderings — service-first (the default) and staff-first —
 * be reasoned about and tested without rendering anything.
 *
 * The three surfaces behave differently in service-first and always have:
 * `venue` collects options then the person, `combined` picks the calendar first
 * because variants and add-ons live on that calendar's own source service, and
 * `locked` (a per-practitioner page) has the person fixed before the flow starts.
 *
 * Scope: primary-context transitions parameterised by ordering, surface, and
 * what the chosen service offers. These stay at the call sites, because they
 * turn on state this module deliberately does not model:
 *
 * - append and edit add-on segment contexts, which return to the multi-service review;
 * - the staff dashboard's calendar slot prefill short-circuit;
 * - edit mode's catalog-dependent practitioner-or-slot branch after a service pick;
 * - whether a back link renders at all (hidden for staff, edits, `?start=service`,
 *   and first steps); this module only says where it would go;
 * - the combined "Any available" sub-path: picking a non-uniform offering routes to
 *   the calendar step, and from there the call sites ask for the combined
 *   SERVICE-FIRST cells, so that sub-path behaves exactly as it does today;
 * - the group flow's own step ids, which the component maps from these results, and
 *   its entry and exit steps, which have no image here.
 *
 * Combinations that cannot occur throw rather than returning a plausible-looking
 * step, so a wiring mistake fails loudly instead of quietly misrouting a guest.
 */

export type AppointmentFlowOrdering = 'service_first' | 'staff_first';

/**
 * `venue`: a normal public booking page. `combined`: a venue collective's
 * merged page. `locked`: `/book/{venue}/{practitioner-slug}`.
 */
export type AppointmentFlowSurface = 'venue' | 'combined' | 'locked';

export interface AppointmentFlowShape {
  ordering: AppointmentFlowOrdering;
  surface: AppointmentFlowSurface;
}

/** What the service in play offers, scoped to the person when one is chosen. */
export interface AppointmentSelectionCtx {
  hasVariants: boolean;
  hasAddons: boolean;
}

export interface AnyAvailableCardInput {
  /** The venue's "Any available practitioner" setting (the host's, on a combined page). */
  flagOn: boolean;
  /** How many people the picker is listing. */
  listedCount: number;
  /**
   * Combined pages only: whether at least one offering is identical whoever
   * provides it. Omitted elsewhere, and treated as absent (card hidden) if a
   * combined caller forgets it, since a pool nothing can use is worse than none.
   */
  hasUniformOffering?: boolean;
}

function unreachable(fn: string, shape: AppointmentFlowShape): never {
  throw new Error(
    `appointment-flow-order: ${fn} is unreachable for ${shape.ordering} on a ${shape.surface} page`,
  );
}

/** Per-practitioner pages fix the person up front, so they never run staff-first. */
function assertOrderingFitsSurface(fn: string, shape: AppointmentFlowShape): void {
  if (shape.surface === 'locked' && shape.ordering === 'staff_first') {
    unreachable(fn, shape);
  }
}

/** Only staff-first has a staff picker. */
function assertStaffFirst(fn: string, shape: AppointmentFlowShape): void {
  assertOrderingFitsSurface(fn, shape);
  if (shape.ordering !== 'staff_first') unreachable(fn, shape);
}

/** Only service-first visits the practitioner step; locked pages skip it entirely. */
function assertVisitsPractitionerStep(fn: string, shape: AppointmentFlowShape): void {
  assertOrderingFitsSurface(fn, shape);
  if (shape.ordering !== 'service_first' || shape.surface === 'locked') {
    unreachable(fn, shape);
  }
}

export function afterStaffPick(shape: AppointmentFlowShape): 'service' {
  assertStaffFirst('afterStaffPick', shape);
  return 'service';
}

export function afterService(
  shape: AppointmentFlowShape,
  ctx: AppointmentSelectionCtx,
): 'variant' | 'addons' | 'practitioner' | 'slot' {
  assertOrderingFitsSurface('afterService', shape);
  if (shape.ordering === 'staff_first') {
    if (ctx.hasVariants) return 'variant';
    if (ctx.hasAddons) return 'addons';
    return 'slot';
  }
  if (shape.surface === 'combined') return 'practitioner';
  if (ctx.hasVariants) return 'variant';
  if (ctx.hasAddons) return 'addons';
  return shape.surface === 'locked' ? 'slot' : 'practitioner';
}

export function afterVariant(
  shape: AppointmentFlowShape,
  ctx: AppointmentSelectionCtx,
): 'addons' | 'practitioner' | 'slot' {
  assertOrderingFitsSurface('afterVariant', shape);
  if (ctx.hasAddons) return 'addons';
  if (shape.ordering === 'staff_first') return 'slot';
  return shape.surface === 'venue' ? 'practitioner' : 'slot';
}

export function afterAddons(shape: AppointmentFlowShape): 'practitioner' | 'slot' {
  assertOrderingFitsSurface('afterAddons', shape);
  if (shape.ordering === 'staff_first') return 'slot';
  return shape.surface === 'venue' ? 'practitioner' : 'slot';
}

export function afterPractitioner(
  shape: AppointmentFlowShape,
  ctx: AppointmentSelectionCtx,
): 'variant' | 'addons' | 'slot' {
  assertVisitsPractitionerStep('afterPractitioner', shape);
  if (shape.surface === 'combined') {
    if (ctx.hasVariants) return 'variant';
    if (ctx.hasAddons) return 'addons';
  }
  return 'slot';
}

export function backFromStaffPick(shape: AppointmentFlowShape): 'mode_choice' | null {
  assertStaffFirst('backFromStaffPick', shape);
  // Combined pages open on the picker, so there is nothing behind it.
  return shape.surface === 'combined' ? null : 'mode_choice';
}

export function backFromService(
  shape: AppointmentFlowShape,
): 'mode_choice' | 'staff_pick' | null {
  assertOrderingFitsSurface('backFromService', shape);
  if (shape.ordering === 'staff_first') return 'staff_pick';
  // Combined and per-practitioner pages both open on the service list.
  return shape.surface === 'venue' ? 'mode_choice' : null;
}

export function backFromVariant(shape: AppointmentFlowShape): 'service' | 'practitioner' {
  assertOrderingFitsSurface('backFromVariant', shape);
  if (shape.ordering === 'service_first' && shape.surface === 'combined') return 'practitioner';
  return 'service';
}

export function backFromAddons(
  shape: AppointmentFlowShape,
  ctx: AppointmentSelectionCtx,
): 'variant' | 'service' | 'practitioner' {
  assertOrderingFitsSurface('backFromAddons', shape);
  if (ctx.hasVariants) return 'variant';
  if (shape.ordering === 'service_first' && shape.surface === 'combined') return 'practitioner';
  return 'service';
}

export function backFromPractitioner(
  shape: AppointmentFlowShape,
  ctx: AppointmentSelectionCtx,
): 'addons' | 'variant' | 'service' {
  assertVisitsPractitionerStep('backFromPractitioner', shape);
  // Combined pages chose the calendar before any options, so there is nothing
  // between here and the service list.
  if (shape.surface === 'combined') return 'service';
  if (ctx.hasAddons) return 'addons';
  if (ctx.hasVariants) return 'variant';
  return 'service';
}

export function backFromSlot(
  shape: AppointmentFlowShape,
  ctx: AppointmentSelectionCtx,
): 'addons' | 'variant' | 'service' | 'practitioner' {
  assertOrderingFitsSurface('backFromSlot', shape);
  // Service-first on a normal venue page collected the options before the
  // person, so the person is what sits directly behind the times.
  if (shape.ordering === 'service_first' && shape.surface === 'venue') return 'practitioner';
  if (ctx.hasAddons) return 'addons';
  if (ctx.hasVariants) return 'variant';
  return shape.ordering === 'service_first' && shape.surface === 'combined'
    ? 'practitioner'
    : 'service';
}

/**
 * Whether to offer the pooled "Any available" option. Callers add their own
 * guards: the service-first card is also hidden while editing a booking.
 */
export function anyAvailableCardVisible(
  shape: AppointmentFlowShape,
  { flagOn, listedCount, hasUniformOffering }: AnyAvailableCardInput,
): boolean {
  assertOrderingFitsSurface('anyAvailableCardVisible', shape);
  if (!flagOn || listedCount <= 1) return false;
  // A combined page can only pool an offering that is the same whoever provides
  // it; when none are, the pool could never resolve and the card would lie.
  if (shape.surface === 'combined') return hasUniformOffering === true;
  return true;
}
