import { describe, expect, it } from 'vitest';
import { staffNoteForExclusion } from './collective-venue';
import type { ProviderExclusion } from './replicas/derived-catalogue';

/**
 * §6.6: a calendar a guest cannot book right now stays in the staff catalogue with a note saying
 * why, so staff can still take the booking and know what to do about payment or forms.
 */
const REASONS: ProviderExclusion[] = ['payments', 'forms', 'behind', 'suspended', 'staff_only'];

describe('staff notes for calendars guests cannot book', () => {
  it.each(REASONS)('%s reads as a plain sentence naming the venue where it matters', (reason) => {
    const note = staffNoteForExclusion(reason, 'Light 3');
    expect(note.length).toBeGreaterThan(20);
    expect(note.endsWith('.')).toBe(true);
    expect(note).not.toContain('\u2014');
    if (reason !== 'staff_only') expect(note).toContain('Light 3');
  });

  it('says what to do about payment', () => {
    expect(staffNoteForExclusion('payments', 'Light 3')).toBe(
      'Card payments are not set up at Light 3, so take payment in person.',
    );
  });
});
