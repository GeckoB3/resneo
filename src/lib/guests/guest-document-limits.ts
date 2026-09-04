/**
 * What a contact's Records section will accept, shared by the picker, the sign
 * route and the bucket migration so all three refuse the same things.
 *
 * Why the limits exist: Storage bills on bytes stored and bytes served. A phone
 * photo is 3 to 8 MB and the thumbnail grid serves the original, so a venue that
 * uploads freely turns into egress cost quickly. Photos are downscaled in the
 * browser before upload (`downscaleImageForUpload`), so 10 MB is plenty for
 * anything legitimate and only a mistake exceeds it. Video, archives and
 * executables are the files that would blow through a quota, so the type list
 * is an allowlist rather than a blocklist.
 */

export const GUEST_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const GUEST_DOCUMENT_MAX_LABEL = '10 MB';

/** Mime types the bucket and the sign route accept. Keep in step with the migration. */
export const GUEST_DOCUMENT_ALLOWED_MIME_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

/** Extensions for the file picker and for a browser that reports no mime type. */
const EXTENSION_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** The `accept` attribute for the picker: types and extensions, so every browser filters the dialog. */
export const GUEST_DOCUMENT_ACCEPT = [
  ...GUEST_DOCUMENT_ALLOWED_MIME_TYPES,
  ...Object.keys(EXTENSION_TO_MIME).map((ext) => `.${ext}`),
].join(',');

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase();
}

/**
 * The mime type to record for a file: what the browser reported when it is on
 * the allowlist, else what the extension implies (Windows reports `''` for HEIC,
 * and some browsers report `application/octet-stream` for anything unfamiliar).
 * Null means the file is not a type the Records section takes.
 */
export function resolveGuestDocumentMimeType(mimeType: string | null | undefined, fileName: string): string | null {
  const reported = (mimeType ?? '').trim().toLowerCase();
  if (reported && GUEST_DOCUMENT_ALLOWED_MIME_TYPES.includes(reported)) return reported;
  const byExtension = EXTENSION_TO_MIME[extensionOf(fileName)];
  if (byExtension && (!reported || reported === 'application/octet-stream' || reported.startsWith('image/'))) {
    return byExtension;
  }
  return null;
}

export type GuestDocumentRejection =
  | { ok: true; mimeType: string }
  | { ok: false; reason: 'type' | 'size'; message: string };

/** One answer for the picker and the route: accepted (with the mime to store), or why not. */
export function checkGuestDocument(input: {
  fileName: string;
  mimeType: string | null | undefined;
  sizeBytes: number;
}): GuestDocumentRejection {
  const mimeType = resolveGuestDocumentMimeType(input.mimeType, input.fileName);
  if (!mimeType) {
    return {
      ok: false,
      reason: 'type',
      message: `${input.fileName} is not a type we can store.`,
    };
  }
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    return { ok: false, reason: 'size', message: `${input.fileName} is empty.` };
  }
  if (input.sizeBytes > GUEST_DOCUMENT_MAX_BYTES) {
    return {
      ok: false,
      reason: 'size',
      message: `${input.fileName} is larger than ${GUEST_DOCUMENT_MAX_LABEL}. Photos are resized automatically, so this is usually a PDF or scan that needs compressing first.`,
    };
  }
  return { ok: true, mimeType };
}
