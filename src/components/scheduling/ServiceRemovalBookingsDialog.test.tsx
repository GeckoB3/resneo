/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ServiceRemovalBookingsDialog } from './ServiceRemovalBookingsDialog';
import type { ServiceRemovalAffectedBooking } from '@/lib/venue/service-removal-bookings';

afterEach(cleanup);

function booking(overrides: Partial<ServiceRemovalAffectedBooking> = {}): ServiceRemovalAffectedBooking {
  return {
    id: 'b1',
    service_id: 'svc-1',
    service_name: 'Gents Cut',
    calendar_id: 'cal-1',
    calendar_name: 'Andrew',
    booking_date: '2026-10-14',
    booking_time: '10:00',
    end_time: '10:45',
    guest_name: 'Alex Smith',
    party_size: 1,
    status: 'Confirmed',
    ...overrides,
  };
}

const CALENDARS = [
  { id: 'cal-1', name: 'Andrew' },
  { id: 'cal-2', name: 'Sam' },
  { id: 'cal-3', name: 'Room 2' },
];

/** Only Sam offers Gents Cut, so Room 2 is not a destination the booking route would accept. */
const offers = (calendarId: string, serviceId: string) => calendarId === 'cal-2' && serviceId === 'svc-1';

function renderDialog(props: Partial<Parameters<typeof ServiceRemovalBookingsDialog>[0]> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(
    <ServiceRemovalBookingsDialog
      open
      confirmation={{
        message: '2 upcoming bookings are already booked for Gents Cut on Andrew.',
        bookings: [booking(), booking({ id: 'b2', booking_time: '14:30', guest_name: 'Jo Blue' })],
        total: 2,
        truncated: false,
      }}
      calendars={CALENDARS}
      calendarOffersService={offers}
      saving={false}
      failures={[]}
      error={null}
      onCancel={onCancel}
      onConfirm={onConfirm}
      {...props}
    />,
  );
  return { onConfirm, onCancel };
}

describe('ServiceRemovalBookingsDialog', () => {
  it('lists every affected booking with when it is and who it is for', () => {
    renderDialog();
    expect(screen.getByText('2 upcoming bookings are already booked for Gents Cut on Andrew.')).toBeInTheDocument();
    expect(screen.getByText('Gents Cut on Andrew')).toBeInTheDocument();
    expect(screen.getByText('2 upcoming bookings')).toBeInTheDocument();
    expect(screen.getByText('Wed 14 Oct, 10:00 to 10:45')).toBeInTheDocument();
    expect(screen.getByText(/Alex Smith/)).toBeInTheDocument();
    expect(screen.getByText(/Jo Blue/)).toBeInTheDocument();
  });

  it('leaves the bookings alone by default, which is what saving confirms', () => {
    const { onConfirm } = renderDialog();
    const save = screen.getByRole('button', { name: 'Save and leave these bookings here' });
    fireEvent.click(save);
    expect(onConfirm).toHaveBeenCalledWith([]);
  });

  it('only offers calendars that already offer the service', () => {
    renderDialog();
    const select = screen.getByLabelText('What should happen to these bookings?');
    expect(within(select).getByRole('option', { name: 'Leave them on Andrew' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'Move to Sam' })).toBeInTheDocument();
    // The booking route refuses a move onto a calendar that does not offer the service,
    // so Room 2 must not be offered at all.
    expect(within(select).queryByRole('option', { name: 'Move to Room 2' })).toBeNull();
    // Nor is the calendar they already sit on.
    expect(within(select).queryByRole('option', { name: 'Move to Andrew' })).toBeNull();
  });

  it('moves every booking in the group once a destination is chosen', () => {
    const { onConfirm } = renderDialog();
    fireEvent.change(screen.getByLabelText('What should happen to these bookings?'), {
      target: { value: 'cal-2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Move 2 bookings and save' }));
    expect(onConfirm).toHaveBeenCalledWith([
      { bookingId: 'b1', targetCalendarId: 'cal-2' },
      { bookingId: 'b2', targetCalendarId: 'cal-2' },
    ]);
  });

  it('splits bookings into one group per service and calendar', () => {
    renderDialog({
      confirmation: {
        message: 'x',
        bookings: [
          booking(),
          booking({ id: 'b2', service_id: 'svc-2', service_name: 'Beard Trim' }),
        ],
        total: 2,
        truncated: false,
      },
    });
    expect(screen.getByText('Gents Cut on Andrew')).toBeInTheDocument();
    expect(screen.getByText('Beard Trim on Andrew')).toBeInTheDocument();
    expect(screen.getAllByLabelText('What should happen to these bookings?')).toHaveLength(2);
  });

  it('names the bookings that could not be moved and still lets the save go through', () => {
    const { onConfirm } = renderDialog({
      failures: [{ bookingId: 'b2', label: 'Jo Blue, Wed 14 Oct, 14:30', reason: 'That time is already booked on Sam.' }],
    });
    expect(screen.getByText('One booking could not be moved')).toBeInTheDocument();
    expect(screen.getByText('Jo Blue, Wed 14 Oct, 14:30: That time is already booked on Sam.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save and leave these bookings here' }));
    expect(onConfirm).toHaveBeenCalledWith([]);
  });

  it('says what to do when no other calendar offers the service', () => {
    renderDialog({ calendars: [{ id: 'cal-1', name: 'Andrew' }, { id: 'cal-3', name: 'Room 2' }] });
    expect(
      screen.getByText(
        'No other calendar offers Gents Cut, so there is nowhere to move these bookings to. Add the service to another calendar first if you want to move them.',
      ),
    ).toBeInTheDocument();
  });
});
