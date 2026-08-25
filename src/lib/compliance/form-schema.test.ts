import { describe, expect, it } from 'vitest';
import {
  computeExpiresAt,
  computeResult,
  parseFormSchema,
  validateFormSchemaForType,
  validateResponses,
  type ComplianceFormSchema,
} from '@/lib/compliance/form-schema';

const passFailSchema: ComplianceFormSchema = {
  schema_version: '1.0',
  title: 'Patch Test',
  fields: [
    { id: 'f_allergies', type: 'textarea', label: 'Allergies', required: true, staff_only: false },
    {
      id: 'f_result',
      type: 'select',
      label: 'Result',
      required: true,
      staff_only: true,
      options: [
        { value: 'pass', label: 'Pass' },
        { value: 'fail', label: 'Fail' },
        { value: 'inconclusive', label: 'Inconclusive' },
      ],
    },
    { id: 'f_sig', type: 'signature', label: 'Signature', required: true, staff_only: false },
  ],
  result_mapping: { field: 'f_result', pass_values: ['pass'], fail_values: ['fail', 'inconclusive'] },
};

describe('parseFormSchema', () => {
  it('accepts a valid schema and defaults schema_version', () => {
    const r = parseFormSchema({ title: 'T', fields: [{ id: 'a', type: 'text', label: 'A' }] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.schema.schema_version).toBe('1.0');
  });

  it('rejects a schema with no fields', () => {
    expect(parseFormSchema({ title: 'T', fields: [] }).ok).toBe(false);
  });

  it('rejects an invalid field id', () => {
    expect(parseFormSchema({ title: 'T', fields: [{ id: 'bad id!', type: 'text', label: 'A' }] }).ok).toBe(false);
  });

  it('rejects a select with no options', () => {
    expect(
      parseFormSchema({ title: 'T', fields: [{ id: 'a', type: 'select', label: 'A', options: [] }] }).ok,
    ).toBe(false);
  });
});

describe('validateFormSchemaForType', () => {
  it('passes a well-formed pass_fail schema', () => {
    expect(validateFormSchemaForType(passFailSchema, 'pass_fail')).toEqual({ ok: true, errors: [] });
  });

  it('flags duplicate field ids', () => {
    const dup: ComplianceFormSchema = {
      schema_version: '1.0',
      title: 'T',
      fields: [
        { id: 'a', type: 'text', label: 'A', required: false, staff_only: false },
        { id: 'a', type: 'text', label: 'B', required: false, staff_only: false },
      ],
    };
    const r = validateFormSchemaForType(dup, 'completed');
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('Duplicate field id'))).toBe(true);
  });

  it('requires a staff_only select result field for pass_fail', () => {
    const noResult: ComplianceFormSchema = {
      schema_version: '1.0',
      title: 'T',
      fields: [{ id: 'a', type: 'text', label: 'A', required: false, staff_only: false }],
      result_mapping: { field: 'a', pass_values: ['x'], fail_values: ['y'] },
    };
    const r = validateFormSchemaForType(noResult, 'pass_fail');
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('must be a select field'))).toBe(true);
  });

  it('requires the pass/fail result field to be marked required (audit M7)', () => {
    const optionalResult: ComplianceFormSchema = {
      ...passFailSchema,
      fields: passFailSchema.fields.map((f) => (f.id === 'f_result' ? { ...f, required: false } : f)),
    };
    const r = validateFormSchemaForType(optionalResult, 'pass_fail');
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('must be marked required'))).toBe(true);
  });

  it('flags result_mapping values missing from options', () => {
    const schema: ComplianceFormSchema = {
      ...passFailSchema,
      result_mapping: { field: 'f_result', pass_values: ['pass'], fail_values: ['nope'] },
    };
    const r = validateFormSchemaForType(schema, 'pass_fail');
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('not present in the result field options'))).toBe(true);
  });

  it('rejects two signature fields', () => {
    const schema: ComplianceFormSchema = {
      schema_version: '1.0',
      title: 'T',
      fields: [
        { id: 's1', type: 'signature', label: 'S1', required: true, staff_only: false },
        { id: 's2', type: 'signature', label: 'S2', required: true, staff_only: false },
      ],
    };
    const r = validateFormSchemaForType(schema, 'signed');
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('at most one signature'))).toBe(true);
  });

  it('requires a signature field for result_type signed', () => {
    const schema: ComplianceFormSchema = {
      schema_version: '1.0',
      title: 'T',
      fields: [{ id: 'a', type: 'text', label: 'A', required: false, staff_only: false }],
    };
    expect(validateFormSchemaForType(schema, 'signed').ok).toBe(false);
  });
});

describe('validateResponses', () => {
  it('accepts valid staff responses including staff_only fields', () => {
    const r = validateResponses(
      passFailSchema,
      {
        f_allergies: 'None',
        f_result: 'pass',
        f_sig: { method: 'typed', data: 'Jane Doe', signed_at: '2026-05-14T10:00:00Z' },
      },
      'staff',
    );
    expect(r.ok).toBe(true);
  });

  it('strips staff_only fields in public mode', () => {
    const r = validateResponses(
      passFailSchema,
      {
        f_allergies: 'None',
        f_result: 'pass', // staff_only — should be stripped, not error
        f_sig: { method: 'drawn', storage_path: 'venues/x/sig.png', signed_at: '2026-05-14T10:00:00Z' },
      },
      'public',
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).not.toHaveProperty('f_result');
  });

  it('errors when a required field is missing', () => {
    const r = validateResponses(passFailSchema, { f_result: 'pass' }, 'staff');
    expect(r.ok).toBe(false);
    expect(r.errors?.f_allergies).toBeTruthy();
  });

  it('rejects a select value outside the options', () => {
    const r = validateResponses(
      passFailSchema,
      {
        f_allergies: 'None',
        f_result: 'banana',
        f_sig: { method: 'typed', data: 'X', signed_at: 'now' },
      },
      'staff',
    );
    expect(r.ok).toBe(false);
    expect(r.errors?.f_result).toBeTruthy();
  });

  it('rejects a signature with neither data nor storage_path', () => {
    const r = validateResponses(
      passFailSchema,
      { f_allergies: 'None', f_result: 'pass', f_sig: { method: 'drawn', signed_at: 'now' } },
      'staff',
    );
    expect(r.ok).toBe(false);
  });
});

describe('computeResult', () => {
  it('maps pass/fail/inconclusive correctly', () => {
    expect(computeResult(passFailSchema, { f_result: 'pass' }, 'pass_fail')).toBe('pass');
    expect(computeResult(passFailSchema, { f_result: 'fail' }, 'pass_fail')).toBe('fail');
    expect(computeResult(passFailSchema, { f_result: 'inconclusive' }, 'pass_fail')).toBe('fail');
  });

  it('returns null when the result field is absent (e.g. client submission)', () => {
    expect(computeResult(passFailSchema, {}, 'pass_fail')).toBeNull();
  });

  it('returns signed/completed for those result types', () => {
    expect(computeResult(passFailSchema, {}, 'signed')).toBe('signed');
    expect(computeResult(passFailSchema, {}, 'completed')).toBe('completed');
    expect(computeResult(passFailSchema, {}, 'file_uploaded')).toBe('completed');
  });
});

describe('computeExpiresAt', () => {
  const captured = new Date('2026-05-14T12:00:00Z');
  it('null validity = lifetime (null)', () => {
    expect(computeExpiresAt(null, captured)).toBeNull();
  });
  it('0 validity with no known appointment = end of the capture day in venue local time', () => {
    // captured 2026-05-14T12:00Z; Europe/London (default) is BST (UTC+1), so the local day
    // ends at 2026-05-15T00:00 BST = 2026-05-14T23:00Z, i.e. 22:59:59.999Z.
    expect(computeExpiresAt(0, captured)?.toISOString()).toBe('2026-05-14T22:59:59.999Z');
    // An explicit UTC venue ends the day at 23:59:59.999Z.
    expect(computeExpiresAt(0, captured, 'UTC')?.toISOString()).toBe('2026-05-14T23:59:59.999Z');
  });
  it('positive validity = captured + N days', () => {
    expect(computeExpiresAt(180, captured)?.toISOString()).toBe('2026-11-10T12:00:00.000Z');
  });
});

describe('computeExpiresAt — per-visit records anchored to the appointment', () => {
  // The bug this covers: a per-visit form completed ahead of the appointment (inline at
  // booking, or from the confirmation link) expired the same night, so it never satisfied
  // the requirement on the day. Expiry now runs to the end of the VISIT day.
  const captured = new Date('2026-05-14T12:00:00Z');

  it('runs to the end of the appointment day, not the capture day', () => {
    // Completed 4 days early; the appointment day (BST) ends at 2026-05-18T22:59:59.999Z.
    expect(computeExpiresAt(0, captured, 'Europe/London', '2026-05-18')?.toISOString()).toBe(
      '2026-05-18T22:59:59.999Z',
    );
  });

  it('uses the offset in force on the appointment day, not on the capture day', () => {

    // Captured in BST (UTC+1), appointment in GMT (UTC+0) after the October change.
    expect(computeExpiresAt(0, captured, 'Europe/London', '2026-11-05')?.toISOString()).toBe(
      '2026-11-05T23:59:59.999Z',
    );
  });

  it('never expires earlier than the end of the capture day', () => {
    // A past appointment date (a late capture, or a booking already moved) must not mint an
    // already-expired record: it still covers the rest of the day it was completed on.
    expect(computeExpiresAt(0, captured, 'Europe/London', '2026-05-01')?.toISOString()).toBe(
      '2026-05-14T22:59:59.999Z',
    );
  });

  it('matches the capture-day fallback when the appointment is the same day', () => {
    expect(computeExpiresAt(0, captured, 'Europe/London', '2026-05-14')?.toISOString()).toBe(
      '2026-05-14T22:59:59.999Z',
    );
  });

  it('falls back to the capture day for a malformed or missing visit date', () => {
    const fallback = '2026-05-14T22:59:59.999Z';
    expect(computeExpiresAt(0, captured, 'Europe/London', '14/05/2026')?.toISOString()).toBe(fallback);
    expect(computeExpiresAt(0, captured, 'Europe/London', '')?.toISOString()).toBe(fallback);
    expect(computeExpiresAt(0, captured, 'Europe/London', null)?.toISOString()).toBe(fallback);
  });

  it('ignores the visit date for lifetime and fixed-period types', () => {
    expect(computeExpiresAt(null, captured, 'Europe/London', '2026-05-18')).toBeNull();
    expect(computeExpiresAt(180, captured, 'Europe/London', '2026-05-18')?.toISOString()).toBe(
      '2026-11-10T12:00:00.000Z',
    );
  });
});

