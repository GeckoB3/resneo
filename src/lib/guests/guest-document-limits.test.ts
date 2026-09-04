import { describe, expect, it } from 'vitest';
import {
  GUEST_DOCUMENT_ACCEPT,
  GUEST_DOCUMENT_ALLOWED_MIME_TYPES,
  GUEST_DOCUMENT_MAX_BYTES,
  checkGuestDocument,
  resolveGuestDocumentMimeType,
} from './guest-document-limits';

describe('guest document limits', () => {
  it('accepts allowlisted types and infers a type from the extension when the browser gives none', () => {
    expect(resolveGuestDocumentMimeType('image/jpeg', 'a.jpg')).toBe('image/jpeg');
    expect(resolveGuestDocumentMimeType('', 'scan.HEIC')).toBe('image/heic');
    expect(resolveGuestDocumentMimeType('application/octet-stream', 'report.pdf')).toBe('application/pdf');
    expect(resolveGuestDocumentMimeType('application/octet-stream', 'notes.docx')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
  });

  it('refuses types outside the allowlist, with or without a matching extension', () => {
    expect(resolveGuestDocumentMimeType('video/mp4', 'clip.mp4')).toBeNull();
    expect(resolveGuestDocumentMimeType('application/zip', 'files.zip')).toBeNull();
    // A lying extension does not rescue a disallowed reported type.
    expect(resolveGuestDocumentMimeType('application/x-msdownload', 'setup.pdf')).toBeNull();
    expect(checkGuestDocument({ fileName: 'clip.mp4', mimeType: 'video/mp4', sizeBytes: 10 })).toMatchObject({ ok: false, reason: 'type' });
  });

  it('enforces the size cap and rejects empty files', () => {
    expect(checkGuestDocument({ fileName: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: GUEST_DOCUMENT_MAX_BYTES })).toMatchObject({ ok: true, mimeType: 'image/jpeg' });
    expect(checkGuestDocument({ fileName: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: GUEST_DOCUMENT_MAX_BYTES + 1 })).toMatchObject({ ok: false, reason: 'size' });
    expect(checkGuestDocument({ fileName: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 0 })).toMatchObject({ ok: false, reason: 'size' });
  });

  it('builds a picker accept list covering every allowed type', () => {
    for (const mime of GUEST_DOCUMENT_ALLOWED_MIME_TYPES) expect(GUEST_DOCUMENT_ACCEPT).toContain(mime);
    expect(GUEST_DOCUMENT_ACCEPT).toContain('.heic');
    expect(GUEST_DOCUMENT_ACCEPT).toContain('.xlsx');
  });
});
