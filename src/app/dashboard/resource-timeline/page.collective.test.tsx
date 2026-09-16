/** @vitest-environment happy-dom */
/**
 * BM-05 (D45): a venue in a collective is told rooms and equipment are not shared, rather than
 * left to find out through a double booking. A venue on its own sees no note.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => ({})) }));
vi.mock('@/lib/venue-auth', () => ({
  getDashboardStaff: vi.fn(async () => ({ id: 'staff-1', venue_id: 'venue-1', role: 'admin' })),
  getStaffManagedCalendarIds: vi.fn(async () => []),
}));
vi.mock('@/lib/supabase', () => ({
  getSupabaseAdminClient: vi.fn(() => ({
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { currency: 'GBP', stripe_connected_account_id: null } }) }) }),
    }),
  })),
}));
vi.mock('@/lib/linked-accounts/collective-venue-locks', () => ({ findCollectiveLockForVenue: vi.fn() }));
vi.mock('./ResourceTimelineView', () => ({ ResourceTimelineView: () => <div>timeline</div> }));

import { findCollectiveLockForVenue } from '@/lib/linked-accounts/collective-venue-locks';
import ResourceTimelinePage from './page';

const NOTE =
  "Rooms and equipment are not shared between venues. If two venues use the same room, keep it on one venue's calendars only.";

beforeEach(() => {
  vi.mocked(findCollectiveLockForVenue).mockReset();
});
afterEach(cleanup);

describe('Resources page in a collective', () => {
  it('says rooms and equipment are not shared', async () => {
    vi.mocked(findCollectiveLockForVenue).mockResolvedValue({
      collectiveId: 'c-1',
      collectiveName: 'Northside',
      hostVenueId: 'venue-2',
    });
    render(await ResourceTimelinePage());
    expect(screen.getByRole('note')).toHaveTextContent(NOTE);
    expect(screen.getByText('timeline')).toBeInTheDocument();
  });

  it('says nothing for a venue on its own', async () => {
    vi.mocked(findCollectiveLockForVenue).mockResolvedValue(null);
    render(await ResourceTimelinePage());
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });
});
