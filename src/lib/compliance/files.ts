import type { SupabaseClient } from '@supabase/supabase-js';
import type { ComplianceFormSchema, SignatureResponse } from '@/lib/compliance/form-schema';

export const COMPLIANCE_BUCKET = 'compliance-files';

/** Allowed file-upload MIME types for the `file` field (spec §13.3). */
export const COMPLIANCE_FILE_ALLOWED_MIME = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/webp',
] as const;
export const COMPLIANCE_FILE_MAX_BYTES = 10 * 1024 * 1024;

const COMPLIANCE_FILE_EXT_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/webp': 'webp',
};

export interface ComplianceFileUploadResult {
  storage_path: string;
  file_name: string;
  mime_type: string;
  file_size_bytes: number;
}

/**
 * Validate (MIME + size, spec §13.3) and store an uploaded `file`-field document under
 * `storagePrefix`, returning the FileResponse the form renderer expects. Shared by the
 * public form-link upload (`.../forms/[code]/file`) and the in-booking draft upload
 * (`.../booking-upload`). The caller decides + authorises the prefix.
 */
export async function uploadComplianceFile(
  admin: SupabaseClient,
  params: { storagePrefix: string; file: File },
): Promise<{ ok: true; value: ComplianceFileUploadResult } | { ok: false; error: string; status: number }> {
  const { file, storagePrefix } = params;
  if (!COMPLIANCE_FILE_ALLOWED_MIME.includes(file.type as (typeof COMPLIANCE_FILE_ALLOWED_MIME)[number])) {
    return { ok: false, error: 'Unsupported file type. Use PDF, JPEG, PNG, HEIC or WebP.', status: 400 };
  }
  if (file.size <= 0 || file.size > COMPLIANCE_FILE_MAX_BYTES) {
    return { ok: false, error: 'File must be between 0 and 10 MB.', status: 400 };
  }
  const ext = COMPLIANCE_FILE_EXT_BY_MIME[file.type] ?? 'bin';
  const prefix = storagePrefix.endsWith('/') ? storagePrefix : `${storagePrefix}/`;
  const storagePath = `${prefix}${crypto.randomUUID()}.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const { error } = await admin.storage.from(COMPLIANCE_BUCKET).upload(storagePath, bytes, {
    contentType: file.type,
    upsert: false,
  });
  if (error) {
    console.error('[uploadComplianceFile] failed:', error.message);
    return { ok: false, error: 'Upload failed. Please try again.', status: 500 };
  }
  return {
    ok: true,
    value: {
      storage_path: storagePath,
      file_name: file.name.slice(0, 500),
      mime_type: file.type,
      file_size_bytes: file.size,
    },
  };
}

const DATA_URL_RE = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/;

/** Decode a drawn-signature data URL into bytes + content type, or null if malformed/too large. */
export function parseSignatureDataUrl(
  dataUrl: string,
): { bytes: Buffer; contentType: string; ext: string } | null {
  const m = DATA_URL_RE.exec(dataUrl.trim());
  if (!m) return null;
  const contentType = m[1]!;
  try {
    const bytes = Buffer.from(m[2]!, 'base64');
    if (bytes.length === 0 || bytes.length > 2 * 1024 * 1024) return null; // signatures are small
    return { bytes, contentType, ext: contentType === 'image/jpeg' ? 'jpg' : 'png' };
  } catch {
    return null;
  }
}

export function signatureStoragePath(
  venueId: string,
  recordId: string,
  fieldId: string,
  ext: string,
): string {
  return `venues/${venueId}/signatures/${recordId}_${fieldId}.${ext}`;
}

/**
 * For each signature field whose response is a drawn data URL, upload the PNG/JPEG
 * to the compliance-files bucket and rewrite the response to `{ method, storage_path,
 * signed_at }` (dropping the inline data). Typed signatures are left untouched.
 * Returns the new responses object or an error message.
 */
export async function processSignatureUploads(
  admin: SupabaseClient,
  params: {
    venueId: string;
    recordId: string;
    schema: ComplianceFormSchema;
    responses: Record<string, unknown>;
  },
): Promise<{ ok: true; responses: Record<string, unknown> } | { ok: false; error: string }> {
  const next = { ...params.responses };

  for (const field of params.schema.fields) {
    if (field.type !== 'signature') continue;
    const value = next[field.id] as SignatureResponse | undefined;
    if (!value || value.method !== 'drawn') continue;
    // Already uploaded (e.g. re-processing) — keep storage_path.
    if (value.storage_path && !value.data) continue;
    if (!value.data) continue;

    const parsed = parseSignatureDataUrl(value.data);
    if (!parsed) {
      return { ok: false, error: `Invalid signature image for "${field.label}".` };
    }
    const path = signatureStoragePath(params.venueId, params.recordId, field.id, parsed.ext);
    const { error } = await admin.storage.from(COMPLIANCE_BUCKET).upload(path, parsed.bytes, {
      contentType: parsed.contentType,
      upsert: true,
    });
    if (error) {
      console.error('[processSignatureUploads] upload failed:', error.message);
      return { ok: false, error: 'Failed to store signature image.' };
    }
    next[field.id] = {
      method: 'drawn',
      storage_path: path,
      signed_at: value.signed_at,
    } satisfies SignatureResponse;
  }

  return { ok: true, responses: next };
}
