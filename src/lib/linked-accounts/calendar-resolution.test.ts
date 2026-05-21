import { describe, expect, it } from 'vitest';
import {
  linkedBookingBarDetailLabel,
  linkedColumnUsesNativeGrid,
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
  it('shows service name for full_details links when available', () => {
    expect(
      linkedBookingBarDetailLabel(
        { guestName: 'Alex', serviceName: 'Cut & blow dry' },
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
    ).toBe('Partner Salon — busy');
  });
});

describe('resolveLinkedGridPractitionerIdForPatch', () => {
  it('strips the linked column namespace', () => {
    expect(resolveLinkedGridPractitionerIdForPatch('linked:venue-1:cal-9')).toBe('cal-9');
    expect(resolveLinkedGridPractitionerIdForPatch('native-id')).toBe('native-id');
  });
});
