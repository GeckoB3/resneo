/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SWRConfig } from 'swr';
import { ComplianceDashboardView } from './ComplianceDashboardView';
import type { ComplianceDashboardData, MissingBookingRow } from '@/lib/compliance/dashboard-service';

const TODAY = '2026-09-14';

function missing(over: Partial<MissingBookingRow>): MissingBookingRow {
  return {
    booking_id: 'colour',
    guest_id: 'g-jane',
    guest_name: 'Jane Doe',
    booking_date: TODAY,
    booking_time: '10:00:00',
    compliance_type_id: 'type-intake',
    compliance_type_name: 'New Patient Intake',
    enforcement: 'warn_staff',
    state: 'missing',
    ...over,
  };
}

const dashboard: ComplianceDashboardData = {
  today: TODAY,
  expiring_soon: [],
  missing_for_bookings: [
    // One visit: the colour at 10:00 needs the intake form, the cut at 11:00 photo consent.
    missing({}),
    missing({
      booking_id: 'cut',
      booking_time: '11:00:00',
      compliance_type_id: 'type-photo',
      compliance_type_name: 'Photo Consent',
      enforcement: 'warn_client',
    }),
    missing({
      booking_id: 'sam-next-week',
      guest_id: 'g-sam',
      guest_name: 'Sam Smith',
      booking_date: '2026-09-18',
      booking_time: '15:30:00',
    }),
  ],
  awaiting_submission: [],
};

const posts: Array<{ url: string; body: Record<string, unknown> }> = [];

function stubApi(dashboardResponse: () => Response) {
  posts.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push({ url, body: JSON.parse(String(init.body)) });
        return { ok: true, json: async () => ({ dispatched: true, sent_via: 'email' }) } as Response;
      }
      return dashboardResponse();
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

function renderView() {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, shouldRetryOnError: false }}>
      <ComplianceDashboardView />
    </SWRConfig>,
  );
}

describe('ComplianceDashboardView', () => {
  it('shows a client with forms outstanding today once, at their arrival time, with every form', async () => {
    stubApi(() => ({ ok: true, json: async () => dashboard }) as Response);
    renderView();

    const intake = await screen.findByText('New Patient Intake');
    const card = intake.closest('ul')!.closest('li')!;
    expect(within(card).getByText('Jane Doe')).toBeInTheDocument();
    expect(within(card).getByText('10:00')).toBeInTheDocument();
    expect(within(card).getByText('Photo Consent')).toBeInTheDocument();
    expect(screen.getAllByText('Jane Doe')).toHaveLength(1);

    expect(screen.getByText('Sam Smith · New Patient Intake')).toBeInTheDocument();
    expect(screen.queryByText(/You’re all caught up/)).not.toBeInTheDocument();
    const summary = screen.getByText('for today').closest('div')!;
    expect(summary).toHaveTextContent('1 for today');
    expect(summary).toHaveTextContent('1 upcoming');
  });

  it('files a link against the booking that needs the form', async () => {
    stubApi(() => ({ ok: true, json: async () => dashboard }) as Response);
    renderView();

    const photo = await screen.findByText('Photo Consent');
    fireEvent.click(within(photo.closest('li')!).getByRole('button', { name: 'Send link' }));

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]!.url).toBe('/api/venue/compliance/form-links');
    expect(posts[0]!.body).toMatchObject({ guest_id: 'g-jane', compliance_type_id: 'type-photo', booking_id: 'cut' });
    expect(await screen.findByText('Form link sent by email.')).toBeInTheDocument();
  });

  it('says the dashboard could not load rather than that everything is caught up', async () => {
    stubApi(() => ({ ok: false, json: async () => ({ error: 'Internal server error' }) }) as Response);
    renderView();

    expect(await screen.findByRole('alert')).toHaveTextContent('Couldn’t load the compliance dashboard');
    expect(screen.queryByText(/You’re all caught up/)).not.toBeInTheDocument();
  });
});
