/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CombinedPageScopeSwitch, type SettingsCollectiveNote } from './CombinedPageNotice';

const note: SettingsCollectiveNote = {
  id: 'col-1',
  name: 'Plus 1 Staging',
  isHost: true,
  hostVenueName: 'Plus 1',
  adoptedThisVenue: false,
};

afterEach(cleanup);

describe('CombinedPageScopeSwitch', () => {
  it('explains the shared page and marks the combined page as selected', () => {
    render(<CombinedPageScopeSwitch collective={note} scope="combined" onScopeChange={vi.fn()} />);
    expect(screen.getByText('This venue is part of Plus 1 Staging')).toBeInTheDocument();
    expect(screen.getByText(/shares one booking page with the other members/)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Combined page (Plus 1 Staging)' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'This venue’s own page' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.queryByText(/served at this venue’s own address/)).toBeNull();
  });

  it('names the host for a member and notes an adopted address', () => {
    render(
      <CombinedPageScopeSwitch
        collective={{ ...note, isHost: false, adoptedThisVenue: true }}
        scope="own"
        onScopeChange={vi.fn()}
      />,
    );
    expect(screen.getByText(/Plus 1 hosts it/)).toBeInTheDocument();
    expect(screen.getByText(/served at this venue’s own address/)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'This venue’s own page' })).toHaveAttribute('aria-selected', 'true');
  });

  it('switches by click and by arrow key', () => {
    const onScopeChange = vi.fn();
    render(<CombinedPageScopeSwitch collective={note} scope="combined" onScopeChange={onScopeChange} />);
    fireEvent.click(screen.getByTestId('booking-page-scope-own'));
    expect(onScopeChange).toHaveBeenLastCalledWith('own');
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
    expect(onScopeChange).toHaveBeenLastCalledWith('own');
    fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' });
    expect(onScopeChange).toHaveBeenLastCalledWith('own');
  });
});
