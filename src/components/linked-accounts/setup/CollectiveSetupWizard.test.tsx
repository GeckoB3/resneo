/** @vitest-environment happy-dom */
/**
 * Finish setting up a collective (Docs/link-and-collective-setup-wizard-plan.md §3.3): services first,
 * in one save; then calendars at every venue, in a second save; then the address and whether it is live.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CollectiveSetupWizard } from './CollectiveSetupWizard';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const addToast = vi.fn();
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ addToast }) }));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const sync = { venues: 1, applied: 1, pending: [], failed: [] };
const block = (role: 'master' | 'parked', itemId: string | null) => ({
  role,
  venue_role: 'host',
  collective_id: 'c-1',
  collective_name: 'Northside',
  host_venue_name: 'Zen Studio',
  item_id: itemId,
  locked_fields: [],
  delegated_fields: [],
  status: 'up_to_date',
  status_reason: null,
  last_applied_at: null,
  hidden_reasons: [],
});

/** Before the first save: two host services, nothing on the page. After it: both offered. */
function stub() {
  let offered = false;
  const bulk: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === '/api/venue/appointment-services') {
        return json({
          services: [
            { id: 's-1', name: 'Cut', is_active: true, is_bookable_online: true, duration_minutes: 45, price_pence: 3500, collective: offered ? block('master', 'i-1') : null },
            { id: 's-2', name: 'Colour', is_active: true, is_bookable_online: false, duration_minutes: 90, price_pence: 8000, collective: offered ? block('master', 'i-2') : null },
          ],
          practitioner_services: [{ practitioner_id: 'cal-zen', service_id: 's-1' }],
          collective_calendars: [
            { venue_id: 'zen', venue_name: 'Zen Studio', is_host: true, sync, calendars: [{ id: 'cal-zen', name: 'Alex', is_active: true, assigned: [] }] },
            { venue_id: 'bloom', venue_name: 'Bloom', is_host: false, sync, calendars: [{ id: 'cal-bloom', name: 'Sam', is_active: true, assigned: [] }] },
          ],
        });
      }
      if (url === '/api/venue/collectives') {
        return json({
          collectives: [
            {
              id: 'c-1',
              name: 'Northside',
              slug: 'northside',
              hostVenueId: 'zen',
              members: [
                { venueId: 'zen', venueName: 'Zen Studio', status: 'active' },
                { venueId: 'bloom', venueName: 'Bloom', status: 'active' },
              ],
            },
          ],
        });
      }
      if (url === '/api/venue/collectives/c-1/bulk' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body)) as { ops: { op: string }[] };
        bulk.push(body.ops);
        if (body.ops.some((o) => o.op === 'offer')) offered = true;
        return json({ results: body.ops.map((_, index) => ({ index, ok: true })) });
      }
      return json({});
    }),
  );
  return bulk;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('CollectiveSetupWizard', () => {
  it('offers the ticked services, then assigns the ticked calendars, then shows the address', async () => {
    const user = userEvent.setup();
    const bulk = stub();
    render(<CollectiveSetupWizard collectiveId="c-1" venueName="Zen Studio" onClose={vi.fn()} />);

    expect(await screen.findByText('Bloom is in')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // Bookable-online services are ticked by default; staff-only ones are not.
    expect(screen.getByRole('checkbox', { name: /Cut/ })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Colour/ })).not.toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: /Colour/ }));
    expect(screen.getByText('2 services selected')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));

    expect(await screen.findByText('Who does what?')).toBeInTheDocument();
    expect(bulk[0]).toEqual([
      { op: 'offer', service_id: 's-1' },
      { op: 'offer', service_id: 's-2' },
    ]);

    // The host calendar that already offered Cut on the venue's own page is pre-ticked.
    const zen = screen.getByText('Zen Studio').closest('section')!;
    const cutAtZen = within(zen).getAllByRole('checkbox', { name: 'Alex' })[0]!;
    expect(cutAtZen).toBeChecked();
    const bloom = screen.getByText('Bloom').closest('section')!;
    const samBoxes = within(bloom).getAllByRole('checkbox', { name: 'Sam' });
    await user.click(samBoxes[0]!);
    await user.click(screen.getByRole('button', { name: 'Save and continue' }));

    expect(await screen.findByRole('heading', { name: /Northside is/ })).toBeInTheDocument();
    expect(bulk[1]).toEqual([
      { op: 'assign', service_id: 's-1', venue_id: 'zen', calendar_id: 'cal-zen' },
      { op: 'assign', service_id: 's-1', venue_id: 'bloom', calendar_id: 'cal-bloom' },
    ]);
    expect(screen.getByText(/\/book\/c\/northside/)).toBeInTheDocument();
  });
});
