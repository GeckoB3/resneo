/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HelpSearch } from './HelpSearch';
import type { HelpSearchDoc } from '@/lib/help/types';

/**
 * The combobox points at its results list by id. Those ids used to come from
 * `useId`, which the help layout renders at a tree position the server and the
 * client disagree about in development: the input kept the server's id, the
 * results list rendered with the client's, and `aria-controls` referred to an
 * element that was not on the page. A caller-owned id cannot drift, and these
 * tests fail if anyone reaches for a generated one again.
 */

const DOCS: HelpSearchDoc[] = [
  {
    id: 'gs-deposits',
    href: '/help/getting-started/deposits',
    categorySlug: 'getting-started',
    categoryTitle: 'Getting started',
    articleSlug: 'deposits',
    title: 'Take deposits',
    description: 'Ask for a deposit when a client books.',
    tagsText: 'deposits payments stripe',
    content: 'Deposits reduce no-shows.',
  },
];

function searchFor(term: string) {
  const input = screen.getByRole('combobox');
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: term } });
  return input;
}

afterEach(cleanup);

describe('HelpSearch', () => {
  it('uses the id it was given, so both renders agree', () => {
    render(<HelpSearch id="help-search-desktop" searchDocs={DOCS} />);

    expect(screen.getByRole('combobox')).toHaveAttribute('id', 'help-search-desktop');
  });

  it('labels the input, whatever the id', () => {
    render(<HelpSearch id="help-search-desktop" searchDocs={DOCS} />);

    expect(screen.getByLabelText('Search help articles')).toBe(screen.getByRole('combobox'));
  });

  it('points aria-controls at a list that is actually on the page', () => {
    render(<HelpSearch id="help-search-desktop" searchDocs={DOCS} />);
    const input = searchFor('deposit');

    const target = input.getAttribute('aria-controls');
    expect(target).toBe('help-search-desktop-results');
    // The assertion that would have caught the original bug: the id has to
    // resolve, not merely look plausible.
    expect(document.getElementById(target!)).toBe(screen.getByRole('listbox'));
  });

  it('keeps two instances on one page apart', () => {
    // The layout renders a desktop and a mobile search side by side, so their
    // ids must not collide the way a shared literal would.
    render(
      <>
        <HelpSearch id="help-search-desktop" searchDocs={DOCS} />
        <HelpSearch id="help-search-mobile" searchDocs={DOCS} />
      </>,
    );

    const ids = screen.getAllByRole('combobox').map((el) => el.id);
    expect(ids).toEqual(['help-search-desktop', 'help-search-mobile']);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
