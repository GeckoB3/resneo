/** @vitest-environment happy-dom */
/**
 * Which calendars offer a service, across the collective (UX spec §2 item 1; plan §6.7).
 *
 * The guards that matter: the host's own venue is not a special case in the markup, a tick is held
 * as intent rather than as a picture of the whole set (so two venues saving at once cannot undo
 * each other), and a venue that cannot take the bookings says why on its own group.
 */
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  CollectiveCalendarsSection,
  EMPTY_CALENDARS_VALUE,
  type CollectiveCalendarsValue,
} from './CollectiveCalendarsSection';
import type { CollectiveCalendarGroup } from '@/lib/linked-accounts/replicas/host-calendars';

const ITEM = 'item-1';

const values = (overrides: Record<string, unknown> = {}) => ({
  custom_price_pence: null,
  custom_duration_minutes: null,
  custom_name: null,
  custom_description: null,
  custom_buffer_minutes: null,
  custom_deposit_pence: null,
  custom_colour: null,
  ...overrides,
});

const groups = (): CollectiveCalendarGroup[] => [
  {
    venue_id: 'host',
    venue_name: 'Host Venue',
    is_host: true,
    sync: { venues: 1, applied: 1, pending: [], failed: [] },
    calendars: [
      {
        id: 'cal-host',
        name: 'Room 1',
        is_active: true,
        assigned: [
          {
            item_id: ITEM,
            service_id: 'svc-master',
            values: values({ custom_price_pence: 7000 }),
            last_changed: null,
          },
        ],
      },
      { id: 'cal-host-2', name: 'Room 2', is_active: true, assigned: [] },
    ],
  },
  {
    venue_id: 'member',
    venue_name: 'Zen Studio',
    is_host: false,
    sync: { venues: 1, applied: 0, pending: [{ venue_id: 'member', venue_name: 'Zen Studio' }], failed: [] },
    calendars: [{ id: 'cal-member', name: 'Chair 2', is_active: true, assigned: [] }],
  },
];

function show(props: Partial<React.ComponentProps<typeof CollectiveCalendarsSection>> = {}) {
  const onChange = vi.fn();
  render(
    <CollectiveCalendarsSection
      groups={groups()}
      itemId={ITEM}
      collectiveName="Northside"
      value={EMPTY_CALENDARS_VALUE}
      onChange={onChange}
      {...props}
    />,
  );
  return { onChange };
}

describe('CollectiveCalendarsSection', () => {
  it('shows the host first and marks it as you', () => {
    show();
    const headings = screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent);
    expect(headings).toEqual(['Host Venue (you)', 'Zen Studio']);
  });

  it('ticks the calendars that already offer this service', () => {
    show();
    expect(screen.getByRole('checkbox', { name: 'Room 1 at Host Venue' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Chair 2 at Zen Studio' })).not.toBeChecked();
  });

  it('records a new tick as an addition, not as the whole set', async () => {
    const { onChange } = show();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Chair 2 at Zen Studio' }));
    expect(onChange).toHaveBeenCalledWith({
      add: [{ calendar_id: 'cal-member', venue_id: 'member' }],
      remove: [],
    });
  });

  it('records an untick as a removal', async () => {
    const { onChange } = show();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Room 1 at Host Venue' }));
    expect(onChange).toHaveBeenCalledWith({
      add: [],
      remove: [{ calendar_id: 'cal-host', venue_id: 'host' }],
    });
  });

  it('takes a tick back off the diff when it is undone before saving', async () => {
    const value: CollectiveCalendarsValue = {
      add: [{ calendar_id: 'cal-member', venue_id: 'member' }],
      remove: [],
    };
    const { onChange } = show({ value });
    expect(screen.getByRole('checkbox', { name: 'Chair 2 at Zen Studio' })).toBeChecked();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Chair 2 at Zen Studio' }));
    expect(onChange).toHaveBeenCalledWith({ add: [], remove: [] });
  });

  it('marks what is not saved yet', () => {
    show({
      value: {
        add: [{ calendar_id: 'cal-member', venue_id: 'member' }],
        remove: [{ calendar_id: 'cal-host', venue_id: 'host' }],
      },
    });
    expect(screen.getByText('Not saved yet')).toBeInTheDocument();
    expect(screen.getByText('Not saved yet: will stop offering')).toBeInTheDocument();
  });

  it("shows a calendar's own price as a chip, and the standard elsewhere in the table", () => {
    show();
    expect(screen.getByText('Custom price £70.00')).toBeInTheDocument();
    expect(screen.getAllByText('Standard').length).toBeGreaterThan(0);
  });

  it('says why a venue cannot take the bookings yet', () => {
    show({
      hiddenReasons: [{ venue_id: 'member', venue_name: 'Zen Studio', reason: 'payments' }],
    });
    expect(screen.getByText(/Zen Studio cannot take card payments yet/)).toBeInTheDocument();
    // Twice on purpose: the warning line, and the sync pill's own screen-reader reason.
    expect(screen.getAllByText(/Setting up at Zen Studio/).length).toBeGreaterThan(0);
  });

  it('renders one venue when the grid asks for one cell', () => {
    show({ scope: 'member' });
    expect(screen.queryByText('Host Venue (you)')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Chair 2 at Zen Studio' })).toBeInTheDocument();
  });

  it('shows nothing for a service that is not on the page', () => {
    const { container } = render(
      <CollectiveCalendarsSection
        groups={groups()}
        itemId={null}
        collectiveName="Northside"
        value={EMPTY_CALENDARS_VALUE}
        onChange={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
