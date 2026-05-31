import { describe, expect, it } from 'vitest';
import { parseImageUploadFromFormData } from '@/lib/venue/parse-image-upload';

describe('parseImageUploadFromFormData', () => {
  it('accepts JPEG when file.type is empty but filename ends in .jpg', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff]);
    const blob = new Blob([bytes], { type: '' });
    const form = new FormData();
    form.append('file', blob, 'service.jpg');

    const parsed = await parseImageUploadFromFormData(form, 5 * 1024 * 1024);
    expect('error' in parsed).toBe(false);
    if ('error' in parsed) return;
    expect(parsed.contentType).toBe('image/jpeg');
    expect(parsed.ext).toBe('jpg');
  });

  it('rejects unknown extensions', async () => {
    const form = new FormData();
    form.append('file', new Blob(['x'], { type: '' }), 'file.gif');
    const parsed = await parseImageUploadFromFormData(form, 1024);
    expect(parsed).toEqual({ error: 'Invalid type; use JPEG, PNG or WebP', status: 400 });
  });
});
