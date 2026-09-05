import { describe, expect, it, vi } from 'vitest';
import { maskPiiForPrompt } from '@/lib/import/ai-map-columns';

describe('maskPiiForPrompt', () => {
  it('masks the local part of an email but keeps the domain shape', () => {
    expect(maskPiiForPrompt('jane.doe@example.com')).toBe('j***@example.com');
    expect(maskPiiForPrompt('a@b.co.uk')).toBe('a***@b.co.uk');
  });

  it('masks phone numbers, keeping only the last 2-3 digits', () => {
    // 12 digits -> 9 masked + last 3
    expect(maskPiiForPrompt('+44 7725 002233')).toBe('*********233');
    // 11 digits -> 8 masked + last 3
    expect(maskPiiForPrompt('(028) 9012 3456')).toBe('********456');
    expect(maskPiiForPrompt('07700900123')).toBe('********123');
  });

  it('keeps phone masking purely numeric (separators are dropped, not masked)', () => {
    const masked = maskPiiForPrompt('+44 7725 002233');
    expect(masked).not.toContain('+');
    expect(masked).not.toContain(' ');
    expect(masked.endsWith('233')).toBe(true);
    // last-N kept, rest are asterisks: no real leading digits leak
    expect(/^\*+\d{2,3}$/.test(masked)).toBe(true);
  });

  it('leaves names and other text untouched (needed for split detection)', () => {
    expect(maskPiiForPrompt('Jane Doe')).toBe('Jane Doe');
    expect(maskPiiForPrompt('Smith, John')).toBe('Smith, John');
    expect(maskPiiForPrompt('VIP')).toBe('VIP');
    expect(maskPiiForPrompt('Gents Cut')).toBe('Gents Cut');
  });

  it('leaves dates, times and plain numbers untouched', () => {
    expect(maskPiiForPrompt('14/03/2026')).toBe('14/03/2026');
    expect(maskPiiForPrompt('2:30 PM')).toBe('2:30 PM');
    expect(maskPiiForPrompt('2026-03-14 14:30')).toBe('2026-03-14 14:30');
    // short digit strings (not phone-length) are left as-is
    expect(maskPiiForPrompt('12345')).toBe('12345');
  });

  it('returns empty/whitespace values unchanged', () => {
    expect(maskPiiForPrompt('')).toBe('');
    expect(maskPiiForPrompt('   ')).toBe('   ');
  });
});

vi.mock('@/lib/import/openai-client', () => ({ runImportAiJson: vi.fn() }));

describe('runAiColumnMapping result clean-up', () => {
  it('turns unusable AI rows into ignores and keeps one source column per field', async () => {
    const { runImportAiJson } = await import('@/lib/import/openai-client');
    const { runAiColumnMapping } = await import('./ai-map-columns');
    vi.mocked(runImportAiJson).mockResolvedValue({
      model: 'test-model',
      data: {
        mappings: [
          { source_column: 'Email', action: 'map', target_field: 'email', confidence: 'high', reasoning: '', split_config: null, value_map: null },
          // Second column claiming a field already taken: dropped to ignore.
          { source_column: 'Email 2', action: 'map', target_field: 'email', confidence: 'low', reasoning: '', split_config: null, value_map: null },
          // A field that is not in the target list.
          { source_column: 'Loyalty', action: 'map', target_field: 'loyalty_points', confidence: 'medium', reasoning: '', split_config: null, value_map: null },
          // "map" with no target, and a split with nothing to split into.
          { source_column: 'Notes', action: 'map', target_field: null, confidence: 'low', reasoning: '', split_config: null, value_map: null },
          { source_column: 'Name', action: 'split', target_field: null, confidence: 'high', reasoning: '', split_config: null, value_map: null },
          { source_column: 'Full', action: 'split', target_field: null, confidence: 'high', reasoning: '', split_config: { separator: ' ', parts: [{ field: 'first_name' }, { field: 'last_name' }] }, value_map: null },
        ],
      },
    } as never);

    const result = await runAiColumnMapping({
      headers: ['Email', 'Email 2', 'Loyalty', 'Notes', 'Name', 'Full'],
      sampleRows: [],
      fileType: 'clients',
      targetFields: [
        { key: 'email', label: 'Email', required: false, type: 'string' },
        { key: 'first_name', label: 'First name', required: true, type: 'string' },
        { key: 'last_name', label: 'Surname', required: true, type: 'string' },
      ] as never,
    });

    expect(result?.model).toBe('test-model');
    expect(result?.mappings.map((m) => [m.source_column, m.action, m.target_field])).toEqual([
      ['Email', 'map', 'email'],
      ['Email 2', 'ignore', null],
      ['Loyalty', 'ignore', null],
      ['Notes', 'ignore', null],
      ['Name', 'ignore', null],
      ['Full', 'split', null],
    ]);
    expect(result?.mappings[4]?.split_config).toBeNull();
    expect(result?.mappings[5]?.split_config?.parts.map((p) => p.field)).toEqual(['first_name', 'last_name']);
  });
});
