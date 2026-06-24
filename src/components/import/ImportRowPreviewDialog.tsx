'use client';

import { useEffect, useState } from 'react';
import { Dialog } from '@/components/ui/primitives/Dialog';

type Props = {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  fileId: string;
  rowNumber: number;
  filename: string;
};

export function ImportRowPreviewDialog({ open, onClose, sessionId, fileId, rowNumber, filename }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cells, setCells] = useState<Array<{ key: string; value: string }>>([]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(
          `/api/import/sessions/${sessionId}/files/${fileId}/row?row=${rowNumber}`,
        );
        const data = (await res.json()) as {
          values?: Record<string, string>;
          headers?: string[];
          error?: string;
        };
        if (!res.ok) throw new Error(data.error ?? 'Failed to load row');
        const headers = data.headers ?? Object.keys(data.values ?? {});
        const vals = data.values ?? {};
        const list = headers.map((key) => ({ key, value: vals[key] ?? '' }));
        if (!cancelled) {
          setCells(list);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, sessionId, fileId, rowNumber]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      size="lg"
      contentClassName="max-w-2xl"
      title={`Row ${rowNumber}`}
      description={filename}
    >
      {loading && <p className="text-sm text-slate-500">Loading row…</p>}
      {error && <p className="text-sm text-red-700">{error}</p>}
      {!loading && !error && (
        <table className="w-full text-left text-xs">
          <tbody>
            {cells.map((c) => (
              <tr key={c.key} className="border-b border-slate-100">
                <th className="w-1/3 whitespace-nowrap py-1.5 pr-2 font-mono font-medium text-slate-600">
                  {c.key}
                </th>
                <td className="break-words py-1.5 text-slate-900">{c.value || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Dialog>
  );
}
