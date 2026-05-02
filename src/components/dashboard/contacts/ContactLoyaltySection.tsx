'use client';

import { useCallback, useEffect, useState } from 'react';

export function ContactLoyaltySection({ guestId, isAdmin }: { guestId: string; isAdmin: boolean }) {
  const [balance, setBalance] = useState(0);
  const [ledger, setLedger] = useState<{ id: string; delta_points: number; reason: string | null; created_at: string }[]>([]);
  const [delta, setDelta] = useState('0');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/venue/guests/${guestId}/loyalty`);
    const j = (await res.json()) as { balance?: number; ledger?: typeof ledger; error?: string };
    if (res.ok) {
      setBalance(j.balance ?? 0);
      setLedger(j.ledger ?? []);
    }
  }, [guestId]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(id);
  }, [load]);

  const adjust = async () => {
    setMsg(null);
    const d = Number.parseInt(delta, 10);
    if (!Number.isFinite(d) || d === 0) {
      setMsg('Enter a non-zero integer delta.');
      return;
    }
    if (!reason.trim()) {
      setMsg('Reason is required.');
      return;
    }
    const res = await fetch(`/api/venue/guests/${guestId}/loyalty`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ delta_points: d, reason: reason.trim() }),
    });
    const j = (await res.json()) as { error?: string };
    if (!res.ok) {
      setMsg(typeof j.error === 'string' ? j.error : 'Failed');
      return;
    }
    setReason('');
    setDelta('0');
    await load();
  };

  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-800">Loyalty / points</h3>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{balance}</p>
      <p className="text-xs text-slate-500">Balance from ledger (venue-scoped).</p>
      {ledger.length > 0 ? (
        <ul className="mt-2 max-h-32 overflow-y-auto text-xs text-slate-600">
          {ledger.map((r) => (
            <li key={r.id}>
              {r.created_at.slice(0, 10)} · {r.delta_points > 0 ? '+' : ''}
              {r.delta_points}
              {r.reason ? ` — ${r.reason}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
      {isAdmin ? (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          <p className="text-xs font-medium text-slate-600">Admin adjustment</p>
          {msg ? <p className="text-sm text-red-600">{msg}</p> : null}
          <input
            type="number"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason"
            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => void adjust()}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
          >
            Add ledger entry
          </button>
        </div>
      ) : null}
    </div>
  );
}
