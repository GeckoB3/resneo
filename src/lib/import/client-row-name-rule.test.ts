import { describe, expect, it } from 'vitest';
import { evaluateClientRowNameRule } from '@/lib/import/client-row-name-rule';

describe('evaluateClientRowNameRule', () => {
  it('passes with both first and last name', () => {
    expect(
      evaluateClientRowNameRule({
        firstName: 'Jane',
        lastName: 'Doe',
        email: null,
        phone: null,
      }),
    ).toEqual({ kind: 'ok' });
  });

  it('blocks rows with no first or last name', () => {
    expect(
      evaluateClientRowNameRule({
        firstName: '',
        lastName: '   ',
        email: 'jane@example.com',
        phone: '+447900111222',
      }),
    ).toEqual({ kind: 'missing_name' });
  });

  it('accepts first-name-only when an email is present', () => {
    expect(
      evaluateClientRowNameRule({
        firstName: 'Jane',
        lastName: null,
        email: 'jane@example.com',
        phone: null,
      }),
    ).toEqual({ kind: 'partial_name_ok' });
  });

  it('accepts last-name-only when a phone is present', () => {
    expect(
      evaluateClientRowNameRule({
        firstName: null,
        lastName: 'Doe',
        email: null,
        phone: '+447900111222',
      }),
    ).toEqual({ kind: 'partial_name_ok' });
  });

  it('blocks single-name rows when neither email nor phone is present', () => {
    expect(
      evaluateClientRowNameRule({
        firstName: 'Jane',
        lastName: '',
        email: '',
        phone: null,
      }),
    ).toEqual({ kind: 'missing_contact' });
  });

  it('treats whitespace-only fields as missing', () => {
    expect(
      evaluateClientRowNameRule({
        firstName: '   ',
        lastName: 'Doe',
        email: '   ',
        phone: '   ',
      }),
    ).toEqual({ kind: 'missing_contact' });
  });
});
