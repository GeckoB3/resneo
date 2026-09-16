/** @vitest-environment happy-dom */
/**
 * DIARY-03 (D46 revised 2026-09-16): dropping a booking on another venue's calendar in the
 * collective asks once, moves it, and shows the reason when it cannot move.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CollectiveVenueMoveDialog, type CrossVenueMoveDialog } from './PractitionerCalendarView';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const move = {
  booking: { id: 'b-1', guest_name: 'Sam Guest' },
  sourceCalendarName: 'Bo',
  sourceVenueName: null,
  targetColumnKey: 'linked:member:cal-zen',
  targetCalendarName: 'Ada',
  targetVenueName: 'Zen Studio',
  targetLinkedColumn: { practitionerId: 'cal-zen' },
  dateStr: '2031-03-04',
  time: '14:00',
  sourceVenueId: 'host',
  targetVenueId: 'member',
} as unknown as CrossVenueMoveDialog;

describe('CollectiveVenueMoveDialog', () => {
  it('asks, then moves the booking to that calendar and says so', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, guest_notified: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const onMoved = vi.fn();
    render(<CollectiveVenueMoveDialog move={move} onClose={vi.fn()} onMoved={onMoved} />);
    expect(screen.getAllByText('Move this booking to Zen Studio?').length).toBeGreaterThan(0);
    expect(screen.getByText(/Ada at Zen Studio will have this booking at 14:00 on .*, at the same price/)).toBeInTheDocument();
    expect(document.body.textContent ?? '').not.toMatch(/rebook|cancel this one/i);

    fireEvent.click(screen.getByRole('button', { name: 'Move to Zen Studio' }));
    await waitFor(() => expect(onMoved).toHaveBeenCalledWith('Moved to Ada at Zen Studio.'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/venue/bookings/b-1/move-venue',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ calendar_id: 'cal-zen', booking_date: '2031-03-04', booking_time: '14:00' }),
      }),
    );
  });

  it('shows why a booking cannot move, and stays open', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ error: 'This booking has a deposit.' }), { status: 409 })),
    );
    const onMoved = vi.fn();
    render(<CollectiveVenueMoveDialog move={move} onClose={vi.fn()} onMoved={onMoved} />);
    fireEvent.click(screen.getByRole('button', { name: 'Move to Zen Studio' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This booking has a deposit.');
    expect(onMoved).not.toHaveBeenCalled();
  });
});
