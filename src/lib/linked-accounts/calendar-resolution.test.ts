import { describe, expect, it } from 'vitest';
import {
  linkedBookingBarDetailLabel,
  linkedColumnUsesNativeGrid,
  linkedGrantActForOwnerVenue,
  resolveLinkedBookingColumnId,
  resolveLinkedGridPractitionerIdForPatch,
} from './calendar';

describe('resolveLinkedBookingColumnId', () => {
  it('prefers practitioner_id over calendar_id (matches native calendar grid)', () => {
    expect(
      resolveLinkedBookingColumnId({
        practitioner_id: 'prac-1',
        calendar_id: 'cal-2',
      }),
    ).toBe('prac-1');
  });

  it('falls back to calendar_id when practitioner_id is empty', () => {
    expect(
      resolveLinkedBookingColumnId({
        practitioner_id: null,
        calendar_id: 'cal-2',
      }),
    ).toBe('cal-2');
  });

  it('prefers the id that matches a known column when both are set', () => {
    const columns = new Set(['cal-2']);
    expect(
      resolveLinkedBookingColumnId(
        { practitioner_id: 'legacy-prac', calendar_id: 'cal-2' },
        columns,
      ),
    ).toBe('cal-2');
  });

  it('returns null when neither column key is set', () => {
    expect(resolveLinkedBookingColumnId({ practitioner_id: null, calendar_id: null })).toBeNull();
  });

  it('maps resource bookings onto the host staff column', () => {
    const columns = new Set(['host-col']);
    const resourceParent = new Map([['room-a', 'host-col']]);
    expect(
      resolveLinkedBookingColumnId(
        { practitioner_id: null, calendar_id: 'room-a', resource_id: 'room-a' },
        columns,
        resourceParent,
      ),
    ).toBe('host-col');
  });

  it('maps resource bookings when only calendar_id is the resource uuid', () => {
    const columns = new Set(['host-col']);
    const resourceParent = new Map([['room-a', 'host-col']]);
    expect(
      resolveLinkedBookingColumnId(
        { practitioner_id: null, calendar_id: 'room-a', resource_id: null },
        columns,
        resourceParent,
      ),
    ).toBe('host-col');
  });

  it('maps resource bookings when only resource_id is set', () => {
    const columns = new Set(['host-col']);
    const resourceParent = new Map([['room-a', 'host-col']]);
    expect(
      resolveLinkedBookingColumnId(
        { practitioner_id: null, calendar_id: null, resource_id: 'room-a' },
        columns,
        resourceParent,
      ),
    ).toBe('host-col');
  });

  it('leaves unassigned resources without a host column mapping', () => {
    const columns = new Set(['host-col']);
    const resourceParent = new Map([['room-a', 'host-col']]);
    expect(
      resolveLinkedBookingColumnId(
        { practitioner_id: null, calendar_id: 'room-b', resource_id: 'room-b' },
        columns,
        resourceParent,
      ),
    ).toBe('room-b');
  });

  it('maps event ticket bookings onto the event calendar column', () => {
    const columns = new Set(['events-col']);
    expect(
      resolveLinkedBookingColumnId(
        { practitioner_id: null, calendar_id: null, experience_event_id: 'ev-1' },
        columns,
        undefined,
        { eventCalendarId: 'events-col' },
      ),
    ).toBe('events-col');
  });

  it('maps class session bookings onto the instructor calendar column', () => {
    const columns = new Set(['instructor-col']);
    expect(
      resolveLinkedBookingColumnId(
        { practitioner_id: null, calendar_id: null, class_instance_id: 'ci-1' },
        columns,
        undefined,
        { classCalendarId: 'instructor-col' },
      ),
    ).toBe('instructor-col');
  });
});

describe('linkedColumnUsesNativeGrid', () => {
  it('is true for full_details with edit grants', () => {
    expect(
      linkedColumnUsesNativeGrid({ visibility: 'full_details', action: 'create_edit_cancel' }),
    ).toBe(true);
    expect(linkedColumnUsesNativeGrid({ visibility: 'full_details', action: 'edit_existing' })).toBe(
      true,
    );
  });

  it('is false for time_only or view-only links', () => {
    expect(linkedColumnUsesNativeGrid({ visibility: 'time_only', action: 'create_edit_cancel' })).toBe(
      false,
    );
    expect(linkedColumnUsesNativeGrid({ visibility: 'full_details', action: 'none' })).toBe(
      false,
    );
  });
});

describe('linkedBookingBarDetailLabel', () => {
  it('shows guest name for full_details links when available', () => {
    expect(
      linkedBookingBarDetailLabel(
        { guestName: 'Alex', serviceName: 'Cut & blow dry' },
        'full_details',
        'Partner Salon',
      ),
    ).toBe('Alex');
  });

  it('falls back to service when full_details has no guest name', () => {
    expect(
      linkedBookingBarDetailLabel(
        { guestName: null, serviceName: 'Cut & blow dry' },
        'full_details',
        'Partner Salon',
      ),
    ).toBe('Cut & blow dry');
  });

  it('masks time_only links as busy', () => {
    expect(
      linkedBookingBarDetailLabel(
        { guestName: 'Alex', serviceName: 'Cut & blow dry' },
        'time_only',
        'Partner Salon',
      ),
    ).toBe('Partner Salon: busy');
  });
});

describe('linkedGrantActForOwnerVenue', () => {
  it('returns the linked venue grant act for ExpandedBookingContent', () => {
    expect(
      linkedGrantActForOwnerVenue(
        [{ venueId: 'owner-a', action: 'edit_existing' }],
        'owner-a',
      ),
    ).toBe('edit_existing');
  });

  it('defaults to none when the owner venue is unknown', () => {
    expect(linkedGrantActForOwnerVenue([], 'missing')).toBe('none');
  });
});

describe('resolveLinkedGridPractitionerIdForPatch', () => {
  it('strips the linked column namespace', () => {
    expect(resolveLinkedGridPractitionerIdForPatch('linked:venue-1:cal-9')).toBe('cal-9');
    expect(resolveLinkedGridPractitionerIdForPatch('native-id')).toBe('native-id');
  });
});
