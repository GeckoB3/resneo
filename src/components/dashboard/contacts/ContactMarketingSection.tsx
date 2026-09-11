'use client';

import { useCallback, useEffect, useState } from 'react';
import type { GuestDetailResponse } from '@/types/contacts';

export function ContactMarketingSection({
  guestId,
  detail,
  onUpdated,
}: {
  guestId: string;
  detail: GuestDetailResponse;
  onUpdated: () => void;
}) {
  const [optOut, setOptOut] = useState(detail.guest.marketing_opt_out);
  const [consent, setConsent] = useState(detail.guest.marketing_consent);

  useEffect(() => {
    setOptOut(detail.guest.marketing_opt_out);
    setConsent(detail.guest.marketing_consent);
  }, [detail.guest.marketing_opt_out, detail.guest.marketing_consent, guestId]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = useCallback(async () => {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/venue/guests/${guestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          marketing_opt_out: optOut,
          marketing_consent: consent,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(typeof j.error === 'string' ? j.error : 'Save failed');
      onUpdated();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [guestId, optOut, consent, onUpdated]);

  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-800">Marketing preferences</h3>
      <p className="mt-1 text-xs text-slate-600">
        Booking messages (confirmations, reminders) and one-to-one messages you send from this panel are always
        delivered. Messages sent to several contacts at once from the contacts list only go to contacts with marketing
        consent who have not opted out.
      </p>
      {err ? <p className="mt-2 text-sm text-red-600">{err}</p> : null}
      <label className="mt-3 flex items-center gap-2 text-sm text-slate-800">
        <input
          type="checkbox"
          checked={optOut}
          onChange={(e) => {
            setOptOut(e.target.checked);
            if (e.target.checked) setConsent(false);
          }}
        />
        Opted out of marketing
      </label>
      <label className="mt-2 flex items-center gap-2 text-sm text-slate-800">
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => {
            setConsent(e.target.checked);
            if (e.target.checked) setOptOut(false);
          }}
        />
        Marketing consent given
      </label>
      <p className="mt-2 text-xs font-medium text-slate-700">
        {consent && !optOut ? 'Receives marketing messages.' : 'Does not receive marketing messages.'}
      </p>
      {detail.guest.marketing_consent_at ? (
        <p className="mt-1 text-xs text-slate-500">Last consent recorded: {new Date(detail.guest.marketing_consent_at).toLocaleString()}</p>
      ) : null}
      <button
        type="button"
        disabled={saving}
        onClick={() => void save()}
        className="mt-3 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {saving ? 'Saving…' : 'Save marketing preferences'}
      </button>
    </div>
  );
}
