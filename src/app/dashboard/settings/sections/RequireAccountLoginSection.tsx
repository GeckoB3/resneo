'use client';

import { useCallback, useState } from 'react';
import type { VenueSettings } from '../types';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { useSettingsSave } from '../SettingsSaveContext';

interface Props {
  venue: VenueSettings;
  onUpdate: (patch: Partial<VenueSettings>) => void;
  isAdmin: boolean;
}

/**
 * Venue flag: require Supabase-authenticated guest session before completing a public booking.
 */
export function RequireAccountLoginSection({ venue, onUpdate, isAdmin }: Props) {
  const { report } = useSettingsSave();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const checked = venue.require_account_login_for_bookings ?? false;

  const onToggle = useCallback(async () => {
    if (!isAdmin || saving) return;
    const next = !checked;
    setSaving(true);
    setError(null);
    report({ status: 'saving' });
    try {
      const res = await fetch('/api/venue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ require_account_login_for_bookings: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (body as { error?: string }).error ?? 'Save failed';
        setError(msg);
        report({ status: 'error', message: msg });
        return;
      }
      onUpdate({ require_account_login_for_bookings: next });
      report({ status: 'saved', message: 'Guest sign-in setting saved.' });
    } catch {
      setError('Save failed');
      report({ status: 'error', message: 'Save failed' });
    } finally {
      setSaving(false);
    }
  }, [checked, isAdmin, onUpdate, report, saving]);

  if (!isAdmin) return null;

  return (
    <SectionCard elevated>
      <SectionCard.Header
        eyebrow="Guest access"
        title="Require ReserveNI sign-in to book"
        description="When enabled, guests must click a magic link and complete login before they can finish an online booking at your venue. Manage-booking links in confirmation emails are unchanged."
      />
      <SectionCard.Body className="space-y-3">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            checked={checked}
            disabled={saving}
            onChange={() => void onToggle()}
          />
          <span className="text-sm text-slate-700">
            Require account login for online bookings
            {saving ? <span className="ml-2 text-slate-500">Saving…</span> : null}
          </span>
        </label>
        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
        ) : null}
      </SectionCard.Body>
    </SectionCard>
  );
}
