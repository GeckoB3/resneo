/** @vitest-environment happy-dom */
/**
 * The Services page itself (`AppointmentServicesView`).
 *
 * The page's job is to show a venue its catalogue and send exactly what the owner asked for. These
 * cover the parts that would be expensive to get wrong and that no API test can see: what a card
 * says about a service the collective manages, that the Show filter hides nothing it should not,
 * that a save carries the stale check and the collective's calendar diff, and that a 412 asks
 * rather than reporting a failure.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/dashboard/appointment-services',
}));
vi.mock('@/components/providers/VenueFeatureFlagsProvider', () => ({
  useAppointmentsFeatureFlag: () => false,
}));
vi.mock('@/lib/hooks/use-venue-wide-blocks', () => ({ useVenueWideBlocks: () => [] }));
vi.mock('@/hooks/use-calendar-entitlement', () => ({
  useCalendarEntitlement: () => ({ entitlement: null, entitlementLoaded: true, refresh: vi.fn() }),
  canAddCalendarColumn: () => true,
}));

import { AppointmentServicesView } from './AppointmentServicesView';
import {
  harnessCollectiveBlock,
  harnessService,
  renderServicesView,
  type ServicesViewOptions,
} from './services-view-harness';

const show = (options: ServicesViewOptions = {}) => renderServicesView(AppointmentServicesView, options);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the catalogue', () => {
  it("lists the venue's services", async () => {
    const world = show({ services: [harnessService(), harnessService({ id: 'svc-2', name: 'Massage' })] });
    await world.ready();
    expect(screen.getByText('Facial')).toBeInTheDocument();
    expect(screen.getByText('Massage')).toBeInTheDocument();
  });

  it('says so when there is nothing yet', async () => {
    const world = show({ services: [] });
    await world.ready();
    expect(screen.getByText('No services yet')).toBeInTheDocument();
  });

  it('says nothing about a collective at a venue that is not in one', async () => {
    const world = show({ services: [harnessService()] });
    await world.ready();
    expect(screen.queryByText(/You host/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Show')).not.toBeInTheDocument();
    expect(screen.queryByText('Collective')).not.toBeInTheDocument();
  });
});

describe('a venue in a collective', () => {
  const hostWorld = (extra: ServicesViewOptions = {}) =>
    show({
      services: [
        harnessService({ collective: harnessCollectiveBlock() }),
        harnessService({ id: 'svc-2', name: 'Massage', collective: harnessCollectiveBlock({ role: 'parked', item_id: null, status: 'hidden', status_reason: 'This service is not on the Northside page.' }) }),
      ],
      collectiveCalendars: [
        {
          venue_id: 'host',
          venue_name: 'Host Venue',
          is_host: true,
          sync: { venues: 1, applied: 1, pending: [], failed: [] },
          calendars: [{ id: 'cal-1', name: 'Room 1', is_active: true, assigned: [] }],
        },
        {
          venue_id: 'member',
          venue_name: 'Zen Studio',
          is_host: false,
          sync: { venues: 1, applied: 1, pending: [], failed: [] },
          calendars: [{ id: 'cal-9', name: 'Chair 2', is_active: true, assigned: [] }],
        },
      ],
      ...extra,
    });

  it('says which collective it is and which venues a save reaches', async () => {
    const world = hostWorld();
    await world.ready();
    expect(screen.getByText('You host Northside')).toBeInTheDocument();
    expect(screen.getByText(/the change reaches Zen Studio/)).toBeInTheDocument();
  });

  it('marks what is on the page and what is parked', async () => {
    const world = hostWorld();
    await world.ready();
    expect(screen.getByText('Collective')).toBeInTheDocument();
    expect(screen.getByText('Parked')).toBeInTheDocument();
  });

  it('shows only what the filter asks for', async () => {
    const world = hostWorld();
    await world.ready();
    await userEvent.selectOptions(screen.getByLabelText('Show'), 'parked');
    expect(screen.queryByText('Facial')).not.toBeInTheDocument();
    expect(screen.getByText('Massage')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Show'), 'on_page');
    expect(screen.getByText('Facial')).toBeInTheDocument();
    expect(screen.queryByText('Massage')).not.toBeInTheDocument();
  });

  it('only offers reordering with every service in view, and says why', async () => {
    const world = hostWorld();
    await world.ready();
    expect(screen.getByLabelText('Reorder Facial')).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Show'), 'parked');
    expect(screen.queryByLabelText('Reorder Massage')).not.toBeInTheDocument();
    expect(screen.getByText('Show all services to change their order.')).toBeInTheDocument();
  });
});

describe('a member of a collective', () => {
  const memberWorld = () =>
    show({
      services: [
        harnessService({
          collective: harnessCollectiveBlock({ role: 'replica', status: 'up_to_date' }),
        }),
        harnessService({
          id: 'svc-2',
          name: 'Massage',
          collective: harnessCollectiveBlock({ role: 'retired', status: 'up_to_date' }),
        }),
        harnessService({
          id: 'svc-3',
          name: 'Sauna',
          collective: harnessCollectiveBlock({ role: 'parked', item_id: null, status: 'hidden' }),
        }),
      ],
    });

  it('sorts its services into what the host manages, what it retired, and what is parked', async () => {
    const world = memberWorld();
    await world.ready();
    expect(screen.getByRole('heading', { name: 'From Host Venue' })).toBeInTheDocument();
    expect(screen.getByText(/No longer offered by Host Venue/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Parked while you are part of Northside' })).toBeInTheDocument();
    expect(screen.getByText('Managed by Host Venue for Northside')).toBeInTheDocument();
  });

  it('cannot change a service the host manages, and says View rather than Edit', async () => {
    const world = memberWorld();
    await world.ready();
    expect(screen.queryByRole('switch', { name: /Active \(visible to guests\): Facial/ })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'View' }).length).toBe(2);
    // Its own parked service is still its own: it keeps Edit, its switch and its Delete.
    expect(screen.getByRole('switch', { name: /Active \(visible to guests\): Sauna/ })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1);
  });

  it('does not offer to reorder the collective page', async () => {
    const world = memberWorld();
    await world.ready();
    expect(screen.queryByLabelText('Reorder Facial')).not.toBeInTheDocument();
  });

  it("says what is happening to a copy that is not ready, in the venue's own terms", async () => {
    const world = show({
      services: [
        harnessService({
          collective: harnessCollectiveBlock({ role: 'replica', status: 'setting_up' }),
        }),
        harnessService({
          id: 'svc-2',
          name: 'Massage',
          collective: harnessCollectiveBlock({
            role: 'replica',
            status: 'hidden',
            hidden_reasons: [{ venue_id: 'member', venue_name: 'Zen Studio', reason: 'payments' }],
          }),
        }),
      ],
    });
    await world.ready();
    expect(
      screen.getByText('Setting up. Guests can book it on your calendars once this finishes.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/until you connect Stripe/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Connect Stripe' })).toBeInTheDocument();
  });
});

describe('saving a service', () => {
  const openFirstService = async () => {
    const edit = screen.getAllByRole('button', { name: /edit/i })[0];
    await userEvent.click(edit!);
    await screen.findByRole('dialog');
  };

  it('sends the version it loaded, so a save from a stale copy can be refused', async () => {
    const world = show({ services: [harnessService()] });
    await world.ready();
    await openFirstService();
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => expect(world.requests('PATCH', '/api/venue/appointment-services')).toHaveLength(1));
    expect(world.requests('PATCH', '/api/venue/appointment-services')[0]!.body).toMatchObject({
      id: 'svc-1',
      expected_updated_at: '2026-09-16T09:00:00Z',
    });
  });

  it('asks to reload when someone else saved first, instead of reporting a failure', async () => {
    const world = show({ services: [harnessService()] });
    await world.ready();
    world.reply('PATCH', '/api/venue/appointment-services', 412, {
      error: 'This service changed while you were editing it.',
      code: 'STALE_RESOURCE',
    });
    await openFirstService();
    await userEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(await screen.findByText('Facial changed while you were editing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload service' })).toBeInTheDocument();
  });

  it('carries the collective calendar ticks as a diff, and shows how far the save reached', async () => {
    const world = show({
      services: [harnessService({ collective: harnessCollectiveBlock() })],
      collectiveCalendars: [
        {
          venue_id: 'member',
          venue_name: 'Zen Studio',
          is_host: false,
          sync: { venues: 1, applied: 1, pending: [], failed: [] },
          calendars: [{ id: 'cal-9', name: 'Chair 2', is_active: true, assigned: [] }],
        },
      ],
    });
    await world.ready();
    world.reply('PATCH', '/api/venue/appointment-services', 200, {
      id: 'svc-1',
      collective_sync: { venues: 1, applied: 1, pending: [], failed: [], audit_event_id: 'audit-1' },
    });
    await openFirstService();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Chair 2 at Zen Studio' }));
    await userEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => expect(world.requests('PATCH', '/api/venue/appointment-services')).toHaveLength(1));
    expect(world.requests('PATCH', '/api/venue/appointment-services')[0]!.body).toMatchObject({
      collective_calendars: { add: [{ calendar_id: 'cal-9', venue_id: 'member' }], remove: [] },
    });
    expect(await screen.findByText(/is up to date at/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Put it back/ })).toBeInTheDocument();
  });
});
