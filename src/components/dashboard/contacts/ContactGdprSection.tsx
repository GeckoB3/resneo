'use client';

import { useState } from 'react';

export function ContactGdprSection({
  guestId,
  clientLower,
  isAdmin,
}: {
  guestId: string;
  clientLower: string;
  isAdmin: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  if (!isAdmin) return null;

  const exportJson = async () => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/venue/gdpr/export-guest?guest_id=${encodeURIComponent(guestId)}`);
      const j = await res.json();
      if (!res.ok) {
        setNote(typeof (j as { error?: string }).error === 'string' ? (j as { error: string }).error : 'Export failed');
        return;
      }
      const blob = new Blob([JSON.stringify(j, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `guest-export-${guestId.slice(0, 8)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setNote('Export downloaded.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-800">GDPR (admin)</h3>
      <p className="mt-1 text-xs text-slate-600">Structured JSON export for this {clientLower}. Use Erase data in the contact card for anonymisation.</p>
      {note ? <p className="mt-2 text-sm text-slate-700">{note}</p> : null}
      <button
        type="button"
        disabled={busy}
        onClick={() => void exportJson()}
        className="mt-3 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
      >
        {busy ? 'Preparing…' : 'Download data export (JSON)'}
      </button>
    </div>
  );
}
