import type { ServiceCategoryRef } from '@/lib/booking/service-categories';
import type { ReactNode } from 'react';
import type { BookingPageConfig } from '@/lib/booking/booking-page-theme';
import type { VenuePublic } from '@/components/booking/types';

/** Save lifecycle status reported by the editor to whatever banner/host owns it. */
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

/**
 * The editor reports its save lifecycle here. The venue host forwards this to
 * `useSettingsSave().report`; the collective host drives the modal busy/error banner.
 * Signature matches the settings save context exactly so the venue path is unchanged.
 */
export interface SaveReporter {
  report: (next: { status?: SaveStatus; message?: string | null }) => void;
}

/** A bookable service/offering shown in the Services group + the preview. */
export interface EditorServiceItem {
  id: string;
  name: string;
  description?: string | null;
  price_pence?: number | null;
  duration_minutes?: number;
  /**
   * Existing photo for this service. Venue services carry their photo in
   * `config.service_photos` (so this is undefined and the editor seeds from config);
   * collective offerings carry it here (item image), so the editor seeds from this.
   */
  imageUrl?: string | null;
  /** Category heading on the booking page, so the preview groups as the live page does. */
  category?: ServiceCategoryRef | null;
  /** Venue drag order, so the preview keeps it inside each category. */
  sort_order?: number;
}

/** A bookable team member shown in the "Meet the team" group + the preview. */
export interface EditorTeamMember {
  id: string;
  name: string;
}

/** A member venue whose saved booking-page settings can prefill the collective page (import). */
export interface ImportSource {
  venueId: string;
  venueName: string;
  logoUrl: string | null;
  coverPhotoUrl: string | null;
  /** That member venue's saved booking_page_config (already sanitised on the server). */
  config: BookingPageConfig;
}

export interface BookingPageEditorCapabilities {
  /** Drives the Services/Team/About groups + the "Book now" tab wording. */
  isAppointmentVenue: boolean;
  /** False = read-only (e.g. non-admin venue staff). */
  canEdit: boolean;
  /**
   * True for venues (per-service photos live in `config.service_photos`); false for
   * collectives (offering photos live on the item, so the serialized config omits them).
   */
  servicePhotosInConfig: boolean;
  /**
   * Show the "use my brand colour in customer emails" switch. Only a venue sends customer
   * emails; a combined page books into its host venue, whose own setting applies.
   */
  emailBranding?: boolean;
}

/** One image slot (logo OR cover). Abstracts WHERE the url lives and HOW it persists. */
export interface ImageSlotAdapter {
  getUrl: () => string | null;
  /** Upload bytes; returns the public url (no persistence yet). */
  upload: (file: File) => Promise<string>;
  /** Persist the url (or null to clear). */
  saveUrl: (url: string | null) => Promise<void>;
}

/** Per-service photo persistence. Venue → config.service_photos[id]; collective → offering image. */
export interface ServicePhotoAdapter {
  upload: (serviceId: string, file: File) => Promise<string>;
  /** Persist immediately (not via the debounced config save). */
  save: (serviceId: string, url: string | null) => Promise<void>;
  /** Best-effort storage cleanup after a removal. */
  removeStored?: (url: string) => Promise<void>;
}

/**
 * Everything the shared <BookingPageEditor> needs that differs between a single venue
 * and a venue collective. The editor owns all branding state, the 850ms debounce, the
 * lastSaved dedupe, and the rendered DOM; the adapter performs the network writes and
 * supplies the data sources, the address control, and the preview venue.
 */
export interface BookingPageEditorAdapter {
  /** Display name (venue / collective name) — used in copy. */
  displayName: string;
  /** Absolute public url shown in the top "Public booking page" panel (or null to hide it). */
  publicUrl: string | null;
  /** Relative public path for in-app links / preview (or null). */
  publicPath: string | null;

  /** Stable key that changes when the underlying entity changes (reseed trigger). */
  seedKey: string;
  /** The current config to seed editor state from. Excludes logo/cover url (those are slots). */
  getConfig: () => BookingPageConfig;
  /**
   * Persist the serialized config. The editor owns the debounce + dedupe; the adapter does
   * the network write and returns the server's canonical saved config to reseed lastSaved.
   */
  savePatch: (config: BookingPageConfig) => Promise<BookingPageConfig>;

  /** Address control: the venue slug field, or the collective dedicated/adopt-member chooser. */
  addressSlot: ReactNode;

  logo: ImageSlotAdapter;
  cover: ImageSlotAdapter;
  gallery: { upload: (file: File) => Promise<string> };

  services: { list: EditorServiceItem[]; photo: ServicePhotoAdapter };
  team: { list: EditorTeamMember[]; uploadPhoto: (memberId: string, file: File) => Promise<string> };

  /** Build the synthetic public venue the inline preview renders. */
  buildPreviewVenue: (draft: BookingPageConfig) => VenuePublic;

  /** Wrap async file work to preserve scroll (venue: settings scroll; collective: identity). */
  preserveScroll: <T>(task: () => Promise<T>) => Promise<T>;

  capabilities: BookingPageEditorCapabilities;
  /** Member venues that can prefill this page (empty for a single venue → no import UI). */
  importSources: ImportSource[];
}
