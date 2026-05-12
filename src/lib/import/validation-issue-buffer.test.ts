import { describe, expect, it } from 'vitest';
import { VALIDATION_ISSUES_INSERT_CHUNK, ValidationIssueBuffer } from '@/lib/import/validation-issue-buffer';

describe('ValidationIssueBuffer.chunk', () => {
  it('returns empty array for empty input', () => {
    expect(ValidationIssueBuffer.chunk([], 500)).toEqual([]);
  });

  it('splits rows into fixed-size chunks except the last', () => {
    const rows = [1, 2, 3, 4, 5];
    expect(ValidationIssueBuffer.chunk(rows, 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it('throws when chunkSize is not positive', () => {
    expect(() => ValidationIssueBuffer.chunk([1], 0)).toThrow(/chunkSize/);
  });
});

describe('ValidationIssueBuffer', () => {
  it('inserts in chunks of VALIDATION_ISSUES_INSERT_CHUNK and flushes remainder', async () => {
    const insertedLengths: number[] = [];
    const admin = {
      from() {
        return {
          insert(rows: unknown[]) {
            insertedLengths.push((rows as unknown[]).length);
            return Promise.resolve({ error: null });
          },
        };
      },
    };

    const buf = new ValidationIssueBuffer(admin as never, 3);
    const base = {
      session_id: 's1',
      file_id: 'f1',
      severity: 'warning' as const,
      issue_type: 't',
      column_name: null,
      raw_value: null,
      message: 'm',
    };
    for (let i = 0; i < 7; i++) {
      await buf.add({ ...base, row_number: i + 1 });
    }
    await buf.flushAll();
    expect(insertedLengths).toEqual([3, 3, 1]);
  });

  it('flushAll with empty buffer does nothing', async () => {
    const admin = {
      from() {
        return {
          insert() {
            throw new Error('should not insert');
          },
        };
      },
    };
    const buf = new ValidationIssueBuffer(admin as never);
    await expect(buf.flushAll()).resolves.toBeUndefined();
  });
});

describe('VALIDATION_ISSUES_INSERT_CHUNK', () => {
  it('is a sensible default batch size', () => {
    expect(VALIDATION_ISSUES_INSERT_CHUNK).toBeGreaterThanOrEqual(100);
    expect(VALIDATION_ISSUES_INSERT_CHUNK).toBeLessThanOrEqual(2000);
  });
});
