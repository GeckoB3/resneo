'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog } from '@/components/ui/primitives/Dialog';
import { downscaleImageForUpload } from '@/lib/guests/downscale-image';
import {
  GUEST_DOCUMENT_ACCEPT,
  GUEST_DOCUMENT_MAX_LABEL,
  checkGuestDocument,
} from '@/lib/guests/guest-document-limits';

/**
 * "Documents and photos" for one contact: upload, a thumbnail grid, and a viewer
 * that shows a photo or PDF in place. Lives in the Records section of the contact
 * panel and the booking panel, so both show the same thing for the same guest.
 *
 * Files sit in the private `guest-documents` bucket. The list carries a
 * short-lived `preview_url` for photos and PDFs (the thumbnail); opening the
 * viewer asks for a fresh URL with `intent=view`, which is what the audit trail
 * records. Anything else (a Word file, say) has no inline view and downloads.
 *
 * Photos are downscaled in the browser before upload and every file is checked
 * against the size cap and type allowlist (`guest-document-limits`) before a
 * request is made; the sign route and the bucket check the same rules again.
 */

export interface GuestDocumentRow {
  id: string;
  file_name: string;
  mime_type: string | null;
  file_size_bytes?: number | null;
  category: string | null;
  created_at: string;
  preview_url?: string | null;
}

export type DocumentKind = 'image' | 'pdf' | 'other';

export function documentKind(mimeType: string | null | undefined): DocumentKind {
  const mime = (mimeType ?? '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  return 'other';
}

export function formatFileSize(bytes: number | null | undefined): string | null {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUploaded(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function FileGlyph({ kind, className = 'h-8 w-8' }: { kind: DocumentKind; className?: string }) {
  if (kind === 'pdf') {
    return (
      <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
      </svg>
    );
  }
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" aria-hidden>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
    </svg>
  );
}

export function ContactDocumentsSection({
  guestId,
  onChanged,
  onCount,
}: {
  guestId: string;
  onChanged: () => void;
  /** Reports the number of files once loaded, for a parent accordion's summary. */
  onCount?: (count: number | null) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [docs, setDocs] = useState<GuestDocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ doc: GuestDocumentRow; url: string | null; loading: boolean } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/venue/guests/${guestId}/documents`);
      const j = (await res.json()) as { documents?: GuestDocumentRow[]; error?: string };
      if (!res.ok) throw new Error(typeof j.error === 'string' ? j.error : 'Failed to load');
      setDocs(j.documents ?? []);
      onCount?.((j.documents ?? []).length);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setLoading(false);
    }
  }, [guestId, onCount]);

  useEffect(() => {
    const id = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(id);
  }, [load]);

  async function uploadOne(picked: File) {
    // Type and size are checked here first so a refusal reads as a sentence, not
    // a failed request; the sign route and the bucket check again.
    const initial = checkGuestDocument({ fileName: picked.name, mimeType: picked.type, sizeBytes: picked.size });
    if (!initial.ok && initial.reason === 'type') throw new Error(initial.message);
    const resolvedMime = initial.ok ? initial.mimeType : picked.type || 'application/octet-stream';
    // Photos are shrunk before the size check, so a 6 MB phone photo passes as ~400 KB.
    const file = await downscaleImageForUpload(picked, resolvedMime);
    const accepted = checkGuestDocument({ fileName: file.name, mimeType: file.type || resolvedMime, sizeBytes: file.size });
    if (!accepted.ok) throw new Error(accepted.message);

    const sign = await fetch(`/api/venue/guests/${guestId}/documents/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        file_name: file.name,
        mime_type: accepted.mimeType,
        file_size_bytes: file.size,
      }),
    });
    const sj = (await sign.json()) as { signed_url?: string; document_id?: string; mime_type?: string; error?: string };
    if (!sign.ok) throw new Error(typeof sj.error === 'string' ? sj.error : 'Sign failed');
    if (!sj.signed_url || !sj.document_id) throw new Error('Invalid sign response');

    const put = await fetch(sj.signed_url, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': sj.mime_type ?? accepted.mimeType },
    });
    if (!put.ok) throw new Error('Upload failed');

    const done = await fetch(`/api/venue/guests/${guestId}/documents/${sj.document_id}/complete`, { method: 'POST' });
    if (!done.ok) {
      const dj = (await done.json().catch(() => ({}))) as { error?: string };
      throw new Error(typeof dj.error === 'string' ? dj.error : 'Complete failed');
    }
  }

  const onPickFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setUploading({ done: 0, total: files.length });
    setErr(null);
    try {
      for (const [i, file] of files.entries()) {
        setUploading({ done: i, total: files.length });
        await uploadOne(file);
      }
      await load();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Upload failed');
      await load();
    } finally {
      setUploading(null);
    }
  };

  async function freshUrl(docId: string, intent: 'view' | 'download'): Promise<string | null> {
    const res = await fetch(`/api/venue/guests/${guestId}/documents/${docId}/download${intent === 'view' ? '?intent=view' : ''}`);
    const j = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
    if (!res.ok || !j.url) {
      setErr(typeof j.error === 'string' ? j.error : 'Could not open the file');
      return null;
    }
    return j.url;
  }

  const download = async (docId: string) => {
    const url = await freshUrl(docId, 'download');
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
  };

  const open = async (doc: GuestDocumentRow) => {
    if (documentKind(doc.mime_type) === 'other') {
      await download(doc.id);
      return;
    }
    setViewing({ doc, url: null, loading: true });
    const url = await freshUrl(doc.id, 'view');
    setViewing((cur) => (cur && cur.doc.id === doc.id ? { doc, url, loading: false } : cur));
    if (!url) setViewing(null);
  };

  const remove = async (docId: string) => {
    if (!window.confirm('Remove this file? This cannot be undone.')) return;
    const res = await fetch(`/api/venue/guests/${guestId}/documents/${docId}`, { method: 'DELETE' });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setErr(typeof j.error === 'string' ? j.error : 'Delete failed');
      return;
    }
    await load();
    onChanged();
  };

  const viewingKind = viewing ? documentKind(viewing.doc.mime_type) : 'other';

  return (
    <div className="rounded-xl border border-slate-200 p-4">
      {err ? <p className="mb-2 text-sm text-red-600">{err}</p> : null}
      <div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={GUEST_DOCUMENT_ACCEPT}
          disabled={Boolean(uploading)}
          className="sr-only"
          tabIndex={-1}
          aria-label="Add documents or photos"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            void onPickFiles(files);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          disabled={Boolean(uploading)}
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
          {uploading ? `Uploading ${Math.min(uploading.done + 1, uploading.total)} of ${uploading.total}…` : 'Add documents or photos'}
        </button>
        <p className="mt-1.5 text-xs text-slate-500">
          Photos, PDFs, Word and Excel files up to {GUEST_DOCUMENT_MAX_LABEL} each. Photos are resized on upload. Photos and
          PDFs open here for viewing; other files download.
        </p>
      </div>
      {loading ? (
        <p className="mt-3 text-sm text-slate-500">Loading files…</p>
      ) : docs.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No documents or photos yet.</p>
      ) : (
        <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-2" aria-label="Documents and photos">
          {docs.map((d) => {
            const kind = documentKind(d.mime_type);
            const size = formatFileSize(d.file_size_bytes);
            return (
              <li key={d.id} className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
                <button
                  type="button"
                  onClick={() => void open(d)}
                  className="group relative flex aspect-square w-full items-center justify-center overflow-hidden bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
                  aria-label={`${kind === 'other' ? 'Download' : 'View'} ${d.file_name}`}
                >
                  {kind === 'image' && d.preview_url ? (
                    <img src={d.preview_url} alt="" className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]" loading="lazy" />
                  ) : (
                    <span className="flex flex-col items-center gap-1 text-slate-400">
                      <FileGlyph kind={kind} className="h-6 w-6" />
                      <span className="text-[10px] font-semibold uppercase tracking-wide">
                        {kind === 'pdf' ? 'PDF' : kind === 'image' ? 'Photo' : (d.file_name.split('.').pop() ?? 'File').slice(0, 5).toUpperCase()}
                      </span>
                    </span>
                  )}
                </button>
                <div className="flex min-w-0 flex-col gap-0.5 px-1.5 py-1">
                  <span className="truncate text-[11px] font-medium text-slate-800" title={d.file_name}>
                    {d.file_name}
                  </span>
                  <span className="text-[10px] text-slate-500">
                    {formatUploaded(d.created_at)}
                    {size ? ` · ${size}` : ''}
                  </span>
                  <div className="flex gap-2 text-[11px]">
                    <button type="button" className="text-brand-700 hover:underline" onClick={() => void download(d.id)}>
                      Download
                    </button>
                    <button type="button" className="text-red-600 hover:underline" onClick={() => void remove(d.id)}>
                      Remove
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog
        open={Boolean(viewing)}
        onOpenChange={(o) => !o && setViewing(null)}
        title={viewing?.doc.file_name ?? 'File'}
        size="lg"
        contentClassName="max-w-5xl"
        bodyClassName="flex min-h-0 flex-1 flex-col p-0"
        footer={
          viewing ? (
            <div className="flex items-center justify-end gap-3">
              <button type="button" className="text-sm font-medium text-brand-700 hover:underline" onClick={() => void download(viewing.doc.id)}>
                Download
              </button>
            </div>
          ) : null
        }
      >
        {viewing ? (
          viewing.loading || !viewing.url ? (
            <p className="p-6 text-sm text-slate-500">Opening…</p>
          ) : viewingKind === 'image' ? (
            <div className="flex max-h-[75vh] min-h-[16rem] items-center justify-center bg-slate-900/90 p-2">
              <img src={viewing.url} alt={viewing.doc.file_name} className="max-h-[72vh] max-w-full object-contain" />
            </div>
          ) : (
            <iframe src={viewing.url} title={viewing.doc.file_name} className="h-[75vh] w-full bg-slate-100" />
          )
        ) : null}
      </Dialog>
    </div>
  );
}
