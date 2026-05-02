import { describe, expect, it } from 'vitest';
import { validateAndCoerceCustomFields, mergeCustomFieldsJson } from '@/lib/guests/custom-field-validation';
import type { CustomClientFieldDefinition } from '@/types/contacts';

const defs: CustomClientFieldDefinition[] = [
  {
    id: '1',
    venue_id: 'v',
    field_name: 'Notes',
    field_key: 'notes',
    field_type: 'text',
    is_active: true,
    created_at: '',
  },
  {
    id: '2',
    venue_id: 'v',
    field_name: 'Score',
    field_key: 'score',
    field_type: 'number',
    is_active: true,
    created_at: '',
  },
];

describe('validateAndCoerceCustomFields', () => {
  it('rejects unknown keys', () => {
    const r = validateAndCoerceCustomFields({ other: 'x' }, defs);
    expect(r.ok).toBe(false);
  });

  it('coerces number and text', () => {
    const r = validateAndCoerceCustomFields({ notes: ' hello ', score: '12' }, defs);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.notes).toBe('hello');
      expect(r.value.score).toBe(12);
    }
  });
});

describe('mergeCustomFieldsJson', () => {
  it('merges shallowly', () => {
    expect(mergeCustomFieldsJson({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
  });
});
