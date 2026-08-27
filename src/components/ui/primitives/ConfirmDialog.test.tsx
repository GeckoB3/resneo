/** @vitest-environment happy-dom */
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmDialog } from './ConfirmDialog';

/**
 * P0-16: the optional `body` slot, and the guarantee that adding it changed
 * nothing for the ~10 existing callers, none of which pass one.
 */
function setup(props: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <ConfirmDialog
      open
      onOpenChange={onOpenChange}
      title="Cancel this booking?"
      message="This cannot be undone."
      confirmLabel="Cancel booking"
      onConfirm={onConfirm}
      {...props}
    />,
  );
  return { onConfirm, onOpenChange };
}

describe('ConfirmDialog', () => {
  it('renders title, message and actions with no body, exactly as before', async () => {
    const user = userEvent.setup();
    const { onConfirm, onOpenChange } = setup();

    expect(screen.getByText('Cancel this booking?')).toBeInTheDocument();
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel booking' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('renders structured body content beneath the message', () => {
    setup({
      body: (
        <ul>
          <li>Free until Mon 1 Sep, 14:00</li>
          <li>Deposit of £10.00 is refundable</li>
        </ul>
      ),
    });

    // Both survive: the string stays the accessible description, the nodes
    // carry what a sentence cannot (P2-2's deadline, refundability, fees).
    expect(screen.getByText('This cannot be undone.')).toBeInTheDocument();
    expect(screen.getByText('Free until Mon 1 Sep, 14:00')).toBeInTheDocument();
    expect(screen.getByText('Deposit of £10.00 is refundable')).toBeInTheDocument();
  });

  it('keeps message as the accessible description when a body is present', () => {
    setup({ body: <p>Extra detail</p> });
    // The dialog is still described by the string, not by the body nodes, so a
    // screen reader announces the consequence rather than a bare list.
    expect(screen.getByRole('dialog')).toHaveAccessibleDescription('This cannot be undone.');
  });

  it('honours the cancel action without confirming', async () => {
    const user = userEvent.setup();
    const { onConfirm, onOpenChange } = setup({ cancelLabel: 'Keep it', body: <p>Detail</p> });

    await user.click(screen.getByRole('button', { name: 'Keep it' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
