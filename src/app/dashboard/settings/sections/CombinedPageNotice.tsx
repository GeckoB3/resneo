'use client';

import { SectionCard } from '@/components/ui/dashboard/SectionCard';

/** The live venue collective a venue belongs to, as the Booking page tab needs it. */
export interface SettingsCollectiveNote {
  id: string;
  name: string;
  /** This venue hosts the collective, so it can edit the combined page. */
  isHost: boolean;
  hostVenueName: string;
  /** The combined page is served at this venue's own booking address. */
  adoptedThisVenue: boolean;
}

/** Which booking page the tab is managing. */
export type BookingPageScope = 'combined' | 'own';

const SCOPES: { key: BookingPageScope; label: (c: SettingsCollectiveNote) => string }[] = [
  { key: 'combined', label: (c) => `Combined page (${c.name})` },
  { key: 'own', label: () => 'This venue’s own page' },
];

/**
 * Top of the Booking page tab for a venue in a live collective: says the venue
 * shares one booking page with the other members and switches the tab between
 * that combined page and this venue's own page.
 */
export function CombinedPageScopeSwitch({
  collective,
  scope,
  onScopeChange,
}: {
  collective: SettingsCollectiveNote;
  scope: BookingPageScope;
  onScopeChange: (scope: BookingPageScope) => void;
}) {
  return (
    <SectionCard elevated className="border-brand-200 bg-brand-50/40">
      <SectionCard.Header
        eyebrow="Venue collective"
        title={`This venue is part of ${collective.name}`}
        description={
          collective.isHost
            ? `This venue shares one booking page with the other members of ${collective.name}, and hosts it. Guests who book with you use the combined page. This venue’s own page is separate.`
            : `This venue shares one booking page with the other members of ${collective.name}. ${collective.hostVenueName} hosts it. Guests who book with you use the combined page. This venue’s own page is separate.`
        }
      />
      <SectionCard.Body className="space-y-3">
        {collective.adoptedThisVenue ? (
          <p className="text-sm text-slate-600">
            The combined page is served at this venue’s own address, so its settings are what guests see
            there.
          </p>
        ) : null}
        <div
          role="tablist"
          aria-label="Which booking page to manage"
          className="flex flex-wrap gap-1 border-b border-brand-200"
          onKeyDown={(e) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            e.preventDefault();
            const idx = SCOPES.findIndex((s) => s.key === scope);
            const next = SCOPES[(idx + (e.key === 'ArrowRight' ? 1 : SCOPES.length - 1)) % SCOPES.length]!;
            onScopeChange(next.key);
            const el = (e.currentTarget as HTMLElement).querySelector<HTMLButtonElement>(`[data-scope="${next.key}"]`);
            el?.focus();
          }}
        >
          {SCOPES.map((s) => (
            <button
              key={s.key}
              type="button"
              role="tab"
              data-scope={s.key}
              data-testid={`booking-page-scope-${s.key}`}
              aria-selected={scope === s.key}
              tabIndex={scope === s.key ? 0 : -1}
              onClick={() => onScopeChange(s.key)}
              className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition ${
                scope === s.key
                  ? 'border-brand-600 text-brand-700'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              {s.label(collective)}
            </button>
          ))}
        </div>
      </SectionCard.Body>
    </SectionCard>
  );
}
