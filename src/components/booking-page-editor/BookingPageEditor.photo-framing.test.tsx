/**
 * @vitest-environment happy-dom
 * @vitest-environment-options { "settings": { "disableCSSFileLoading": true, "disableJavaScriptFileLoading": true, "disableIframePageLoading": true } }
 */
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { BookingPageEditor } from './BookingPageEditor';
import type { BookingPageEditorAdapter } from './types';
import type { BookingPageConfig } from '@/lib/booking/booking-page-theme';
import type { VenuePublic } from '@/components/booking/types';

/**
 * Framing a team or service photo has to survive the trip to the server: the editor rebuilds the
 * whole config on every save, so a field it forgets to serialize is silently dropped even though
 * the UI looks right. These tests assert on the payload `savePatch` actually receives.
 */

const SERVICE_ID = 'a1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d';
const MEMBER_ID = 'b1b2c3d4-e5f6-4a5b-8c9d-0e1f2a3b4c5d';
const PHOTO = 'https://cdn.example/photo.jpg';

function buildAdapter(
  config: BookingPageConfig,
  over: Partial<BookingPageEditorAdapter> = {},
): { adapter: BookingPageEditorAdapter; savePatch: ReturnType<typeof vi.fn> } {
  const savePatch = vi.fn(async (c: BookingPageConfig) => c);
  const adapter: BookingPageEditorAdapter = {
    displayName: 'Test Venue',
    publicUrl: null,
    publicPath: null,
    seedKey: 'venue-1',
    getConfig: () => config,
    savePatch,
    addressSlot: null,
    logo: { getUrl: () => null, upload: async () => '', saveUrl: async () => {} },
    cover: { getUrl: () => null, upload: async () => '', saveUrl: async () => {} },
    gallery: { upload: async () => '' },
    services: {
      list: [{ id: SERVICE_ID, name: 'Haircut' }],
      photo: { upload: async () => '', save: async () => {} },
    },
    team: { list: [{ id: MEMBER_ID, name: 'Alex' }], uploadPhoto: async () => '' },
    buildPreviewVenue: () => ({ id: 'v1', name: 'Test Venue' }) as unknown as VenuePublic,
    preserveScroll: async (task) => task(),
    capabilities: { isAppointmentVenue: true, canEdit: true, servicePhotosInConfig: true },
    importSources: [],
    ...over,
  };
  return { adapter, savePatch };
}

/** The editor auto-saves on an 850ms debounce; run it out and settle the promise. */
async function flushAutoSave() {
  await act(async () => {
    vi.advanceTimersByTime(900);
    await Promise.resolve();
  });
}

function renderEditor(config: BookingPageConfig, over?: Partial<BookingPageEditorAdapter>) {
  const { adapter, savePatch } = buildAdapter(config, over);
  render(<BookingPageEditor adapter={adapter} reporter={{ report: vi.fn() }} />);
  return { savePatch };
}

function handleFor(label: string): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(label, 'i') });
}

describe('BookingPageEditor photo framing', () => {
  it('sends team photo framing in the saved config', async () => {
    vi.useFakeTimers();
    try {
      const { savePatch } = renderEditor({
        show_team_tab: true,
        team_profiles: { [MEMBER_ID]: { photo: PHOTO } },
      });
      // First settled build only captures the dirty-check baseline.
      await flushAutoSave();
      savePatch.mockClear();

      fireEvent.keyDown(handleFor('Reposition the photo for Alex'), { key: 'ArrowRight' });
      await flushAutoSave();

      expect(savePatch).toHaveBeenCalled();
      const sent = savePatch.mock.calls.at(-1)![0] as BookingPageConfig;
      expect(sent.team_profiles?.[MEMBER_ID]).toMatchObject({
        photo: PHOTO,
        photo_crop: { x: 52, y: 50, zoom: 1 },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends service photo framing in the saved config', async () => {
    vi.useFakeTimers();
    try {
      const { savePatch } = renderEditor({
        show_services_tab: true,
        service_photos: { [SERVICE_ID]: PHOTO },
      });
      await flushAutoSave();
      savePatch.mockClear();

      fireEvent.keyDown(handleFor('Reposition the photo for Haircut'), { key: 'ArrowDown' });
      await flushAutoSave();

      const sent = savePatch.mock.calls.at(-1)![0] as BookingPageConfig;
      expect(sent.service_photo_crops).toEqual({ [SERVICE_ID]: { x: 50, y: 52, zoom: 1 } });
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a collective offering photo that lives on the item, and frames it', async () => {
    vi.useFakeTimers();
    try {
      const { savePatch } = renderEditor(
        { show_services_tab: true },
        {
          // Collective: the photo arrives on the list, not in the config.
          services: {
            list: [{ id: SERVICE_ID, name: 'Haircut', imageUrl: PHOTO }],
            photo: { upload: async () => '', save: async () => {} },
          },
          capabilities: { isAppointmentVenue: true, canEdit: true, servicePhotosInConfig: false },
        },
      );
      await flushAutoSave();
      savePatch.mockClear();

      fireEvent.keyDown(handleFor('Reposition the photo for Haircut'), { key: 'ArrowLeft' });
      await flushAutoSave();

      const sent = savePatch.mock.calls.at(-1)![0] as BookingPageConfig;
      // Framing is stored, but the photo itself stays on the item.
      expect(sent.service_photo_crops).toEqual({ [SERVICE_ID]: { x: 48, y: 50, zoom: 1 } });
      expect(sent.service_photos).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('offers no framing control for a service or member without a photo', () => {
    renderEditor({ show_services_tab: true, show_team_tab: true });
    expect(screen.queryByRole('button', { name: /Reposition the photo/i })).toBeNull();
  });

  it('drops framing for a service whose photo has gone', async () => {
    vi.useFakeTimers();
    try {
      const { savePatch } = renderEditor({
        show_services_tab: true,
        // Stale crop for a service with no photo (e.g. the photo was removed elsewhere).
        service_photo_crops: { [SERVICE_ID]: { x: 20, y: 20, zoom: 2 } },
        team_profiles: { [MEMBER_ID]: { bio: 'Hello' } },
      });
      await flushAutoSave();
      savePatch.mockClear();

      // Any edit triggers a rebuild of the whole config.
      fireEvent.change(screen.getByPlaceholderText(/Specialties/i), {
        target: { value: 'Colour' },
      });
      await flushAutoSave();

      const sent = savePatch.mock.calls.at(-1)![0] as BookingPageConfig;
      expect(sent.service_photo_crops).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
