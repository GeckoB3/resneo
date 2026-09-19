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
import { screen, waitFor, within } from '@testing-library/react';
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
        harnessService({ collective: harnessCollectiveBlock({ venue_role: 'host' }) }),
        harnessService({ id: 'svc-2', name: 'Massage', collective: harnessCollectiveBlock({ role: 'parked', venue_role: 'host', item_id: null, status: 'hidden', status_reason: 'This service is not on the Northside page.' }) }),
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

  it("gives the host's parked service the page switch and says how to make it bookable", async () => {
    const world = hostWorld();
    await world.ready();
    // Taken off the page: the switch is there, off, to put it back.
    expect(screen.getByRole('switch', { name: 'On the Northside page: Massage' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(
      screen.getByText('Parked while Northside is live. Put it on the page to take bookings for it.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Active (bookable once it is on the page): Massage' })).toBeInTheDocument();
    // Suggesting a service to the host is a member's action; the host would be asking itself.
    expect(screen.queryByRole('button', { name: /Suggest to/ })).not.toBeInTheDocument();
    // The service on the page reads as before.
    expect(screen.getByRole('switch', { name: 'Active (visible to guests): Facial' })).toBeInTheDocument();
    expect(screen.getAllByText(/Parked while Northside is live/)).toHaveLength(1);
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
    // Its own parked service is still its own: it keeps Edit, its switch and its Delete. The switch
    // says when the service would be bookable again, aloud as well as on screen.
    expect(
      screen.getByRole('switch', { name: 'Active (bookable again if you leave Northside): Sauna' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Active (bookable again if you leave Northside)')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(1);
  });

  it("tells a member's staff their calendar choice reaches the collective page", async () => {
    const world = show({
      isAdmin: false,
      linkedPractitionerIds: ['cal-1'],
      services: [harnessService({ collective: harnessCollectiveBlock({ role: 'replica', status: 'up_to_date' }) })],
      practitioners: [{ id: 'cal-1', name: 'Room 1', is_active: true, calendar_type: 'staff', working_hours: {} }],
    });
    await world.ready();
    expect(screen.getByText('Offer on your calendars')).toBeInTheDocument();
    expect(screen.getByText('Your choice updates the Northside page straight away.')).toBeInTheDocument();
  });

  it('suggests a parked service to the host, after asking', async () => {
    // Every service it has is parked, so only the server's venue_role says this is a member.
    const world = show({
      services: [
        harnessService({
          id: 'svc-3',
          name: 'Sauna',
          collective: harnessCollectiveBlock({ role: 'parked', venue_role: 'member', item_id: null, status: 'hidden' }),
        }),
      ],
      routes: { 'POST /api/venue/collectives/': { status: 201, body: { ok: true } } },
    });
    await world.ready();
    await userEvent.click(screen.getByRole('button', { name: 'Suggest to Host Venue' }));
    expect(await screen.findByText('Suggest Sauna for Northside?')).toBeInTheDocument();
    expect(world.requests('POST', '/api/venue/collectives/')).toHaveLength(0);
    await userEvent.click(screen.getByRole('button', { name: 'Send suggestion' }));
    expect(await screen.findByText('Suggestion sent to Host Venue.')).toBeInTheDocument();
    const [request] = world.requests('POST', '/api/venue/collectives/');
    expect(request!.url).toMatch(/\/api\/venue\/collectives\/[^/]+\/suggestions$/);
    expect(request!.body).toEqual({ service_id: 'svc-3' });
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
    // Twice by design: the strip at the top says it once for the venue, the card says it for
    // the service it is about.
    expect(screen.getAllByRole('link', { name: 'Connect Stripe' }).length).toBeGreaterThan(0);
  });
});

describe('putting a service on the page', () => {
  const hostServices = () => [
    harnessService({ collective: harnessCollectiveBlock() }),
    harnessService({
      id: 'svc-2',
      name: 'Massage',
      collective: harnessCollectiveBlock({ role: 'parked', item_id: null, status: 'hidden' }),
    }),
  ];
  const groups = [
    {
      venue_id: 'member',
      venue_name: 'Zen Studio',
      is_host: false,
      sync: { venues: 1, applied: 1, pending: [], failed: [] },
      calendars: [],
    },
  ];

  it('asks before taking a service off the page, then withdraws its offering', async () => {
    const world = show({ services: hostServices(), collectiveCalendars: groups });
    await world.ready();
    await userEvent.click(screen.getByRole('switch', { name: 'On the Northside page: Facial' }));
    const ask = await screen.findByRole('dialog');
    expect(within(ask).getByText('Take Facial off the Northside page?')).toBeInTheDocument();
    expect(world.requests('DELETE', '/api/venue/collectives/')).toHaveLength(0);

    await userEvent.click(within(ask).getByRole('button', { name: 'Take off the page' }));
    await waitFor(() =>
      expect(world.requests('DELETE', '/api/venue/collectives/collective-1/offerings/item-1')).toHaveLength(1),
    );
  });

  it('puts a parked service on the page after the host says yes', async () => {
    const world = show({ services: hostServices(), collectiveCalendars: groups });
    await world.ready();
    const parkedSwitch = screen.getByRole('switch', { name: 'On the Northside page: Massage' });
    expect(parkedSwitch).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(parkedSwitch);
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Add to the page' }));
    await waitFor(() => expect(world.requests('POST', '/api/venue/collectives/collective-1/offerings')).toHaveLength(1));
    expect(world.requests('POST', '/api/venue/collectives/collective-1/offerings')[0]!.body).toEqual({
      service_id: 'svc-2',
    });
  });

  it('offers a new service on the page by default', async () => {
    const world = show({
      services: hostServices(),
      collectiveCalendars: groups,
      routes: { 'POST /api/venue/appointment-services': { status: 201, body: { id: 'svc-new', name: 'Peel' } } },
    });
    await world.ready();
    await userEvent.click(screen.getByRole('button', { name: /add service/i }));
    const dialog = await screen.findByRole('dialog');
    const box = within(dialog).getByRole('checkbox', { name: 'Show on the Northside page' });
    expect(box).toBeChecked();
    expect(within(dialog).getByText(/Sets it up at Zen Studio too/)).toBeInTheDocument();

    await userEvent.type(within(dialog).getByLabelText(/^name/i), 'Peel');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create Service' }));
    await waitFor(() => expect(world.requests('POST', '/api/venue/collectives/collective-1/offerings')).toHaveLength(1));
    expect(world.requests('POST', '/api/venue/collectives/collective-1/offerings')[0]!.body).toEqual({
      service_id: 'svc-new',
    });
  });

  it('leaves a new service parked when the host unticks it', async () => {
    const world = show({
      services: hostServices(),
      collectiveCalendars: groups,
      routes: { 'POST /api/venue/appointment-services': { status: 201, body: { id: 'svc-new', name: 'Peel' } } },
    });
    await world.ready();
    await userEvent.click(screen.getByRole('button', { name: /add service/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Show on the Northside page' }));
    await userEvent.type(within(dialog).getByLabelText(/^name/i), 'Peel');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create Service' }));
    await waitFor(() => expect(world.requests('POST', '/api/venue/appointment-services')).toHaveLength(1));
    expect(world.requests('POST', '/api/venue/collectives/')).toHaveLength(0);
  });

  it('shows neither to a venue outside a collective', async () => {
    const world = show({ services: [harnessService()] });
    await world.ready();
    expect(screen.queryByRole('switch', { name: /On the .* page/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /add service/i }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('checkbox', { name: /Show on the/ })).not.toBeInTheDocument();
  });
});

describe('what needs you', () => {
  it('names a service on the page that no calendar offers, and opens it', async () => {
    const world = show({
      services: [harnessService({ collective: harnessCollectiveBlock() })],
      collectiveCalendars: [
        {
          venue_id: 'host',
          venue_name: 'Host Venue',
          is_host: true,
          sync: { venues: 1, applied: 1, pending: [], failed: [] },
          calendars: [{ id: 'cal-1', name: 'Room 1', is_active: true, assigned: [] }],
        },
      ],
    });
    await world.ready();
    expect(screen.getByRole('heading', { name: 'What needs you' })).toBeInTheDocument();
    expect(
      screen.getByText('Facial is on the page but no calendar offers it, so guests cannot book it.'),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Choose calendars' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('says nothing when there is nothing to do', async () => {
    const world = show({
      services: [harnessService({ collective: harnessCollectiveBlock() })],
      collectiveCalendars: [
        {
          venue_id: 'host',
          venue_name: 'Host Venue',
          is_host: true,
          sync: { venues: 1, applied: 1, pending: [], failed: [] },
          calendars: [
            {
              id: 'cal-1',
              name: 'Room 1',
              is_active: true,
              assigned: [
                {
                  item_id: 'item-1',
                  service_id: 'svc-1',
                  values: {
                    custom_price_pence: null,
                    custom_duration_minutes: null,
                    custom_name: null,
                    custom_description: null,
                    custom_buffer_minutes: null,
                    custom_deposit_pence: null,
                    custom_colour: null,
                  },
                  last_changed: null,
                },
              ],
            },
          ],
        },
      ],
    });
    await world.ready();
    expect(screen.queryByRole('heading', { name: 'What needs you' })).not.toBeInTheDocument();
  });
});

describe("a member looking at the host's service", () => {
  const openView = async () => {
    await userEvent.click(screen.getAllByRole('button', { name: 'View' })[0]!);
    return screen.findByRole('dialog');
  };

  const viewWorld = () =>
    show({
      services: [
        harnessService({
          collective: harnessCollectiveBlock({ role: 'replica', status: 'up_to_date' }),
          price_pence: 6500,
          deposit_pence: null,
          duration_minutes: 45,
        }),
      ],
      practitioners: [
        { id: 'cal-1', name: 'Room 1', is_active: true, calendar_type: 'staff', working_hours: {} },
        { id: 'cal-2', name: 'Room 2', is_active: true, calendar_type: 'staff', working_hours: {} },
      ],
      practitionerServices: [{ practitioner_id: 'cal-1', service_id: 'svc-1' }],
    });

  it('shows the values, not a form of disabled inputs', async () => {
    const world = viewWorld();
    await world.ready();
    const dialog = await openView();
    expect(within(dialog).getByText('£65.00')).toBeInTheDocument();
    expect(within(dialog).getByText('45 min')).toBeInTheDocument();
    expect(within(dialog).getByText('No deposit')).toBeInTheDocument();
    expect(within(dialog).getByText('What Host Venue has set')).toBeInTheDocument();
    // The only inputs are the member's own choices.
    expect(within(dialog).getAllByRole('checkbox')).toHaveLength(2);
    expect(within(dialog).queryByDisplayValue('Facial')).not.toBeInTheDocument();
  });

  it('ticks the calendars that already offer it, and saves the new set', async () => {
    const world = viewWorld();
    await world.ready();
    const dialog = await openView();
    expect(within(dialog).getByRole('checkbox', { name: 'Room 1' })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'Room 2' })).not.toBeChecked();

    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Room 2' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save your settings' }));

    await waitFor(() => expect(world.requests('PATCH', '/api/venue/appointment-services')).toHaveLength(1));
    expect(world.requests('PATCH', '/api/venue/appointment-services')[0]!.body).toEqual({
      id: 'svc-1',
      practitioner_ids: ['cal-1', 'cal-2'],
      expected_calendar_ids: ['cal-1'],
    });
  });

  it('offers no save until something changes', async () => {
    const world = viewWorld();
    await world.ready();
    const dialog = await openView();
    expect(within(dialog).getByRole('button', { name: 'Save your settings' })).toBeDisabled();
  });

  it("shows the refusal when a member's save reached something the host owns", async () => {
    const world = viewWorld();
    await world.ready();
    world.reply('PATCH', '/api/venue/appointment-services', 409, {
      error: 'Host Venue manages this service for Northside, so only Host Venue can change it.',
      code: 'COLLECTIVE_MANAGED_SERVICE',
    });
    const dialog = await openView();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Room 2' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save your settings' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('only Host Venue can change it');
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
