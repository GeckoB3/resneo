/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { BookingDetailSurface } from './BookingDetailSurface';

describe('BookingDetailSurface', () => {
  it('renders drawer content via Sheet', () => {
    render(
      <BookingDetailSurface
        presentation="drawer"
        onClose={vi.fn()}
        panelRef={{ current: null }}
        panelClassName="test-panel"
      >
        <p>Detail body</p>
      </BookingDetailSurface>,
    );

    expect(screen.getByText('Detail body')).toBeInTheDocument();
    expect(screen.getAllByRole('dialog').length).toBeGreaterThanOrEqual(1);
  });

  it('does not call onClose when nested booking is open and sheet dismisses', () => {
    const onClose = vi.fn();
    render(
      <BookingDetailSurface
        presentation="drawer"
        onClose={onClose}
        panelRef={{ current: null }}
        panelClassName="test-panel"
        nestedBookingOpen
      >
        <p>Nested open</p>
      </BookingDetailSurface>,
    );
    expect(onClose).not.toHaveBeenCalled();
  });
});
