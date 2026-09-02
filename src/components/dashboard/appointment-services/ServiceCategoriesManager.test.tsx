/**
 * @vitest-environment happy-dom
 * @vitest-environment-options { "settings": { "disableCSSFileLoading": true, "disableJavaScriptFileLoading": true, "disableIframePageLoading": true } }
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ServiceCategoriesManager, type ServiceCategoryApi } from './ServiceCategoriesManager';
import type { ServiceCategoryRef } from '@/lib/booking/service-categories';

/**
 * The manager is shared by the venue Services page and the combined page
 * manager, differing only in the `api` they hand it. Driving it through a fake
 * api therefore covers both surfaces: what it sends, what it shows, and that a
 * failed save rolls back rather than lying.
 */

const HAIR: ServiceCategoryRef = { id: 'c-hair', name: 'Hair', sort_order: 0 };
const NAILS: ServiceCategoryRef = { id: 'c-nails', name: 'Nails', sort_order: 1 };

function fakeApi(over: Partial<ServiceCategoryApi> = {}): ServiceCategoryApi & { [K in keyof ServiceCategoryApi]: ReturnType<typeof vi.fn> } {
  return {
    create: vi.fn(async (name: string) => ({ id: `c-${name.toLowerCase()}`, name, sort_order: 9 })),
    rename: vi.fn(async (id: string, name: string) => ({ id, name, sort_order: 0 })),
    remove: vi.fn(async () => {}),
    reorder: vi.fn(async () => {}),
    ...over,
  } as never;
}

function renderManager(api: ServiceCategoryApi, over: Partial<Parameters<typeof ServiceCategoriesManager>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <ServiceCategoriesManager
      categories={[HAIR, NAILS]}
      serviceCountByCategory={new Map([['c-hair', 3]])}
      uncategorisedCount={1}
      isAdmin
      api={api}
      onChange={onChange}
      {...over}
    />,
  );
  return { onChange };
}

const rowNames = () =>
  screen
    .getAllByRole('listitem')
    .map((li) => within(li).getAllByText(/.+/)[0]!.textContent);

afterEach(() => {
  cleanup();
});

describe('ServiceCategoriesManager', () => {
  it('lists categories with counts and the uncategorised hint', () => {
    renderManager(fakeApi());
    expect(rowNames()).toEqual(['Hair', 'Nails']);
    expect(screen.getByText('3 services')).toBeInTheDocument();
    expect(screen.getByText('0 services')).toBeInTheDocument();
    expect(screen.getByText(/1 service has no category/)).toBeInTheDocument();
  });

  it('adds a category through the api and appends it', async () => {
    const api = fakeApi();
    const { onChange } = renderManager(api);
    fireEvent.change(screen.getByLabelText(/new category name/i), { target: { value: '  Massage ' } });
    fireEvent.click(screen.getByRole('button', { name: /add category/i }));
    await waitFor(() => expect(api.create).toHaveBeenCalledWith('Massage'));
    await screen.findByText('Massage');
    expect(rowNames()).toEqual(['Hair', 'Nails', 'Massage']);
    expect(onChange).toHaveBeenCalledWith([HAIR, NAILS, { id: 'c-massage', name: 'Massage', sort_order: 9 }]);
    expect(screen.getByLabelText(/new category name/i)).toHaveValue('');
  });

  it('renames inline, and Escape cancels without saving', async () => {
    const api = fakeApi();
    renderManager(api);
    fireEvent.click(screen.getAllByRole('button', { name: /^rename$/i })[0]!);
    const input = screen.getByLabelText('Category name');
    fireEvent.change(input, { target: { value: 'Barbering' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(api.rename).toHaveBeenCalledWith('c-hair', 'Barbering'));
    await screen.findByText('Barbering');

    fireEvent.click(screen.getAllByRole('button', { name: /^rename$/i })[1]!);
    fireEvent.change(screen.getByLabelText('Category name'), { target: { value: 'Pedicures' } });
    fireEvent.keyDown(screen.getByLabelText('Category name'), { key: 'Escape' });
    expect(api.rename).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Nails')).toBeInTheDocument();
  });

  it('deletes after confirming, warning how many services move', async () => {
    const api = fakeApi();
    const { onChange } = renderManager(api);
    fireEvent.click(screen.getAllByRole('button', { name: /^delete$/i })[0]!);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/3 services will stay bookable/);
    fireEvent.click(within(dialog).getByRole('button', { name: /delete category/i }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith('c-hair'));
    await waitFor(() => expect(screen.queryByText('Hair')).toBeNull());
    expect(onChange).toHaveBeenCalledWith([NAILS]);
  });

  it('reorders with the arrow buttons and sends the full id order', async () => {
    const api = fakeApi();
    const { onChange } = renderManager(api);
    fireEvent.click(screen.getByRole('button', { name: /move nails up/i }));
    await waitFor(() => expect(api.reorder).toHaveBeenCalledWith(['c-nails', 'c-hair']));
    expect(rowNames()).toEqual(['Nails', 'Hair']);
    expect(onChange).toHaveBeenCalledWith([
      { ...NAILS, sort_order: 0 },
      { ...HAIR, sort_order: 1 },
    ]);
    // Boundaries: the top row cannot move up, the bottom row cannot move down.
    expect(screen.getByRole('button', { name: /move nails up/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /move hair down/i })).toBeDisabled();
  });

  it('rolls back and shows the server message when a reorder fails', async () => {
    const api = fakeApi({ reorder: vi.fn(async () => { throw new Error('Failed to save the new order'); }) });
    renderManager(api);
    fireEvent.click(screen.getByRole('button', { name: /move nails up/i }));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent('Failed to save the new order');
    expect(rowNames()).toEqual(['Hair', 'Nails']);
  });

  it('shows a duplicate-name error from the api and keeps the typed name', async () => {
    const api = fakeApi({ create: vi.fn(async () => { throw new Error('You already have a category called "Hair".'); }) });
    renderManager(api);
    fireEvent.change(screen.getByLabelText(/new category name/i), { target: { value: 'Hair' } });
    fireEvent.click(screen.getByRole('button', { name: /add category/i }));
    await screen.findByRole('alert');
    expect(screen.getByRole('alert')).toHaveTextContent(/already have a category called "Hair"/);
    expect(screen.getByLabelText(/new category name/i)).toHaveValue('Hair');
  });

  it('is read-only for non-admin staff', () => {
    renderManager(fakeApi(), { isAdmin: false });
    expect(screen.queryByLabelText(/new category name/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /^rename$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /move/i })).toBeNull();
    expect(rowNames()).toEqual(['Hair', 'Nails']);
  });
});
