import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearFormDraft,
  clearFormDraftsByPrefix,
  loadFormDraft,
  saveFormDraft,
} from '@/lib/compliance/form-draft';

/** Minimal in-memory localStorage stand-in implementing the bits the helper uses. */
function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
  } as Storage;
}

function withStorage(storage: Storage | undefined) {
  vi.stubGlobal('window', storage ? { localStorage: storage } : undefined);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('form-draft', () => {
  it('round-trips a saved draft', () => {
    withStorage(makeStorage());
    saveFormDraft('public:abc', { name: 'Ada', agree: true });
    expect(loadFormDraft('public:abc')).toEqual({ name: 'Ada', agree: true });
  });

  it('returns null for a missing draft', () => {
    withStorage(makeStorage());
    expect(loadFormDraft('public:none')).toBeNull();
  });

  it('clears a single draft', () => {
    withStorage(makeStorage());
    saveFormDraft('public:abc', { name: 'Ada' });
    clearFormDraft('public:abc');
    expect(loadFormDraft('public:abc')).toBeNull();
  });

  it('expires drafts older than the max age', () => {
    const storage = makeStorage();
    withStorage(storage);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-01T00:00:00Z'));
    saveFormDraft('public:abc', { name: 'Ada' });
    // 8 days later: past the 7-day window.
    vi.setSystemTime(new Date('2026-06-09T00:00:00Z'));
    expect(loadFormDraft('public:abc')).toBeNull();
    // The expired entry is purged on read.
    expect(storage.getItem('resneo.compliance.draft.public:abc')).toBeNull();
  });

  it('clears every draft under a prefix, leaving others', () => {
    withStorage(makeStorage());
    saveFormDraft('booking-inline:v1:d1:t1', { a: 1 });
    saveFormDraft('booking-inline:v1:d1:t2', { b: 2 });
    saveFormDraft('booking-inline:v2:d9:t1', { c: 3 });
    clearFormDraftsByPrefix('booking-inline:v1:');
    expect(loadFormDraft('booking-inline:v1:d1:t1')).toBeNull();
    expect(loadFormDraft('booking-inline:v1:d1:t2')).toBeNull();
    expect(loadFormDraft('booking-inline:v2:d9:t1')).toEqual({ c: 3 });
  });

  it('no-ops without a window (SSR) instead of throwing', () => {
    withStorage(undefined);
    expect(() => saveFormDraft('public:abc', { name: 'Ada' })).not.toThrow();
    expect(loadFormDraft('public:abc')).toBeNull();
    expect(() => clearFormDraft('public:abc')).not.toThrow();
    expect(() => clearFormDraftsByPrefix('booking-')).not.toThrow();
  });

  it('survives a storage that throws on write (quota)', () => {
    const throwing = {
      get length() {
        return 0;
      },
      clear: () => {},
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
      removeItem: () => {},
      key: () => null,
    } as Storage;
    withStorage(throwing);
    expect(() => saveFormDraft('public:abc', { name: 'Ada' })).not.toThrow();
  });
});
