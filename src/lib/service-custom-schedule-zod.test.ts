import { describe, it, expect } from 'vitest';
import { z } from 'zod';

import { customWorkingHoursRequestSchema } from '@/lib/service-custom-schedule-zod';

/**
 * `custom_working_hours` on a service create/update request.
 *
 * Reported from the mobile app: opening a service and pressing Save answered
 * "Invalid request - custom working hours: Invalid input", whatever had been
 * edited. The field was `.nullable()` but not `.optional()`, so zod treated it
 * as REQUIRED and failed the whole payload whenever the caller left the
 * availability section alone. The dashboard always assigns the key for an admin,
 * which is why it never surfaced there.
 *
 * The three states have to stay distinguishable: omitted = don't touch,
 * null = clear, object = replace.
 */

/** The field as the route composes it — inside an object, alongside others. */
const payloadSchema = z.object({
  name: z.string().optional(),
  custom_working_hours: customWorkingHoursRequestSchema,
});

const weekly = {
  version: 2 as const,
  rules: [{ id: 'r1', kind: 'weekly' as const, windows: { '1': [{ start: '09:00', end: '17:00' }] } }],
};

describe('customWorkingHoursRequestSchema', () => {
  it('accepts a payload that omits it — the edit is about something else', () => {
    const res = payloadSchema.safeParse({ name: 'Fringe trim' });
    expect(res.success).toBe(true);
    // Omitted must stay distinguishable from null, or the route cannot tell
    // "leave the schedule alone" from "clear it".
    expect(res.success && res.data.custom_working_hours).toBeUndefined();
  });

  it('accepts null — the caller is clearing the schedule', () => {
    const res = payloadSchema.safeParse({ custom_working_hours: null });
    expect(res.success).toBe(true);
    expect(res.success && res.data.custom_working_hours).toBeNull();
  });

  it('accepts a v2 schedule', () => {
    expect(payloadSchema.safeParse({ custom_working_hours: weekly }).success).toBe(true);
  });

  it('accepts the legacy day-keyed map', () => {
    expect(
      payloadSchema.safeParse({
        custom_working_hours: { '1': [{ start: '09:00', end: '17:00' }] },
      }).success,
    ).toBe(true);
  });

  it('still rejects a malformed schedule rather than waving everything through', () => {
    // Optional must not have loosened the actual validation.
    for (const bad of [
      { version: 2, rules: [{ id: 'r1', kind: 'weekly', windows: { '1': [{ start: '9:00', end: '17:00' }] } }] },
      { version: 2, rules: [{ id: '', kind: 'weekly', windows: { '1': [{ start: '09:00', end: '17:00' }] } }] },
      { version: 3, rules: [] },
      { '1': [{ start: '17:00', end: '09:00' }] },
      'not an object',
      42,
    ]) {
      expect(
        payloadSchema.safeParse({ custom_working_hours: bad }).success,
        `expected ${JSON.stringify(bad)} to be rejected`,
      ).toBe(false);
    }
  });
});
