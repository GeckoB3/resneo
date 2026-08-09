import { describe, expect, it } from 'vitest';
import {
  afterAddons,
  afterPractitioner,
  afterService,
  afterStaffPick,
  afterVariant,
  anyAvailableCardVisible,
  backFromAddons,
  backFromPractitioner,
  backFromService,
  backFromSlot,
  backFromStaffPick,
  backFromVariant,
  type AppointmentFlowShape,
  type AppointmentSelectionCtx,
} from '@/lib/booking/appointment-flow-order';
import { appointmentProgressPhase } from '@/components/booking/appointment-public-ui';

/**
 * Every service-first expectation below is the behaviour `AppointmentBookingFlow`
 * had before this feature existed, so that turning the flag off can never drift.
 * Line references are to that component at commit 38a7f64f, the baseline the
 * staff-first plan was written against.
 *
 * The one deliberate service-first change is marked FIX 4.11: a per-practitioner
 * page's Back from the times list skipped the add-ons step, while the equivalent
 * combined-page path unwound through it correctly.
 */

const vSF: AppointmentFlowShape = { ordering: 'service_first', surface: 'venue' };
const cSF: AppointmentFlowShape = { ordering: 'service_first', surface: 'combined' };
const lSF: AppointmentFlowShape = { ordering: 'service_first', surface: 'locked' };
const vStF: AppointmentFlowShape = { ordering: 'staff_first', surface: 'venue' };
const cStF: AppointmentFlowShape = { ordering: 'staff_first', surface: 'combined' };

const REACHABLE_SHAPES = [vSF, cSF, lSF, vStF, cStF];

const plain: AppointmentSelectionCtx = { hasVariants: false, hasAddons: false };
const variants: AppointmentSelectionCtx = { hasVariants: true, hasAddons: false };
const addons: AppointmentSelectionCtx = { hasVariants: false, hasAddons: true };
const both: AppointmentSelectionCtx = { hasVariants: true, hasAddons: true };
const ALL_CTX = [plain, variants, addons, both];

function label(shape: AppointmentFlowShape, ctx?: AppointmentSelectionCtx): string {
  const options = ctx
    ? ` (variants=${ctx.hasVariants ? 'y' : 'n'} addons=${ctx.hasAddons ? 'y' : 'n'})`
    : '';
  return `${shape.ordering} on ${shape.surface}${options}`;
}

/** Every cell of the matrix must be stated, so a missed combination fails here. */
function expectTotal<T>(rows: Array<[AppointmentFlowShape, AppointmentSelectionCtx, T]>): void {
  expect(rows).toHaveLength(REACHABLE_SHAPES.length * ALL_CTX.length);
}

describe('afterService', () => {
  // Combined pages resolve the calendar first (2841-2844); elsewhere variants beat
  // add-ons (2845-2853) and a locked page already knows the person (2867-2870).
  const rows: Array<[AppointmentFlowShape, AppointmentSelectionCtx, string]> = [
    [vSF, plain, 'practitioner'],
    [vSF, variants, 'variant'],
    [vSF, addons, 'addons'],
    [vSF, both, 'variant'],
    [cSF, plain, 'practitioner'],
    [cSF, variants, 'practitioner'],
    [cSF, addons, 'practitioner'],
    [cSF, both, 'practitioner'],
    [lSF, plain, 'slot'],
    [lSF, variants, 'variant'],
    [lSF, addons, 'addons'],
    [lSF, both, 'variant'],
    [vStF, plain, 'slot'],
    [vStF, variants, 'variant'],
    [vStF, addons, 'addons'],
    [vStF, both, 'variant'],
    [cStF, plain, 'slot'],
    [cStF, variants, 'variant'],
    [cStF, addons, 'addons'],
    [cStF, both, 'variant'],
  ];
  expectTotal(rows);

  it.each(rows)('%# %s', (shape, ctx, expected) => {
    expect(afterService(shape, ctx), label(shape, ctx)).toBe(expected);
  });

  it('never sends a staff-first session to the practitioner step', () => {
    for (const shape of [vStF, cStF]) {
      for (const ctx of ALL_CTX) {
        expect(afterService(shape, ctx)).not.toBe('practitioner');
      }
    }
  });
});

describe('afterVariant', () => {
  // Add-ons come next when the service has them (3060-3076); otherwise only a
  // plain venue page still owes the guest a person (3094).
  const rows: Array<[AppointmentFlowShape, AppointmentSelectionCtx, string]> = [
    [vSF, plain, 'practitioner'],
    [vSF, variants, 'practitioner'],
    [vSF, addons, 'addons'],
    [vSF, both, 'addons'],
    [cSF, plain, 'slot'],
    [cSF, variants, 'slot'],
    [cSF, addons, 'addons'],
    [cSF, both, 'addons'],
    [lSF, plain, 'slot'],
    [lSF, variants, 'slot'],
    [lSF, addons, 'addons'],
    [lSF, both, 'addons'],
    [vStF, plain, 'slot'],
    [vStF, variants, 'slot'],
    [vStF, addons, 'addons'],
    [vStF, both, 'addons'],
    [cStF, plain, 'slot'],
    [cStF, variants, 'slot'],
    [cStF, addons, 'addons'],
    [cStF, both, 'addons'],
  ];
  expectTotal(rows);

  it.each(rows)('%# %s', (shape, ctx, expected) => {
    expect(afterVariant(shape, ctx), label(shape, ctx)).toBe(expected);
  });
});

describe('afterAddons', () => {
  // 3338: locked and combined pages already have the calendar, so they go to times.
  const rows: Array<[AppointmentFlowShape, string]> = [
    [vSF, 'practitioner'],
    [cSF, 'slot'],
    [lSF, 'slot'],
    [vStF, 'slot'],
    [cStF, 'slot'],
  ];
  expect(rows).toHaveLength(REACHABLE_SHAPES.length);

  it.each(rows)('%# %s', (shape, expected) => {
    expect(afterAddons(shape), label(shape)).toBe(expected);
  });

  it('keeps edit sessions on the service-first cell', () => {
    // Edits run service-first and have no short-circuit in `advanceFromAddons`,
    // so a venue edit still lands on the practitioner step exactly as it did.
    expect(afterAddons(vSF)).toBe('practitioner');
  });
});

describe('afterPractitioner', () => {
  // Combined pages collect the chosen calendar's own options next (3595-3605);
  // a normal venue page has already collected them (3606).
  const rows: Array<[AppointmentFlowShape, AppointmentSelectionCtx, string]> = [
    [vSF, plain, 'slot'],
    [vSF, variants, 'slot'],
    [vSF, addons, 'slot'],
    [vSF, both, 'slot'],
    [cSF, plain, 'slot'],
    [cSF, variants, 'variant'],
    [cSF, addons, 'addons'],
    [cSF, both, 'variant'],
  ];

  it.each(rows)('%# %s', (shape, ctx, expected) => {
    expect(afterPractitioner(shape, ctx), label(shape, ctx)).toBe(expected);
  });
});

describe('backFromStaffPick', () => {
  it('returns to the single-or-group chooser on a venue page', () => {
    expect(backFromStaffPick(vStF)).toBe('mode_choice');
  });

  it('has nothing behind it on a combined page', () => {
    expect(backFromStaffPick(cStF)).toBeNull();
  });
});

describe('backFromService', () => {
  // 2787-2796: only a normal venue page has a chooser behind the service list.
  const rows: Array<[AppointmentFlowShape, string | null]> = [
    [vSF, 'mode_choice'],
    [cSF, null],
    [lSF, null],
    [vStF, 'staff_pick'],
    [cStF, 'staff_pick'],
  ];
  expect(rows).toHaveLength(REACHABLE_SHAPES.length);

  it.each(rows)('%# %s', (shape, expected) => {
    expect(backFromService(shape), label(shape)).toBe(expected);
  });
});

describe('backFromVariant', () => {
  // 3020-3028: combined unwinds to the calendar, everyone else to the services.
  const rows: Array<[AppointmentFlowShape, string]> = [
    [vSF, 'service'],
    [cSF, 'practitioner'],
    [lSF, 'service'],
    [vStF, 'service'],
    [cStF, 'service'],
  ];
  expect(rows).toHaveLength(REACHABLE_SHAPES.length);

  it.each(rows)('%# %s', (shape, expected) => {
    expect(backFromVariant(shape), label(shape)).toBe(expected);
  });
});

describe('backFromAddons', () => {
  // 3352-3357: variants sit between add-ons and whatever came before them.
  const rows: Array<[AppointmentFlowShape, AppointmentSelectionCtx, string]> = [
    [vSF, plain, 'service'],
    [vSF, variants, 'variant'],
    [vSF, addons, 'service'],
    [vSF, both, 'variant'],
    [cSF, plain, 'practitioner'],
    [cSF, variants, 'variant'],
    [cSF, addons, 'practitioner'],
    [cSF, both, 'variant'],
    [lSF, plain, 'service'],
    [lSF, variants, 'variant'],
    [lSF, addons, 'service'],
    [lSF, both, 'variant'],
    [vStF, plain, 'service'],
    [vStF, variants, 'variant'],
    [vStF, addons, 'service'],
    [vStF, both, 'variant'],
    [cStF, plain, 'service'],
    [cStF, variants, 'variant'],
    [cStF, addons, 'service'],
    [cStF, both, 'variant'],
  ];
  expectTotal(rows);

  it.each(rows)('%# %s', (shape, ctx, expected) => {
    expect(backFromAddons(shape, ctx), label(shape, ctx)).toBe(expected);
  });
});

describe('backFromPractitioner', () => {
  // 3481-3514: add-ons are checked before variants here, and a combined page has
  // nothing between the calendar and the service list.
  const rows: Array<[AppointmentFlowShape, AppointmentSelectionCtx, string]> = [
    [vSF, plain, 'service'],
    [vSF, variants, 'variant'],
    [vSF, addons, 'addons'],
    [vSF, both, 'addons'],
    [cSF, plain, 'service'],
    [cSF, variants, 'service'],
    [cSF, addons, 'service'],
    [cSF, both, 'service'],
  ];

  it.each(rows)('%# %s', (shape, ctx, expected) => {
    expect(backFromPractitioner(shape, ctx), label(shape, ctx)).toBe(expected);
  });
});

describe('backFromSlot', () => {
  // 3635-3661 for the service-first cells. The locked add-ons cells are FIX 4.11.
  const rows: Array<[AppointmentFlowShape, AppointmentSelectionCtx, string]> = [
    [vSF, plain, 'practitioner'],
    [vSF, variants, 'practitioner'],
    [vSF, addons, 'practitioner'],
    [vSF, both, 'practitioner'],
    [cSF, plain, 'practitioner'],
    [cSF, variants, 'variant'],
    [cSF, addons, 'addons'],
    [cSF, both, 'addons'],
    [lSF, plain, 'service'],
    [lSF, variants, 'variant'],
    [lSF, addons, 'addons'],
    [lSF, both, 'addons'],
    [vStF, plain, 'service'],
    [vStF, variants, 'variant'],
    [vStF, addons, 'addons'],
    [vStF, both, 'addons'],
    [cStF, plain, 'service'],
    [cStF, variants, 'variant'],
    [cStF, addons, 'addons'],
    [cStF, both, 'addons'],
  ];
  expectTotal(rows);

  it.each(rows)('%# %s', (shape, ctx, expected) => {
    expect(backFromSlot(shape, ctx), label(shape, ctx)).toBe(expected);
  });

  it('FIX 4.11: a per-practitioner page now unwinds through add-ons', () => {
    // Before this change the locked branch jumped past the add-ons step to the
    // variants (or the service list), stranding the guest's chosen extras.
    expect(backFromSlot(lSF, addons)).toBe('addons');
    expect(backFromSlot(lSF, both)).toBe('addons');
    // Unchanged where there are no add-ons to unwind through.
    expect(backFromSlot(lSF, variants)).toBe('variant');
    expect(backFromSlot(lSF, plain)).toBe('service');
  });
});

describe('anyAvailableCardVisible', () => {
  it('needs the venue setting on', () => {
    expect(anyAvailableCardVisible(vStF, { flagOn: false, listedCount: 3 })).toBe(false);
  });

  it('needs more than one person to pool', () => {
    expect(anyAvailableCardVisible(vStF, { flagOn: true, listedCount: 1 })).toBe(false);
    expect(anyAvailableCardVisible(vStF, { flagOn: true, listedCount: 0 })).toBe(false);
    expect(anyAvailableCardVisible(vStF, { flagOn: true, listedCount: 2 })).toBe(true);
  });

  it('shows on a venue page in either ordering', () => {
    expect(anyAvailableCardVisible(vSF, { flagOn: true, listedCount: 2 })).toBe(true);
    expect(anyAvailableCardVisible(vStF, { flagOn: true, listedCount: 2 })).toBe(true);
  });

  it('needs a uniform offering on a combined page', () => {
    expect(
      anyAvailableCardVisible(cStF, { flagOn: true, listedCount: 3, hasUniformOffering: true }),
    ).toBe(true);
    expect(
      anyAvailableCardVisible(cStF, { flagOn: true, listedCount: 3, hasUniformOffering: false }),
    ).toBe(false);
  });

  it('hides on a combined page when the caller says nothing about uniformity', () => {
    expect(anyAvailableCardVisible(cStF, { flagOn: true, listedCount: 3 })).toBe(false);
  });
});

describe('unreachable combinations', () => {
  const everyFn: Array<[string, (shape: AppointmentFlowShape) => unknown]> = [
    ['afterStaffPick', (s) => afterStaffPick(s)],
    ['afterService', (s) => afterService(s, plain)],
    ['afterVariant', (s) => afterVariant(s, plain)],
    ['afterAddons', (s) => afterAddons(s)],
    ['afterPractitioner', (s) => afterPractitioner(s, plain)],
    ['backFromStaffPick', (s) => backFromStaffPick(s)],
    ['backFromService', (s) => backFromService(s)],
    ['backFromVariant', (s) => backFromVariant(s)],
    ['backFromAddons', (s) => backFromAddons(s, plain)],
    ['backFromPractitioner', (s) => backFromPractitioner(s, plain)],
    ['backFromSlot', (s) => backFromSlot(s, plain)],
    ['anyAvailableCardVisible', (s) => anyAvailableCardVisible(s, { flagOn: true, listedCount: 2 })],
  ];

  it.each(everyFn)('%s throws for staff-first on a per-practitioner page', (_name, call) => {
    expect(() => call({ ordering: 'staff_first', surface: 'locked' })).toThrow(/unreachable/);
  });

  it.each([vSF, cSF, lSF])('the staff picker does not exist in service-first (%o)', (shape) => {
    expect(() => afterStaffPick(shape)).toThrow(/unreachable/);
    expect(() => backFromStaffPick(shape)).toThrow(/unreachable/);
  });

  it.each([vStF, cStF])('staff-first never visits the practitioner step (%o)', (shape) => {
    expect(() => afterPractitioner(shape, plain)).toThrow(/unreachable/);
    expect(() => backFromPractitioner(shape, plain)).toThrow(/unreachable/);
  });

  it('a per-practitioner page never visits the practitioner step', () => {
    expect(() => afterPractitioner(lSF, plain)).toThrow(/unreachable/);
    expect(() => backFromPractitioner(lSF, plain)).toThrow(/unreachable/);
  });
});

describe('appointmentProgressPhase', () => {
  it('counts both staff pickers as part of choosing', () => {
    expect(appointmentProgressPhase('staff_pick')).toEqual({ phase: 0, label: 'Choose' });
    expect(appointmentProgressPhase('group_staff_pick')).toEqual({ phase: 0, label: 'Choose' });
  });

  it('leaves the existing phases alone', () => {
    expect(appointmentProgressPhase('service')).toEqual({ phase: 0, label: 'Choose' });
    expect(appointmentProgressPhase('slot')).toEqual({ phase: 1, label: 'Schedule' });
    expect(appointmentProgressPhase('details')).toEqual({ phase: 2, label: 'Confirm' });
    expect(appointmentProgressPhase('confirmation')).toBeNull();
  });
});
