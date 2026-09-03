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

const LABEL = /use my brand colour in customer emails/i;

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
    services: { list: [], photo: { upload: async () => '', save: async () => {} } },
    team: { list: [], uploadPhoto: async () => '' },
    buildPreviewVenue: () => ({ id: 'v1', name: 'Test Venue' }) as unknown as VenuePublic,
    preserveScroll: async (task) => task(),
    capabilities: {
      isAppointmentVenue: true,
      canEdit: true,
      servicePhotosInConfig: true,
      emailBranding: true,
    },
    importSources: [],
    ...over,
  };
  return { adapter, savePatch };
}

async function flushAutoSave() {
  await act(async () => {
    vi.advanceTimersByTime(900);
    await Promise.resolve();
  });
}

function lastSavedConfig(savePatch: ReturnType<typeof vi.fn>): BookingPageConfig {
  const calls = savePatch.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![0] as BookingPageConfig;
}

describe('BookingPageEditor brand colour in emails', () => {
  it('saves brand_emails when the switch is ticked and clears it when unticked', async () => {
    vi.useFakeTimers();
    try {
      const { adapter, savePatch } = buildAdapter({ brand_primary: '#7c3aed' });
      render(<BookingPageEditor adapter={adapter} reporter={{ report: vi.fn() }} />);
      await flushAutoSave();

      const box = screen.getByLabelText(LABEL) as HTMLInputElement;
      expect(box).toBeEnabled();
      expect(box.checked).toBe(false);

      fireEvent.click(box);
      await flushAutoSave();
      expect(lastSavedConfig(savePatch).brand_emails).toBe(true);

      fireEvent.click(box);
      await flushAutoSave();
      expect(lastSavedConfig(savePatch).brand_emails).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('is disabled until a brand colour is chosen', () => {
    const { adapter } = buildAdapter({});
    render(<BookingPageEditor adapter={adapter} reporter={{ report: vi.fn() }} />);
    expect(screen.getByLabelText(LABEL)).toBeDisabled();
    expect(screen.getByText(/choose a brand colour first/i)).toBeInTheDocument();
  });

  it('is not offered where the adapter does not brand emails (combined pages)', () => {
    const { adapter } = buildAdapter(
      { brand_primary: '#7c3aed' },
      {
        capabilities: {
          isAppointmentVenue: true,
          canEdit: true,
          servicePhotosInConfig: false,
          emailBranding: false,
        },
      },
    );
    render(<BookingPageEditor adapter={adapter} reporter={{ report: vi.fn() }} />);
    expect(screen.queryByLabelText(LABEL)).toBeNull();
  });
});
