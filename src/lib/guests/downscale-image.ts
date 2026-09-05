/**
 * Shrink a photo in the browser before it is uploaded to a contact's Records.
 *
 * A phone photo is 3 to 8 MB at 4,000 px or more; a treatment or before-and-after
 * photo reads the same at 2,000 px and 85% JPEG, at a tenth of the bytes. Both
 * storage and every later thumbnail load pay for the original, so this is the
 * single biggest lever on the Storage bill. Runs entirely on the client with a
 * canvas; nothing leaves the device until the small copy is ready.
 *
 * Kept as the original when: it is not a raster we should touch (GIF keeps its
 * animation, SVG is not a photo), it is already small enough, the browser cannot
 * decode it (HEIC outside Safari), or the re-encode would not actually be smaller.
 */

export const DOWNSCALE_MAX_EDGE_PX = 2000;
export const DOWNSCALE_JPEG_QUALITY = 0.85;
/** Below this a re-encode is not worth the quality trade. */
export const DOWNSCALE_MIN_BYTES = 600 * 1024;

const RESIZABLE = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

/** Pure decision, so it can be tested without a canvas. */
export function shouldDownscaleImage(input: { mimeType: string; sizeBytes: number; width?: number; height?: number }): boolean {
  if (!RESIZABLE.has(input.mimeType)) return false;
  if (input.sizeBytes < DOWNSCALE_MIN_BYTES) return false;
  if (input.width != null && input.height != null) {
    // A small-dimension file over the byte threshold is a heavy encode; re-encoding still helps.
    return true;
  }
  return true;
}

/** The size a `width`×`height` image lands at when its longer edge is capped. */
export function fitWithinMaxEdge(width: number, height: number, maxEdge = DOWNSCALE_MAX_EDGE_PX): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function jpegName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  const stem = dot === -1 ? fileName : fileName.slice(0, dot);
  return `${stem}.jpg`;
}

async function decode(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* fall through to <img>, which some browsers can decode where the bitmap path cannot */
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('decode failed'));
    };
    img.src = url;
  });
}

/**
 * The file to upload: a resized JPEG when that is smaller, otherwise the original.
 * Never throws; any failure returns the original so an upload is never blocked by
 * the optimisation.
 */
export async function downscaleImageForUpload(file: File, mimeType: string): Promise<File> {
  if (!shouldDownscaleImage({ mimeType, sizeBytes: file.size })) return file;
  if (typeof document === 'undefined') return file;
  try {
    const source = await decode(file);
    const srcWidth = 'naturalWidth' in source ? source.naturalWidth : source.width;
    const srcHeight = 'naturalHeight' in source ? source.naturalHeight : source.height;
    if (!srcWidth || !srcHeight) return file;
    const { width, height } = fitWithinMaxEdge(srcWidth, srcHeight);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return file;
    // A PNG with transparency lands on white, which is right for a photo and the
    // only sensible answer for a JPEG.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(source, 0, 0, width, height);
    if ('close' in source) source.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', DOWNSCALE_JPEG_QUALITY));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], jpegName(file.name), { type: 'image/jpeg', lastModified: file.lastModified });
  } catch {
    return file;
  }
}
