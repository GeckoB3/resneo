import { describe, expect, it } from 'vitest';
import { venueStorageObjectPathFromPublicUrl } from '@/lib/venue/venue-storage-url';

describe('venueStorageObjectPathFromPublicUrl', () => {
  it('extracts object path from a Supabase public URL', () => {
    const path = venueStorageObjectPathFromPublicUrl(
      'https://example.supabase.co/storage/v1/object/public/venue-service-photos/venue-id/abc.jpg',
      'venue-service-photos',
    );
    expect(path).toBe('venue-id/abc.jpg');
  });

  it('returns null for other buckets or hosts', () => {
    expect(
      venueStorageObjectPathFromPublicUrl('https://cdn.example.com/photo.jpg', 'venue-service-photos'),
    ).toBeNull();
  });
});
