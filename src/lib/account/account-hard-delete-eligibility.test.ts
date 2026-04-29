import { describe, it, expect } from 'vitest';
import { filterUserIdsDueForHardDelete } from '@/lib/account/account-hard-delete-eligibility';

describe('filterUserIdsDueForHardDelete', () => {
  const now = '2026-07-01T12:00:00.000Z';

  it('returns ids when deleted_at is null or in the future', () => {
    expect(
      filterUserIdsDueForHardDelete(
        [
          { id: 'a', deleted_at: null },
          { id: 'b', deleted_at: '2026-08-01T00:00:00.000Z' },
        ],
        now,
      ),
    ).toEqual([]);
  });

  it('returns ids when deleted_at is on or before now', () => {
    expect(
      filterUserIdsDueForHardDelete(
        [
          { id: 'a', deleted_at: '2026-07-01T12:00:00.000Z' },
          { id: 'b', deleted_at: '2026-06-01T00:00:00.000Z' },
        ],
        now,
      ),
    ).toEqual(['a', 'b']);
  });
});
