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
    expect(screen.getByText(/own page is separate/)).toBeInTheDocument();
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

  it('says when the own page sends guests on, and where other booking types stay', () => {
    render(
      <CombinedPageScopeSwitch
        collective={{
          ...note,
          ownPage: { redirecting: true, reason: null, otherModels: 'classes', ownPath: '/book/plus-1' },
        }}
        scope="combined"
        onScopeChange={vi.fn()}
      />,
    );
    const status = screen.getByTestId('own-page-status');
    expect(status).toHaveTextContent('Guests who visit your own booking page are sent to the Plus 1 Staging page.');
    // On shared services the own page is not separate, so the header does not say it is.
    expect(screen.queryByText(/own page is separate/)).toBeNull();
    expect(status).toHaveTextContent(
      'Your own booking page now opens the Plus 1 Staging page. Your classes are still bookable at /book/plus-1.',
    );
  });

  it('says why the own page is showing', () => {
    render(
      <CombinedPageScopeSwitch
        collective={{
          ...note,
          isHost: false,
          ownPage: { redirecting: false, reason: 'settingUp', otherModels: null, ownPath: '/book/zen' },
        }}
        scope="combined"
        onScopeChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId('own-page-status')).toHaveTextContent(
      'Your own page is showing because your services from Plus 1 are still being set up.',
    );
  });

  it('shows no status line on the older model', () => {
    render(<CombinedPageScopeSwitch collective={note} scope="combined" onScopeChange={vi.fn()} />);
    expect(screen.queryByTestId('own-page-status')).toBeNull();
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
