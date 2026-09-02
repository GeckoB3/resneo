/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ServiceCategoryList } from './ServiceCategoryList';
import type { ServiceCategoryRef } from '@/lib/booking/service-categories';

const hair: ServiceCategoryRef = { id: 'c-hair', name: 'Hair', sort_order: 0 };
const nails: ServiceCategoryRef = { id: 'c-nails', name: 'Nails', sort_order: 1 };

type Svc = {
  id: string;
  name: string;
  description?: string | null;
  sort_order: number;
  category: ServiceCategoryRef | null;
};

const svc = (id: string, name: string, sort_order: number, category: ServiceCategoryRef | null, description: string | null = null): Svc => ({
  id,
  name,
  sort_order,
  category,
  description,
});

const CATEGORISED: Svc[] = [
  svc('cut', 'Cut', 0, hair, 'Wash, cut and finish'),
  svc('colour', 'Colour', 1, hair),
  svc('mani', 'Manicure', 0, nails),
  svc('gel', 'Gel polish', 1, nails, 'Long lasting colour'),
  svc('kit', 'Aftercare kit', 0, null),
];

const FLAT: Svc[] = [svc('a', 'Alpha', 0, null), svc('b', 'Beta', 1, null), svc('c', 'Gamma', 2, null)];

function renderList(props: Partial<React.ComponentProps<typeof ServiceCategoryList<Svc>>> & { services: Svc[] }) {
  return render(
    <ServiceCategoryList
      layout="sections"
      idPrefix="t"
      renderService={(s) => (
        <button key={s.id} type="button">
          {s.name}
        </button>
      )}
      {...props}
    />,
  );
}

describe('ServiceCategoryList', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a plain list with no headings, menu or search when nothing is categorised', () => {
    renderList({ services: FLAT });
    expect(screen.getAllByRole('button')).toHaveLength(3);
    expect(screen.queryByRole('navigation')).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('heading')).toBeNull();
  });

  it('shows the search box from six services, even without categories', () => {
    renderList({ services: [...FLAT, svc('d', 'Delta', 3, null), svc('e', 'Eps', 4, null), svc('f', 'Zeta', 5, null)] });
    expect(screen.getByRole('searchbox', { name: /search services/i })).toBeInTheDocument();
  });

  it('sections: headed sections in category order with a menu that jumps to them', () => {
    renderList({ services: CATEGORISED });
    const nav = screen.getByRole('navigation', { name: /service categories/i });
    const chips = within(nav).getAllByRole('button');
    expect(chips.map((c) => c.textContent)).toEqual(['Hair2', 'Nails2', 'Other services1']);
    expect(chips[0]).toHaveAttribute('aria-current', 'true');

    const headings = screen.getAllByRole('heading', { level: 3 });
    expect(headings.map((h) => h.textContent)).toEqual(['Hair2', 'Nails2', 'Other services1']);

    // Every service is on the page, in category order, with the venue order inside each.
    const cards = screen.getAllByRole('button').filter((b) => !nav.contains(b));
    expect(cards.map((c) => c.textContent)).toEqual(['Cut', 'Colour', 'Manicure', 'Gel polish', 'Aftercare kit']);

    fireEvent.click(chips[1]!);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
    expect(chips[1]).toHaveAttribute('aria-current', 'true');
    expect(chips[0]).not.toHaveAttribute('aria-current');
    expect(document.getElementById('t-cat-c-nails')).not.toBeNull();
  });

  it('accordion: first category open, the rest closed, toggled by their headers', () => {
    renderList({ services: CATEGORISED, layout: 'accordion' });
    expect(screen.queryByRole('navigation')).toBeNull();
    const hairButton = screen.getByRole('button', { name: /^Hair/ });
    const nailsButton = screen.getByRole('button', { name: /^Nails/ });
    expect(hairButton).toHaveAttribute('aria-expanded', 'true');
    expect(nailsButton).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('t-cat-c-nails')).toHaveAttribute('aria-hidden', 'true');

    fireEvent.click(nailsButton);
    expect(nailsButton).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('t-cat-c-nails')).toHaveAttribute('aria-hidden', 'false');
    // Opening one does not close another.
    expect(hairButton).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(hairButton);
    expect(hairButton).toHaveAttribute('aria-expanded', 'false');
  });

  it('accordion: opens the category holding the service to reveal', () => {
    renderList({ services: CATEGORISED, layout: 'accordion', revealServiceId: 'gel' });
    expect(screen.getByRole('button', { name: /^Nails/ })).toHaveAttribute('aria-expanded', 'true');
  });

  it('search filters across every category, shows a no-match state, and clears', () => {
    renderList({ services: CATEGORISED, layout: 'accordion', searchable: true });
    const box = screen.getByRole('searchbox');
    fireEvent.change(box, { target: { value: 'gel' } });
    // Matches show flat under their category label, regardless of which accordion was open.
    expect(screen.getByRole('button', { name: 'Gel polish' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cut' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Hair/ })).toBeNull();

    fireEvent.change(box, { target: { value: 'pedicure' } });
    expect(screen.getByText(/no services match/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /show all services/i }));
    expect(screen.getByRole('button', { name: /^Hair/ })).toBeInTheDocument();
  });

  it('search also matches the category name and the description', () => {
    renderList({ services: CATEGORISED, searchable: true });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'nails' } });
    expect(screen.getByRole('button', { name: 'Manicure' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Gel polish' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'finish' } });
    expect(screen.getByRole('button', { name: 'Cut' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Manicure' })).toBeNull();
  });
});
