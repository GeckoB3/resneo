const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AllowedImageMime = (typeof ALLOWED_IMAGE_TYPES)[number];

const EXT_TO_MIME: Record<string, AllowedImageMime> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export interface ParsedImageUpload {
  bytes: ArrayBuffer;
  contentType: AllowedImageMime;
  ext: 'jpg' | 'png' | 'webp';
  size: number;
}

function mimeFromFilename(name: string): AllowedImageMime | null {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_TO_MIME[ext] ?? null;
}

function resolveMime(file: { type: string; name?: string }): AllowedImageMime | null {
  const type = file.type?.toLowerCase() ?? '';
  if ((ALLOWED_IMAGE_TYPES as readonly string[]).includes(type)) {
    return type as AllowedImageMime;
  }
  if (file.name) {
    return mimeFromFilename(file.name);
  }
  return null;
}

/**
 * Parse a multipart `file` field for venue image uploads.
 * Accepts `File` or `Blob` (Next.js FormData may yield either).
 */
export async function parseImageUploadFromFormData(
  formData: FormData,
  maxSizeBytes: number,
): Promise<ParsedImageUpload | { error: string; status: number }> {
  const raw = formData.get('file');
  if (!raw || (typeof raw !== 'object')) {
    return { error: 'No file provided', status: 400 };
  }

  const blob = raw as Blob;
  const size = blob.size;
  if (size <= 0) {
    return { error: 'Empty file', status: 400 };
  }
  if (size > maxSizeBytes) {
    return { error: `File too large (max ${Math.round(maxSizeBytes / (1024 * 1024))}MB)`, status: 400 };
  }

  const name = raw instanceof File ? raw.name : undefined;
  const contentType = resolveMime({ type: blob.type, name });
  if (!contentType) {
    return { error: 'Invalid type; use JPEG, PNG or WebP', status: 400 };
  }

  const ext = contentType === 'image/jpeg' ? 'jpg' : contentType === 'image/png' ? 'png' : 'webp';
  const bytes = await blob.arrayBuffer();

  return { bytes, contentType, ext, size };
}
