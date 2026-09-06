/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ServiceCategoryList } from './ServiceCategoryList';
import type { ServiceCategoryRef } from '@/lib/booking/service-categories';

/*
 * The category menu's scroll controls. happy-dom lays nothing out, so every box
 * metric is 0 and the row never overflows by itself; each test states the geometry
 * it wants through getter spies on the element prototypes.
 */

type Svc = { id: string; name: string; sort_order: number; category: ServiceCategoryRef | null };

const cat = (i: number): ServiceCategoryRef => ({ id: `c${i}`, name: `Category ${i}`, sort_order: i });
const MANY: Svc[] = Array.from({ length: 8 }, (_, i) => ({
  id: `s${i}`,
  name: `Service ${i}`,
  sort_order: 0,
  category: cat(i),
}));

function renderList(services: Svc[]) {
  return render(
    <ServiceCategoryList
      services={services}
      layout="sections"
      idPrefix="t"
      renderService={(s) => (
        <button key={s.id} type="button">
          {s.name}
        </button>
      )}
    />,
  );
}

/** The prototype that actually declares a box metric in this DOM implementation. */
function protoFor(prop: string): object {
  return Object.getOwnPropertyDescriptor(Element.prototype, prop) ? Element.prototype : HTMLElement.prototype;
}
type Metrics = { scrollWidth: number; clientWidth: number; scrollLeft: number; offsetLeft: number; offsetWidth: number };
function mockGeometry(m: { scrollWidth: number; clientWidth: number; scrollLeft: () => number; offsetLeft?: number; offsetWidth?: number }) {
  vi.spyOn(protoFor('scrollWidth') as Metrics, 'scrollWidth', 'get').mockReturnValue(m.scrollWidth);
  vi.spyOn(protoFor('clientWidth') as Metrics, 'clientWidth', 'get').mockReturnValue(m.clientWidth);
  vi.spyOn(protoFor('scrollLeft') as Metrics, 'scrollLeft', 'get').mockImplementation(m.scrollLeft);
  if (m.offsetLeft !== undefined) vi.spyOn(protoFor('offsetLeft') as Metrics, 'offsetLeft', 'get').mockReturnValue(m.offsetLeft);
  if (m.offsetWidth !== undefined) vi.spyOn(protoFor('offsetWidth') as Metrics, 'offsetWidth', 'get').mockReturnValue(m.offsetWidth);
}

const nav = () => screen.getByRole('navigation', { name: /service categories/i });
const arrow = (side: 'left' | 'right') =>
  within(nav()).queryByRole('button', { name: new RegExp(`scroll categories ${side}`, 'i') });
const scroller = () => nav().querySelector('.ap-cat-nav-inner') as HTMLElement;

let scrollTo: ReturnType<typeof vi.fn>;

describe('ServiceCategoryList category menu scroll controls', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    scrollTo = vi.fn();
    Element.prototype.scrollTo = scrollTo as unknown as Element['scrollTo'];
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows no arrows or fades while the chips fit in the row', () => {
    renderList(MANY);
    expect(arrow('left')).toBeNull();
    expect(arrow('right')).toBeNull();
    // The chips themselves are the only buttons in the menu.
    expect(within(nav()).getAllByRole('button')).toHaveLength(8);
  });

  it('shows the right arrow when chips overflow, and pages the row when clicked', () => {
    let left = 0;
    mockGeometry({ scrollWidth: 900, clientWidth: 400, scrollLeft: () => left });
    renderList(MANY);

    expect(arrow('right')).toBeInTheDocument();
    expect(arrow('left')).toBeNull();

    fireEvent.click(arrow('right')!);
    // 70% of the visible width, never less than a chip or two.
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 280, behavior: 'smooth' });

    // Scrolled to the far end: only the way back is offered.
    left = 500;
    fireEvent.scroll(scroller());
    expect(arrow('left')).toBeInTheDocument();
    expect(arrow('right')).toBeNull();

    fireEvent.click(arrow('left')!);
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 220, behavior: 'smooth' });

    // Somewhere in the middle: both ends have more.
    left = 250;
    fireEvent.scroll(scroller());
    expect(arrow('left')).toBeInTheDocument();
    expect(arrow('right')).toBeInTheDocument();
  });

  it('brings the chip a click makes current into view, clear of the fade', () => {
    // Every chip reports the same far-right position: the one that becomes current
    // sits past the visible edge, so the row must move to show it.
    mockGeometry({ scrollWidth: 900, clientWidth: 400, scrollLeft: () => 0, offsetLeft: 700, offsetWidth: 100 });
    renderList(MANY);
    scrollTo.mockClear();

    fireEvent.click(within(nav()).getByRole('button', { name: /^Category 3/ }));
    // chip right edge (800) plus the 56px edge margin, minus the 400px view, clamped to the 500px maximum.
    expect(scrollTo).toHaveBeenLastCalledWith({ left: 456, behavior: 'smooth' });
    // The section jump itself still happens.
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('leaves the row alone when the current chip is already in view', () => {
    mockGeometry({ scrollWidth: 900, clientWidth: 400, scrollLeft: () => 0, offsetLeft: 100, offsetWidth: 100 });
    renderList(MANY);
    scrollTo.mockClear();
    fireEvent.click(within(nav()).getByRole('button', { name: /^Category 2/ }));
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
