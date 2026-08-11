import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { replaceServiceVariants, type VariantInput } from './service-variants';

/**
 * `replaceServiceVariants` used to delete every row and re-insert. Because
 * `bookings.service_variant_id` is ON DELETE SET NULL, that orphaned the variant
 * pointer on every existing booking of the service each time anyone saved it, and
 * a rejected edit left the service with no options at all. These tests pin the
 * reconcile-in-place behaviour that replaced it.
 */

interface VariantRow {
  id: string;
  venue_id: string;
  service_item_id: string | null;
  appointment_service_id: string | null;
  name: string;
  description: string | null;
  duration_minutes: number;
  buffer_minutes: number;
  price_pence: number | null;
  deposit_pence: number | null;
  sort_order: number;
  is_active: boolean;
  processing_time_blocks: unknown;
  created_at?: string;
}

const VENUE = 'v1';
const PARENT = 'svc-1';

/** Minimal stand-in for the query surface `replaceServiceVariants` uses. */
function fakeAdmin(seed: VariantRow[]) {
  let rows = [...seed];
  let nextId = 1;
  const log: string[] = [];

  function builder(op: 'select' | 'update' | 'delete' | 'insert', payload?: Record<string, unknown>) {
    const filters: Array<(r: VariantRow) => boolean> = [];
    const api: Record<string, unknown> = {
      eq(col: string, val: unknown) {
        filters.push((r) => (r as unknown as Record<string, unknown>)[col] === val);
        return api;
      },
      in(col: string, vals: unknown[]) {
        filters.push((r) => vals.includes((r as unknown as Record<string, unknown>)[col]));
        return api;
      },
      order() {
        return api;
      },
      then(resolve: (v: { data: unknown; error: null }) => unknown) {
        const match = (r: VariantRow) => filters.every((f) => f(r));
        if (op === 'select') return resolve({ data: rows.filter(match), error: null });
        if (op === 'update') {
          rows = rows.map((r) => (match(r) ? ({ ...r, ...payload } as VariantRow) : r));
          return resolve({ data: null, error: null });
        }
        if (op === 'delete') {
          rows = rows.filter((r) => !match(r));
          return resolve({ data: null, error: null });
        }
        return resolve({ data: null, error: null });
      },
    };
    return api;
  }

  const admin = {
    from() {
      return {
        select() {
          log.push('select');
          return builder('select');
        },
        update(payload: Record<string, unknown>) {
          log.push('update');
          return builder('update', payload);
        },
        delete() {
          log.push('delete');
          return builder('delete');
        },
        insert(payload: Record<string, unknown>[]) {
          log.push('insert');
          for (const p of payload) {
            rows.push({ id: `new-${nextId++}`, ...(p as unknown as Omit<VariantRow, 'id'>) });
          }
          return builder('insert');
        },
      };
    },
  } as unknown as SupabaseClient;

  return { admin, rows: () => rows, log: () => log };
}

function variantRow(over: Partial<VariantRow> = {}): VariantRow {
  return {
    id: 'var-a',
    venue_id: VENUE,
    service_item_id: PARENT,
    appointment_service_id: null,
    name: 'Roots',
    description: null,
    duration_minutes: 60,
    buffer_minutes: 0,
    price_pence: 4500,
    deposit_pence: null,
    sort_order: 0,
    is_active: true,
    processing_time_blocks: [],
    ...over,
  };
}

function input(over: Partial<VariantInput> = {}): VariantInput {
  return { name: 'Roots', duration_minutes: 60, ...over } as VariantInput;
}

async function run(seed: VariantRow[], variants: VariantInput[]) {
  const f = fakeAdmin(seed);
  const res = await replaceServiceVariants({
    admin: f.admin,
    venueId: VENUE,
    parent: { kind: 'service_item', service_item_id: PARENT },
    variants,
  });
  return { res, rows: f.rows(), log: f.log() };
}

describe('replaceServiceVariants', () => {
  it('keeps the id of a variant that is still present, so bookings keep pointing at it', async () => {
    const seed = [variantRow({ id: 'var-a' }), variantRow({ id: 'var-b', name: 'Full head', sort_order: 1 })];
    const { res, rows } = await run(seed, [
      input({ id: 'var-a', name: 'Roots' }),
      input({ id: 'var-b', name: 'Full head', duration_minutes: 120 }),
    ]);

    expect(res.ok).toBe(true);
    expect(rows.map((r) => r.id).sort()).toEqual(['var-a', 'var-b']);
  });

  it('applies edits in place rather than through a new row', async () => {
    const { rows } = await run(
      [variantRow({ id: 'var-a' })],
      [input({ id: 'var-a', name: 'Roots retouch', duration_minutes: 75, price_pence: 5000 })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe('var-a');
    expect(rows[0]!.name).toBe('Roots retouch');
    expect(rows[0]!.duration_minutes).toBe(75);
  });

  it('inserts a genuinely new option without disturbing existing ids', async () => {
    const { rows } = await run(
      [variantRow({ id: 'var-a' })],
      [input({ id: 'var-a' }), input({ name: 'Balayage', duration_minutes: 180 })],
    );
    expect(rows).toHaveLength(2);
    expect(rows.some((r) => r.id === 'var-a')).toBe(true);
    expect(rows.some((r) => r.name === 'Balayage')).toBe(true);
  });

  it('removes only the options the request dropped', async () => {
    const seed = [variantRow({ id: 'var-a' }), variantRow({ id: 'var-b', name: 'Full head' })];
    const { rows } = await run(seed, [input({ id: 'var-a' })]);
    expect(rows.map((r) => r.id)).toEqual(['var-a']);
  });

  it('ignores an id that does not belong to this parent instead of reusing it', async () => {
    const { rows } = await run([variantRow({ id: 'var-a' })], [input({ id: 'someone-elses-id' })]);
    // The unknown id becomes a fresh row; var-a is dropped as absent from the request.
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).not.toBe('someone-elses-id');
    expect(rows[0]!.id).not.toBe('var-a');
  });

  it('leaves existing variants untouched when an edit is rejected', async () => {
    // Regression: the delete used to be committed before validation ran, so a
    // rejected edit returned an error AND wiped every option off the service.
    const seed = [variantRow({ id: 'var-a' }), variantRow({ id: 'var-b', name: 'Full head' })];
    const { res, rows, log } = await run(seed, [
      input({ id: 'var-a' }),
      input({
        id: 'var-b',
        name: 'Full head',
        duration_minutes: 60,
        processing_time_blocks: [{ start_minute: 40, duration_minutes: 50 }],
      } as Partial<VariantInput>),
    ]);

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.invalid).toBe(true);
      expect(res.error).toContain('Full head');
    }
    expect(rows).toHaveLength(2);
    expect(log).not.toContain('delete');
    expect(log).not.toContain('update');
  });

  it('clears every option when the request genuinely asks for none', async () => {
    const { res, rows } = await run([variantRow({ id: 'var-a' })], []);
    expect(res.ok).toBe(true);
    expect(rows).toEqual([]);
  });
});
