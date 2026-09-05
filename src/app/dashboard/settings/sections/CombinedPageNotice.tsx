'use client';

import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { Button } from '@/components/ui/primitives/Button';

/** The live venue collective a venue belongs to, as the Booking page tab needs it. */
export interface SettingsCollectiveNote {
  id: string;
  name: string;
  /** This venue hosts the collective, so it can open Manage combined page. */
  isHost: boolean;
  hostVenueName: string;
  /** The combined page is served at this venue's own booking address. */
  adoptedThisVenue: boolean;
}

/**
 * Top of the Booking page tab for a venue in a live collective: says the venue
 * uses a combined page, where it is managed, and points there. Hosts get a
 * button that opens Manage combined page; members get the Linked accounts tab,
 * where they can view the combined page and their part in it.
 */
export function CombinedPageNotice({
  collective,
  onManage,
  onOpenLinkedAccounts,
}: {
  collective: SettingsCollectiveNote;
  onManage: () => void;
  onOpenLinkedAccounts: () => void;
}) {
  return (
    <SectionCard elevated className="border-brand-200 bg-brand-50/40">
      <SectionCard.Header
        eyebrow="Venue collective"
        title={`This venue is part of ${collective.name}`}
        description={
          collective.isHost
            ? 'Your combined booking page is set up under Manage combined page: its services, calendars, headings, photos and branding all live there, not on this tab.'
            : `${collective.hostVenueName} hosts your combined booking page and manages its services, calendars and branding under Manage combined page. You can view the combined page, and your part in it, under Linked accounts.`
        }
      />
      <SectionCard.Body className="space-y-3">
        <p className="text-sm text-slate-600">
          {collective.adoptedThisVenue
            ? 'The combined page is served at this venue’s own booking address, so guests who use that address see the combined page. The settings below shape this venue’s own page only.'
            : 'The settings below shape this venue’s own booking page only. The combined page has its own address and its own settings.'}
        </p>
        <div className="flex flex-wrap gap-2">
          {collective.isHost ? (
            <Button type="button" size="sm" onClick={onManage}>
              Manage combined page
            </Button>
          ) : null}
          <Button type="button" size="sm" variant={collective.isHost ? 'secondary' : 'primary'} onClick={onOpenLinkedAccounts}>
            Open Linked accounts
          </Button>
        </div>
      </SectionCard.Body>
    </SectionCard>
  );
}
