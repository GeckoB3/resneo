/** @vitest-environment happy-dom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import BookingComplianceBlock, { type BookingComplianceState } from './BookingComplianceBlock';

const VENUE = '11111111-1111-4111-8111-111111111111';
const SERVICE = '22222222-2222-4222-8222-222222222222';
const TYPE = '33333333-3333-4333-8333-333333333333';
const VERSION = '44444444-4444-4444-8444-444444444444';

const SCHEMA = {
  schema_version: '1.0',
  title: 'New client intake',
  fields: [{ id: 'f_notes', type: 'text', label: 'Anything we should know', required: false, staff_only: false }],
};

/** The endpoint, as the block sees it: a known guest is satisfied, anyone else is missing. */
function requirementsFor(email: string | undefined, enforcement = 'block_online') {
  const known = email === 'known@example.com';
  return {
    identity_known: Boolean(email),
    requirements: [
      {
        compliance_type_id: TYPE,
        compliance_type_name: 'New client intake',
        enforcement,
        lock_period_hours: null,
        online_collection: 'inline',
        client_online: true,
        online_unmet_message: null,
        state: email ? (known ? 'SATISFIED' : 'MISSING') : null,
        form: email && !known ? { version_id: VERSION, form_schema: SCHEMA } : null,
      },
    ],
  };
}

function stubEndpoint(enforcement?: string) {
  const calls: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      calls.push(body);
      return new Response(JSON.stringify(requirementsFor(body.email as string | undefined, enforcement)), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  return calls;
}

describe('BookingComplianceBlock', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows no form before the email is known, only the placeholder', async () => {
    const calls = stubEndpoint();
    const onChange = vi.fn();
    render(
      <BookingComplianceBlock
        venueId={VENUE}
        serviceIds={[SERVICE]}
        bookingDate="2026-09-14"
        bookingTime="10:30"
        onChange={onChange}
      />,
    );
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]).toMatchObject({ venue_id: VENUE, service_ids: [SERVICE], booking_date: '2026-09-14' });
    expect(calls[0]!.email).toBeUndefined();
    await screen.findByTestId('compliance-awaiting-identity');
    expect(screen.queryByText('Save form')).not.toBeInTheDocument();
    // Nothing is outstanding yet, so the guest is not gated.
    const last = onChange.mock.calls.at(-1)?.[0] as BookingComplianceState;
    expect(last.mandatoryComplete).toBe(true);
  });

  it('renders the form once a new customer has typed their email, and gates Confirm on it', async () => {
    stubEndpoint();
    const onChange = vi.fn();
    render(<BookingComplianceBlock venueId={VENUE} serviceIds={[SERVICE]} email="new@example.com" onChange={onChange} />);
    await screen.findByText('New client intake', {}, { timeout: 3000 });
    expect(screen.getByText('Required')).toBeInTheDocument();
    expect(screen.getByText('Save form')).toBeInTheDocument();
    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0] as BookingComplianceState;
      expect(last.resolving).toBe(false);
      expect(last.mandatoryComplete).toBe(false);
      expect(last.inlineTypeIds).toEqual([TYPE]);
    });
  });

  it('renders nothing for a returning customer whose record is already on file', async () => {
    const calls = stubEndpoint();
    const onChange = vi.fn();
    render(<BookingComplianceBlock venueId={VENUE} serviceIds={[SERVICE]} email="known@example.com" onChange={onChange} />);
    await waitFor(() => expect(calls.length).toBe(1), { timeout: 3000 });
    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0] as BookingComplianceState;
      expect(last.resolving).toBe(false);
    });
    expect(screen.queryByText('Save form')).not.toBeInTheDocument();
    expect(screen.queryByText('Before you book')).not.toBeInTheDocument();
    const last = onChange.mock.calls.at(-1)?.[0] as BookingComplianceState;
    expect(last.mandatoryComplete).toBe(true);
    expect(last.submissions).toEqual([]);
  });

  it('does not gate Confirm on an optional (warn_client) form', async () => {
    stubEndpoint('warn_client');
    const onChange = vi.fn();
    render(<BookingComplianceBlock venueId={VENUE} serviceIds={[SERVICE]} email="new@example.com" onChange={onChange} />);
    await screen.findByText('Optional', {}, { timeout: 3000 });
    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0] as BookingComplianceState;
      expect(last.resolving).toBe(false);
      expect(last.mandatoryComplete).toBe(true);
    });
  });

  it('reports resolving while the email is being checked', async () => {
    stubEndpoint();
    const onChange = vi.fn();
    render(<BookingComplianceBlock venueId={VENUE} serviceIds={[SERVICE]} email="new@example.com" onChange={onChange} />);
    const first = onChange.mock.calls[0]?.[0] as BookingComplianceState;
    expect(first.resolving).toBe(true);
    await waitFor(() => {
      const last = onChange.mock.calls.at(-1)?.[0] as BookingComplianceState;
      expect(last.resolving).toBe(false);
    }, { timeout: 3000 });
  });
});
