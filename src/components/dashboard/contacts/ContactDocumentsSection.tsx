'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface DocRow {
  id: string;
  file_name: string;
  mime_type: string | null;
  category: string | null;
  created_at: string;
}

export function ContactDocumentsSection({ guestId, onChanged }: { guestId: string; onChanged: () => void }) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/venue/guests/${guestId}/documents`);
      const j = (await res.json()) as { documents?: DocRow[]; error?: string };
      if (!res.ok) throw new Error(typeof j.error === 'string' ? j.error : 'Failed to load');
      setDocs(j.documents ?? []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [guestId]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(id);
  }, [load]);

  const onPickFile = async (file: File | null) => {
    if (!file) return;
    setUploading(true);
    setErr(null);
    try {
      const sign = await fetch(`/api/venue/guests/${guestId}/documents/sign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_name: file.name,
          mime_type: file.type || 'application/octet-stream',
          file_size_bytes: file.size,
        }),
      });
      const sj = (await sign.json()) as { signed_url?: string; document_id?: string; error?: string };
      if (!sign.ok) throw new Error(typeof sj.error === 'string' ? sj.error : 'Sign failed');
      if (!sj.signed_url || !sj.document_id) throw new Error('Invalid sign response');

      const put = await fetch(sj.signed_url, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
      if (!put.ok) throw new Error('Upload failed');

      const done = await fetch(`/api/venue/guests/${guestId}/documents/${sj.document_id}/complete`, { method: 'POST' });
      if (!done.ok) {
        const dj = (await done.json().catch(() => ({}))) as { error?: string };
        throw new Error(typeof dj.error === 'string' ? dj.error : 'Complete failed');
      }
      await load();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const download = async (docId: string) => {
    const res = await fetch(`/api/venue/guests/${guestId}/documents/${docId}/download`);
    const j = (await res.json()) as { url?: string; error?: string };
    if (!res.ok || !j.url) {
      setErr(typeof j.error === 'string' ? j.error : 'Download failed');
      return;
    }
    window.open(j.url, '_blank', 'noopener,noreferrer');
  };

  const remove = async (docId: string) => {
    if (!window.confirm('Remove this document?')) return;
    const res = await fetch(`/api/venue/guests/${guestId}/documents/${docId}`, { method: 'DELETE' });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(typeof j.error === 'string' ? j.error : 'Delete failed');
      return;
    }
    await load();
    onChanged();
  };

  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-800">Documents</h3>
      {err ? <p className="mt-2 text-sm text-red-600">{err}</p> : null}
      <div className="mt-3">
        <input
          ref={fileInputRef}
          type="file"
          disabled={uploading}
          className="sr-only"
          tabIndex={-1}
          onChange={(e) => {
            const file = e.target.files?.[0] ?? null;
            void onPickFile(file);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileInputRef.current?.click()}
          className="inline-flex min-h-11 w-full touch-manipulation items-center justify-center gap-2 rounded-lg border border-brand-600 bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 active:bg-brand-800 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400 disabled:shadow-none sm:w-auto sm:min-w-[10rem]"
        >
          <svg className="h-4 w-4 shrink-0 opacity-90" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3"
            />
          </svg>
          {uploading ? 'Uploading…' : 'Choose file'}
        </button>
      </div>
      {loading ? (
        <p className="mt-2 text-sm text-slate-500">Loading documents…</p>
      ) : docs.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">No documents yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-100">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="font-medium text-slate-800">{d.file_name}</span>
              <div className="flex gap-2">
                <button type="button" className="text-brand-700 hover:underline" onClick={() => void download(d.id)}>
                  Download
                </button>
                <button type="button" className="text-red-600 hover:underline" onClick={() => void remove(d.id)}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
