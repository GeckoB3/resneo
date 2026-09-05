/**
 * @vitest-environment happy-dom
 * @vitest-environment-options { "settings": { "disableCSSFileLoading": true, "disableJavaScriptFileLoading": true, "disableIframePageLoading": true } }
 */
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { CreateLinkedBookingModal } from './LinkedCalendarView';
import type { LinkedVenueCalendar } from '@/lib/linked-accounts/calendar';

/**
 * The linked-calendar API keeps archived services in its list so an existing
 * booking still has a duration and processing pattern to paint. The new-booking
 * picker must not offer them: staff could otherwise book a retired service.
 */
function buildVenue(): LinkedVenueCalendar {
  return {
    venueId: 'venue-1',
    venueName: 'Light 3',
    linkId: 'link-1',
    visibility: 'full_details',
    action: 'create_edit_cancel',
    pii: true,
    practitioners: [{ id: 'cal-1', name: 'Light 3', isActive: true }],
    services: [
      { id: 'svc-live', name: 'Haircut', isActive: true },
      { id: 'svc-gone', name: 'Retired Perm', isActive: false },
      { id: 'svc-live-2', name: 'Beard Trim', isActive: true },
    ],
    resources: [],
    bookings: [],
  };
}

describe('CreateLinkedBookingModal service picker', () => {
  it('offers only the owner venue’s active services', () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"guests":[]}', { status: 200 })));
    render(
      <CreateLinkedBookingModal
        venue={buildVenue()}
        date="2026-09-04"
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    const picker = screen.getByLabelText('Service (optional)') as HTMLSelectElement;
    const names = within(picker)
      .getAllByRole('option')
      .map((o) => o.textContent?.trim());
    expect(names).toEqual(['No service', 'Haircut', 'Beard Trim']);
    expect(names).not.toContain('Retired Perm');
    vi.unstubAllGlobals();
  });
});
