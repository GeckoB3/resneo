import { describe, expect, it } from 'vitest';
import { DOWNSCALE_MIN_BYTES, fitWithinMaxEdge, shouldDownscaleImage } from './downscale-image';

describe('downscale decisions', () => {
  it('only touches heavy raster photos', () => {
    expect(shouldDownscaleImage({ mimeType: 'image/jpeg', sizeBytes: 5 * 1024 * 1024 })).toBe(true);
    expect(shouldDownscaleImage({ mimeType: 'image/heic', sizeBytes: 5 * 1024 * 1024 })).toBe(true);
    expect(shouldDownscaleImage({ mimeType: 'image/jpeg', sizeBytes: DOWNSCALE_MIN_BYTES - 1 })).toBe(false);
    expect(shouldDownscaleImage({ mimeType: 'image/gif', sizeBytes: 5 * 1024 * 1024 })).toBe(false);
    expect(shouldDownscaleImage({ mimeType: 'application/pdf', sizeBytes: 5 * 1024 * 1024 })).toBe(false);
  });

  it('caps the longer edge and keeps the aspect ratio', () => {
    expect(fitWithinMaxEdge(4000, 3000)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithinMaxEdge(1200, 3600)).toEqual({ width: 667, height: 2000 });
    expect(fitWithinMaxEdge(1600, 900)).toEqual({ width: 1600, height: 900 });
  });
});
