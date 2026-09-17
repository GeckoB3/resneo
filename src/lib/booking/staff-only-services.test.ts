import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isStaffBookingSource, isServiceStaffOnly, loadStaffOnlyServiceIds } from './staff-only-services';

function admin(rows: { id: string }[] | null, error?: { message: string }) {
  const eq = vi.fn(() => Promise.resolve({ data: rows, error: error ?? null }));
  const inFn = vi.fn(() => ({ eq }));
  const select = vi.fn(() => ({ in: inFn }));
  const from = vi.fn(() => ({ select }));
  return { client: { from } as unknown as SupabaseClient, from, select, in: inFn, eq };
}

describe('staff bookings only', () => {
  it('asks only about the ids given, and once', async () => {
    const a = admin([{ id: 's2' }]);
    expect(await loadStaffOnlyServiceIds(a.client, ['s1', 's2', 's1'])).toEqual(new Set(['s2']));
    expect(a.from).toHaveBeenCalledWith('service_items');
    expect(a.in).toHaveBeenCalledWith('id', ['s1', 's2']);
    expect(a.eq).toHaveBeenCalledWith('is_bookable_online', false);
  });

  it('reads nothing for an empty list', async () => {
    const a = admin([]);
    expect(await loadStaffOnlyServiceIds(a.client, [])).toEqual(new Set());
    expect(a.from).not.toHaveBeenCalled();
  });

  it('fails open when the lookup errors', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = admin(null, { message: 'boom' });
    expect(await loadStaffOnlyServiceIds(a.client, ['s1'])).toEqual(new Set());
    expect(await isServiceStaffOnly(a.client, 's1')).toBe(false);
    err.mockRestore();
  });

  it('treats phone and walk-in as staff sources', () => {
    expect(['phone', 'walk-in'].every(isStaffBookingSource)).toBe(true);
    expect(['online', 'widget', 'booking_page', null, undefined].some(isStaffBookingSource)).toBe(false);
  });
});

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('the flag is honoured where the plan says (§6.6)', () => {
  it('the catalogue lists staff-only services only for a staff audience', () => {
    const src = read('src/lib/availability/appointment-catalog.ts');
    expect(src).toMatch(/options\?\.audience === 'staff' \|\| row\.is_bookable_online !== false/);
    expect(read('src/app/api/booking/appointment-catalog/route.ts')).toMatch(
      /audience: includeHiddenAddons \? 'staff' : 'public'/,
    );
  });

  it.each([
    'src/app/api/booking/availability/route.ts',
    'src/app/api/booking/appointment-calendar/route.ts',
  ])('%s gives a guest no slots for a staff-only service', (rel) => {
    expect(read(rel)).toContain('loadStaffOnlyServiceIds');
  });

  it.each([
    'src/app/api/booking/create/route.ts',
    'src/app/api/booking/create-group/route.ts',
    'src/app/api/booking/create-multi-service/route.ts',
  ])('%s refuses a guest-source booking for one', (rel) => {
    const src = read(rel);
    expect(src).toContain('isStaffBookingSource(source)');
    expect(src).toContain("'SERVICE_NOT_BOOKABLE_ONLINE'");
  });
});
