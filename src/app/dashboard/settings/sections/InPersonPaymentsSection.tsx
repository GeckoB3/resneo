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
 * Venue flag: accept in-person card payments (Tap to Pay / card reader) from the
 * ResNeo mobile app. Master switch for the whole feature, default off
 * (Tap to Pay design doc §6.7): when off the app renders no payment surface and
 * the connection-token + charge endpoints refuse with 403.
 *
 * Admin-only, matching every other money setting. Taking payment always stays a
 * per-appointment choice for staff; this only decides whether the option exists.
 */
export function InPersonPaymentsSection({ venue, onUpdate, isAdmin }: Props) {
  const { report } = useSettingsSave();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const checked = venue.in_person_payments_enabled ?? false;
  // Card payments settle through the venue's own Stripe account, so without a
  // connected account the switch cannot do anything useful yet.
  const stripeConnected = Boolean(venue.stripe_connected_account_id);

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
        body: JSON.stringify({ in_person_payments_enabled: next }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = (body as { error?: string }).error ?? 'Save failed';
        setError(msg);
        report({ status: 'error', message: msg });
        return;
      }
      onUpdate({ in_person_payments_enabled: next });
      report({
        status: 'saved',
        message: next ? 'In-person payments turned on.' : 'In-person payments turned off.',
      });
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
        eyebrow="In-person payments"
        title="Take card payments at your venue"
        description="Let your team collect an appointment's outstanding balance in person from the ResNeo app, by tapping the client's card or phone. Payments go straight to your own Stripe account and ResNeo takes no cut."
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
            Allow in-person card payments from the ResNeo app
            {saving ? <span className="ml-2 text-slate-500">Saving…</span> : null}
          </span>
        </label>

        <p className="text-xs text-slate-500">
          Taking a payment is always your team&apos;s choice, appointment by appointment. Turning
          this on never requires anyone to collect payment, and an appointment can still be
          completed with a balance outstanding.
        </p>

        {!stripeConnected ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Connect Stripe first (Plan &amp; payments). Card payments are paid into your own Stripe
            account, so this setting has no effect until that is set up.
          </div>
        ) : null}

        {checked ? (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
            Your team also needs the latest ResNeo app on a supported phone: iPhone XS or newer
            (iOS 16.4+), or an Android 11+ phone with NFC. We are rolling this out gradually, so
            the option may not appear in your app straight away.
          </div>
        ) : null}

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}
      </SectionCard.Body>
    </SectionCard>
  );
}
