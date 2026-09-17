/** @vitest-environment happy-dom */
/**
 * The services grid and its bulk lane (UX spec §2 item 15; plan contract 13).
 *
 * What the grid promises: a cell tells the truth about a venue at a glance, selections cross to
 * make a rectangle, changes stage rather than apply, a save goes out in chunks of 200, and what
 * fails stays staged so the next save re-sends only that.
 */
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CollectiveServicesGrid, cellState, type GridService } from './CollectiveServicesGrid';
import type { CollectiveCalendarGroup } from '@/lib/linked-accounts/replicas/host-calendars';
import type { CollectiveServiceBlock } from '@/lib/linked-accounts/replicas/service-blocks';
import type { BulkOp, BulkOpResult } from '@/lib/linked-accounts/replicas/bulk-ops';

const block = (overrides: Partial<CollectiveServiceBlock> = {}): CollectiveServiceBlock => ({
  role: 'master',
  collective_id: 'collective-1',
  collective_name: 'Northside',
  host_venue_name: 'Host Venue',
  item_id: 'item-1',
  locked_fields: [],
  delegated_fields: [],
  status: 'up_to_date',
  status_reason: null,
  last_applied_at: null,
  hidden_reasons: [],
  ...overrides,
});

const assignment = (itemId: string) => ({
  item_id: itemId,
  service_id: 'svc-x',
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
});

const groups = (): CollectiveCalendarGroup[] => [
  {
    venue_id: 'host',
    venue_name: 'Host Venue',
    is_host: true,
    sync: { venues: 1, applied: 1, pending: [], failed: [] },
    calendars: [
      { id: 'cal-h1', name: 'Room 1', is_active: true, assigned: [assignment('item-1')] },
      { id: 'cal-h2', name: 'Room 2', is_active: true, assigned: [] },
    ],
  },
  {
    venue_id: 'member',
    venue_name: 'Zen Studio',
    is_host: false,
    sync: { venues: 1, applied: 1, pending: [], failed: [] },
    calendars: [{ id: 'cal-m1', name: 'Chair 2', is_active: true, assigned: [assignment('item-1')] }],
  },
];

const services = (): GridService[] => [
  { id: 'svc-1', name: 'Facial', collective: block() },
  { id: 'svc-2', name: 'Massage', collective: block({ item_id: 'item-2' }) },
  { id: 'svc-3', name: 'Sauna', collective: block({ role: 'parked', item_id: null, status: 'hidden' }) },
];

function show(overrides: Partial<React.ComponentProps<typeof CollectiveServicesGrid>> = {}) {
  const onCommit = vi.fn(async (ops: BulkOp[]): Promise<BulkOpResult[]> =>
    ops.map((_op, index) => ({ index, ok: true })),
  );
  render(
    <CollectiveServicesGrid services={services()} groups={groups()} onCommit={onCommit} {...overrides} />,
  );
  return { onCommit };
}

describe('cellState', () => {
  it('says all, some or none, counting only active calendars', () => {
    const [host, member] = groups();
    expect(cellState(host!, 'item-1')).toBe('some');
    expect(cellState(member!, 'item-1')).toBe('all');
    expect(cellState(host!, 'item-2')).toBe('none');
    expect(cellState(host!, null)).toBe('none');
  });
});

describe('the grid', () => {
  it('puts services down and venues across', () => {
    show();
    expect(screen.getByRole('columnheader', { name: /Host Venue/ })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: /Zen Studio/ })).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: /Facial/ })).toBeInTheDocument();
  });

  it('says what each venue carries, cell by cell', () => {
    show();
    expect(screen.getByRole('button', { name: 'Facial at Host Venue: Some calendars' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Facial at Zen Studio: All calendars' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Massage at Host Venue: No calendars' })).toBeInTheDocument();
  });

  it('says where guests cannot book, and lists parked services last', () => {
    show({
      services: [
        { id: 'svc-3', name: 'Sauna', collective: block({ role: 'parked', item_id: null, status: 'hidden' }) },
        {
          id: 'svc-1',
          name: 'Facial',
          collective: block({
            status: 'hidden',
            hidden_reasons: [{ venue_id: 'member', venue_name: 'Zen Studio', reason: 'payments' }],
          }),
        },
      ],
    });
    expect(
      screen.getByRole('button', { name: 'Facial at Zen Studio: All calendars, hidden from guests' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Facial at Host Venue: Some calendars' })).toBeInTheDocument();
    const rows = screen.getAllByRole('rowheader').map((r) => r.textContent);
    expect(rows[0]).toContain('Facial');
    expect(rows[1]).toContain('Sauna');
  });

  it('shows the venue services that are not on the page under its own filter', async () => {
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Not on the page' }));
    expect(screen.getByRole('rowheader', { name: /Sauna/ })).toBeInTheDocument();
    expect(screen.queryByRole('rowheader', { name: /Facial/ })).not.toBeInTheDocument();
  });

  it('narrows to the rows that need attention', async () => {
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Needs attention' }));
    // Massage is on the page and nobody offers it; Facial is offered somewhere.
    expect(screen.getByRole('rowheader', { name: /Massage/ })).toBeInTheDocument();
    expect(screen.queryByRole('rowheader', { name: /Facial/ })).not.toBeInTheDocument();
  });

  it('searches by service name', async () => {
    show();
    await userEvent.type(screen.getByPlaceholderText('Search services'), 'mass');
    expect(screen.getByRole('rowheader', { name: /Massage/ })).toBeInTheDocument();
    expect(screen.queryByRole('rowheader', { name: /Facial/ })).not.toBeInTheDocument();
  });
});

describe('the bulk lane', () => {
  /** Save now asks first: "This changes N services at X and Y." */
  const saveAndConfirm = async (label: RegExp) => {
    await userEvent.click(screen.getByRole('button', { name: label }));
    await userEvent.click(await screen.findByRole('button', { name: 'Save changes' }));
  };

  const selectRowAndColumn = async () => {
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Massage' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Zen Studio' }));
  };

  it('stages the calendars where the selected rows and columns cross', async () => {
    const { onCommit } = show();
    await selectRowAndColumn();
    await userEvent.click(screen.getByRole('button', { name: 'Choose calendars' }));
    await saveAndConfirm(/Save 1 change/);

    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    expect(onCommit.mock.calls[0]![0]).toEqual([
      { op: 'assign', service_id: 'svc-2', venue_id: 'member', calendar_id: 'cal-m1' },
    ]);
  });

  it('nothing is sent until the host saves', async () => {
    const { onCommit } = show();
    await selectRowAndColumn();
    await userEvent.click(screen.getByRole('button', { name: 'Choose calendars' }));
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Massage at Zen Studio: No calendars' })).toHaveTextContent('1 staged');
  });

  it('cancels out a change the host stages and then undoes', async () => {
    const { onCommit } = show();
    await selectRowAndColumn();
    await userEvent.click(screen.getByRole('button', { name: 'Choose calendars' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove calendars' }));
    expect(screen.queryByRole('button', { name: /Save/ })).not.toBeInTheDocument();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('cancels out putting a service on the page and then taking it off', async () => {
    const { onCommit } = show();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Massage' }));
    await userEvent.click(screen.getByRole('button', { name: 'Put on the page' }));
    expect(screen.getByRole('button', { name: /Save 1 change/ })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Take off the page' }));
    expect(screen.queryByRole('button', { name: /Save/ })).not.toBeInTheDocument();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('sends 200 at a time', async () => {
    const many: GridService[] = Array.from({ length: 150 }, (_, i) => ({
      id: `svc-${i}`,
      name: `Service ${i}`,
      collective: block({ item_id: `item-${i}` }),
    }));
    const { onCommit } = show({ services: many });
    // Every row, every venue, every calendar: 150 services x 3 calendars = 450 operations.
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select every service shown' }));
    await userEvent.click(screen.getByRole('button', { name: 'Choose calendars' }));
    await saveAndConfirm(/Save 450 changes/);
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(3));
    expect(onCommit.mock.calls.map((call) => call[0].length)).toEqual([200, 200, 50]);
  });

  it('keeps what failed staged, and nothing else', async () => {
    const onCommit = vi.fn(async (ops: BulkOp[]): Promise<BulkOpResult[]> =>
      ops.map((_op, index) => (index === 0 ? { index, ok: false, message: 'Zen Studio said no.' } : { index, ok: true })),
    );
    show({ onCommit });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Massage' }));
    await userEvent.click(screen.getByRole('button', { name: 'Choose calendars' }));
    await saveAndConfirm(/Save 3 changes/);

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('1 change did not go through'),
    );
    expect(screen.getByRole('button', { name: /Save 1 change/ })).toBeInTheDocument();
  });

  it('opens one venue at a time to choose its calendars', async () => {
    show();
    await userEvent.click(screen.getByRole('button', { name: 'Facial at Zen Studio: All calendars' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('checkbox', { name: 'Chair 2 at Zen Studio' })).toBeChecked();
    // One venue, not every venue: the grid's cell is one venue's business.
    expect(within(dialog).queryByRole('checkbox', { name: 'Room 1 at Host Venue' })).not.toBeInTheDocument();
  });

  it('cannot change calendars for a service that is not on the page', () => {
    show();
    expect(screen.getByRole('button', { name: 'Sauna at Host Venue: Not on the page' })).toBeDisabled();
  });
});

describe('before the save goes', () => {
  it('asks first, saying how many services at which venues, and sends nothing on Go back', async () => {
    const { onCommit } = show();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Massage' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Zen Studio' }));
    await userEvent.click(screen.getByRole('button', { name: 'Choose calendars' }));
    await userEvent.click(screen.getByRole('button', { name: /Save 1 change/ }));

    const ask = await screen.findByRole('dialog');
    expect(within(ask).getByRole('heading', { name: 'Save these changes?' })).toBeInTheDocument();
    expect(within(ask).getAllByText('This changes 1 service at Zen Studio.').length).toBeGreaterThan(0);
    await userEvent.click(within(ask).getByRole('button', { name: 'Go back' }));
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('shows what each venue would offer, and why something would not be bookable', async () => {
    const onPreview = vi.fn(async () => [
      {
        venue_id: 'host',
        venue_name: 'Host Venue',
        is_host: true,
        shows: [{ service_id: 'svc-1', name: 'Facial' }],
        hides: [],
      },
      {
        venue_id: 'member',
        venue_name: 'Zen Studio',
        is_host: false,
        shows: [],
        hides: [{ service_id: 'svc-2', name: 'Massage', reason: 'payments' as const }],
      },
    ]);
    const { onCommit } = show({ onPreview });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Massage' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Zen Studio' }));
    await userEvent.click(screen.getByRole('button', { name: 'Choose calendars' }));
    await userEvent.click(screen.getByRole('button', { name: 'See what each venue will show' }));

    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Guests can book: Facial.');
    expect(
      within(dialog).getByText(
        'This will not be bookable at Zen Studio, because card payments are not set up there.',
      ),
    ).toBeInTheDocument();
    // A preview is a preview: it sends the staged set and saves nothing.
    expect(onPreview).toHaveBeenCalledWith([
      { op: 'assign', service_id: 'svc-2', venue_id: 'member', calendar_id: 'cal-m1' },
    ]);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('says so when the preview could not be worked out, and keeps the changes', async () => {
    const onPreview = vi.fn(async () => {
      throw new Error('down');
    });
    show({ onPreview });
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Massage' }));
    await userEvent.click(screen.getByRole('button', { name: 'Choose calendars' }));
    await userEvent.click(screen.getByRole('button', { name: 'See what each venue will show' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Your changes are still here');
  });
});
