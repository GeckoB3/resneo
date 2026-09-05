/**
 * @vitest-environment happy-dom
 * @vitest-environment-options { "settings": { "disableCSSFileLoading": true, "disableJavaScriptFileLoading": true, "disableIframePageLoading": true } }
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ContactDocumentsSection, documentKind, formatFileSize } from './ContactDocumentsSection';

const GUEST = 'guest-1';
const DOCS = [
  { id: 'photo', file_name: 'before.jpg', mime_type: 'image/jpeg', file_size_bytes: 240_000, category: null, created_at: '2026-09-01T10:00:00Z', preview_url: 'https://storage.test/before.jpg?sig=1' },
  { id: 'pdf', file_name: 'consent.pdf', mime_type: 'application/pdf', file_size_bytes: 1_500_000, category: null, created_at: '2026-08-20T10:00:00Z', preview_url: 'https://storage.test/consent.pdf?sig=1' },
  { id: 'doc', file_name: 'notes.docx', mime_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', file_size_bytes: 12_000, category: null, created_at: '2026-08-10T10:00:00Z', preview_url: null },
];

function stubFetch() {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith(`/api/venue/guests/${GUEST}/documents`)) {
        return new Response(JSON.stringify({ documents: DOCS }), { status: 200 });
      }
      if (/\/download(\?intent=view)?$/.test(url)) {
        return new Response(JSON.stringify({ url: `https://storage.test/fresh${url.includes('intent=view') ? '-view' : '-download'}` }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }),
  );
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('documentKind / formatFileSize', () => {
  it('classifies files and formats sizes', () => {
    expect(documentKind('image/png')).toBe('image');
    expect(documentKind('application/pdf')).toBe('pdf');
    expect(documentKind('text/plain')).toBe('other');
    expect(documentKind(null)).toBe('other');
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(240_000)).toBe('234 KB');
    expect(formatFileSize(1_500_000)).toBe('1.4 MB');
    expect(formatFileSize(null)).toBeNull();
  });
});

describe('ContactDocumentsSection', () => {
  it('shows a thumbnail for a photo, a glyph for a PDF or other file, and reports the count', async () => {
    stubFetch();
    const onCount = vi.fn();
    render(<ContactDocumentsSection guestId={GUEST} onChanged={() => {}} onCount={onCount} />);
    await waitFor(() => expect(screen.getByRole('list', { name: /documents and photos/i })).toBeInTheDocument());
    const thumb = screen.getByRole('button', { name: 'View before.jpg' });
    expect(thumb.querySelector('img')).toHaveAttribute('src', 'https://storage.test/before.jpg?sig=1');
    expect(screen.getByRole('button', { name: 'View consent.pdf' })).toHaveTextContent('PDF');
    expect(screen.getByRole('button', { name: 'Download notes.docx' })).toHaveTextContent('DOCX');
    expect(screen.getByText(/234 KB/)).toBeInTheDocument();
    expect(onCount).toHaveBeenCalledWith(3);
  });

  it('opens a photo in the viewer with a fresh URL fetched as a view, not a download', async () => {
    const calls = stubFetch();
    render(<ContactDocumentsSection guestId={GUEST} onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'View before.jpg' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'View before.jpg' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.querySelector('img')).toHaveAttribute('src', 'https://storage.test/fresh-view'));
    expect(calls.some((u) => u.endsWith('/documents/photo/download?intent=view'))).toBe(true);
    expect(calls.some((u) => u.endsWith('/documents/photo/download'))).toBe(false);
  });

  it('opens a PDF in an inline frame', async () => {
    stubFetch();
    render(<ContactDocumentsSection guestId={GUEST} onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'View consent.pdf' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'View consent.pdf' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.querySelector('iframe')).toHaveAttribute('src', 'https://storage.test/fresh-view'));
  });

  it('downloads a file that has no inline view instead of opening the viewer', async () => {
    const calls = stubFetch();
    vi.stubGlobal('open', vi.fn());
    render(<ContactDocumentsSection guestId={GUEST} onChanged={() => {}} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Download notes.docx' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Download notes.docx' }));
    await waitFor(() => expect(window.open).toHaveBeenCalledWith('https://storage.test/fresh-download', '_blank', 'noopener,noreferrer'));
    expect(calls.some((u) => u.endsWith('/documents/doc/download'))).toBe(true);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
