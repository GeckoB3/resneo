'use client';

import { useCallback, useEffect, useState } from 'react';

interface HouseholdBlock {
  id: string;
  name: string | null;
  members: { guest_id: string; name: string | null; is_primary: boolean }[];
}

export function ContactHouseholdSection({
  guestId,
  clientLower,
  onChanged,
}: {
  guestId: string;
  clientLower: string;
  onChanged: () => void;
}) {
  const [households, setHouseholds] = useState<HouseholdBlock[]>([]);
  const [otherId, setOtherId] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/venue/guests/${guestId}/household`);
    const j = (await res.json()) as { households?: HouseholdBlock[] };
    setHouseholds(j.households ?? []);
  }, [guestId]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(id);
  }, [load]);

  const link = async () => {
    setMsg(null);
    const trimmed = otherId.trim();
    if (!trimmed) {
      setMsg('Enter another guest ID.');
      return;
    }
    const res = await fetch(`/api/venue/guests/${guestId}/household`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ other_guest_id: trimmed }),
    });
    const j = (await res.json()) as { error?: string; success?: boolean };
    if (!res.ok) {
      setMsg(typeof j.error === 'string' ? j.error : 'Link failed');
      return;
    }
    setOtherId('');
    await load();
    onChanged();
  };

  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-800">Household / linked contacts</h3>
      {msg ? <p className="mt-2 text-sm text-amber-800">{msg}</p> : null}
      {households.length === 0 ? (
        <p className="mt-2 text-sm text-slate-600">Not linked to a household yet.</p>
      ) : (
        <ul className="mt-2 space-y-3">
          {households.map((h) => (
            <li key={h.id} className="rounded-lg border border-slate-100 bg-slate-50/50 p-2">
              <div className="text-xs font-semibold text-slate-500">Household</div>
              <ul className="mt-1 text-sm text-slate-800">
                {h.members.map((m) => (
                  <li key={m.guest_id}>
                    {m.name ?? 'Unnamed'} {m.is_primary ? '(primary)' : ''}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-slate-600">Link another {clientLower} by UUID (from URL or list).</p>
      <input
        value={otherId}
        onChange={(e) => setOtherId(e.target.value)}
        placeholder="Other guest UUID"
        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono"
      />
      <button
        type="button"
        onClick={() => void link()}
        className="mt-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
      >
        Link to household
      </button>
    </div>
  );
}
