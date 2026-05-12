import { describe, expect, it } from 'vitest';
import {
  IMPORT_PROGRESS_DB_FLUSH_INTERVAL,
  shouldFlushImportProgressToDb,
} from '@/lib/import/import-execute-progress';

describe('shouldFlushImportProgressToDb', () => {
  it('flushes when batch budget is exhausted', () => {
    expect(shouldFlushImportProgressToDb(1, 0)).toBe(true);
    expect(shouldFlushImportProgressToDb(0, 0)).toBe(true);
  });

  it('flushes every IMPORT_PROGRESS_DB_FLUSH_INTERVAL rows when budget remains', () => {
    expect(shouldFlushImportProgressToDb(IMPORT_PROGRESS_DB_FLUSH_INTERVAL, 50)).toBe(true);
    expect(shouldFlushImportProgressToDb(IMPORT_PROGRESS_DB_FLUSH_INTERVAL - 1, 50)).toBe(false);
  });

  it('respects custom flush interval', () => {
    expect(shouldFlushImportProgressToDb(10, 100, 10)).toBe(true);
    expect(shouldFlushImportProgressToDb(9, 100, 10)).toBe(false);
  });
});
