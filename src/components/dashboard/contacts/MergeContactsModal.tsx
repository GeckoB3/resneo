'use client';

import { useState } from 'react';

export function MergeContactsModal({
  targetGuestId,
  onClose,
  onMerged,
}: {
  targetGuestId: string;
  onClose: () => void;
  onMerged: () => void;
}) {
  const [sourceIds, setSourceIds] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    const parts = sourceIds
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const uuids = parts.filter((p) => /^[0-9a-f-]{36}$/i.test(p));
    if (uuids.length === 0) {
      setErr('Enter at least one source guest UUID.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/venue/guests/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_guest_id: targetGuestId,
          source_guest_ids: uuids,
        }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(typeof j.error === 'string' ? j.error : 'Merge failed');
      onMerged();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Merge failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4">
      <div className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-slate-200 bg-white p-5 shadow-xl sm:rounded-2xl">
        <h3 className="text-lg font-semibold text-slate-900">Merge duplicate guests</h3>
        <p className="mt-1 text-sm text-slate-600">
          Re-points bookings, communications, documents, loyalty, and household links to this contact, then deletes the
          source guest rows. Admin only. Irreversible.
        </p>
        <p className="mt-2 text-xs text-slate-500">
          Target (kept): <span className="font-mono">{targetGuestId}</span>
        </p>
        {err ? <p className="mt-2 text-sm text-red-600">{err}</p> : null}
        <label className="mt-4 block text-xs font-medium text-slate-600">Source guest UUIDs (comma or space separated)</label>
        <textarea
          value={sourceIds}
          onChange={(e) => setSourceIds(e.target.value)}
          rows={3}
          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-sm"
          placeholder="uuid …"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={onClose} className="rounded-lg border border-slate-200 px-4 py-2 text-sm">
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void submit()}
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
          >
            {busy ? 'Merging…' : 'Merge'}
          </button>
        </div>
      </div>
    </div>
  );
}
