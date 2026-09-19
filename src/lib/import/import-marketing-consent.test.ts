import { describe, expect, it } from 'vitest';
import {
  IMPORT_MARKETING_CHANGE_KEY,
  fileMarketingAnswer,
  guestHasMarketingChoiceOnRecord,
  marketingForNewImportedGuest,
  marketingRestoreForUndo,
  marketingUpdateForExistingGuest,
  marketingUpdateNeedsHistory,
  readMarketingAnswer,
  undoNeedsCurrentMarketing,
} from './import-marketing-consent';
import { makeRecordingDb } from '@/lib/testing/recording-supabase';

const NOW = '2026-09-19T10:00:00.000Z';

describe('readMarketingAnswer', () => {
  it('reads a consent column', () => {
    for (const v of ['Yes', 'Y', 'TRUE', '1', 'x', 'Opted in', 'opt-in', 'Subscribed', 'Accepted']) {
      expect(readMarketingAnswer(v, 'consent')).toBe('consent');
    }
    for (const v of ['No', 'n', 'false', '0', 'None', 'Opted out', 'Opt-Out', 'Unsubscribed', 'Declined', 'Do not contact']) {
      expect(readMarketingAnswer(v, 'consent')).toBe('opt_out');
    }
  });

  it('reads an opt-out column the other way round, except for answers that name themselves', () => {
    for (const v of ['Yes', 'true', '1', 'Opted out', 'Unsubscribed']) {
      expect(readMarketingAnswer(v, 'opt_out')).toBe('opt_out');
    }
    for (const v of ['No', 'false', '0', 'None', 'Subscribed', 'Opted in']) {
      expect(readMarketingAnswer(v, 'opt_out')).toBe('consent');
    }
  });

  it('treats a blank or unreadable answer as saying nothing', () => {
    for (const v of [undefined, null, '', '   ', 'N/A', 'Email only', 'Unknown']) {
      expect(readMarketingAnswer(v, 'consent')).toBeNull();
      expect(readMarketingAnswer(v, 'opt_out')).toBeNull();
    }
  });
});

describe('fileMarketingAnswer', () => {
  it('says nothing when the row says nothing', () => {
    expect(fileMarketingAnswer({})).toBeNull();
    expect(fileMarketingAnswer({ marketing_consent: '', email_marketing_consent: ' ' })).toBeNull();
  });

  it('lets any no win, from any marketing column', () => {
    expect(fileMarketingAnswer({ marketing_consent: 'Yes' })).toBe('consent');
    expect(fileMarketingAnswer({ marketing_consent: 'No' })).toBe('opt_out');
    expect(fileMarketingAnswer({ marketing_opt_out: 'Yes' })).toBe('opt_out');
    expect(fileMarketingAnswer({ email_marketing_consent: 'true', sms_marketing_consent: '' })).toBe('consent');
    // One marketing switch covers every channel, so a no to texts is a no.
    expect(fileMarketingAnswer({ email_marketing_consent: 'true', sms_marketing_consent: 'false' })).toBe('opt_out');
    expect(fileMarketingAnswer({ marketing_consent: 'Yes', marketing_opt_out: 'Yes' })).toBe('opt_out');
  });
});

describe('marketingForNewImportedGuest', () => {
  it('assumes consent, dated at the import, unless the file opted them out', () => {
    expect(marketingForNewImportedGuest(null, NOW)).toEqual({
      marketing_consent: true,
      marketing_consent_at: NOW,
      marketing_opt_out: false,
    });
    expect(marketingForNewImportedGuest('consent', NOW)).toEqual(marketingForNewImportedGuest(null, NOW));
    expect(marketingForNewImportedGuest('opt_out', NOW)).toEqual({
      marketing_consent: false,
      marketing_consent_at: null,
      marketing_opt_out: true,
    });
  });
});

describe('marketingUpdateForExistingGuest', () => {
  const never = { marketing_consent: false, marketing_opt_out: false };
  const consented = { marketing_consent: true, marketing_opt_out: false };
  const optedOut = { marketing_consent: false, marketing_opt_out: true };
  const consentGiven = { marketing_consent: true, marketing_consent_at: NOW, marketing_opt_out: false };
  const optOut = { marketing_consent: false, marketing_consent_at: null, marketing_opt_out: true };

  it('gives a contact who never chose the same default as a new one', () => {
    expect(marketingUpdateForExistingGuest(never, null, { hasRecordedChoice: false, nowIso: NOW })).toEqual(consentGiven);
    expect(marketingUpdateForExistingGuest(never, 'consent', { hasRecordedChoice: false, nowIso: NOW })).toEqual(
      consentGiven,
    );
  });

  it('never re-subscribes a contact who opted out, and never overrides a choice on record', () => {
    expect(marketingUpdateForExistingGuest(optedOut, 'consent', { hasRecordedChoice: true, nowIso: NOW })).toEqual({});
    expect(marketingUpdateForExistingGuest(optedOut, null, { hasRecordedChoice: false, nowIso: NOW })).toEqual({});
    expect(marketingUpdateForExistingGuest(never, 'consent', { hasRecordedChoice: true, nowIso: NOW })).toEqual({});
    expect(marketingUpdateForExistingGuest(consented, null, { hasRecordedChoice: true, nowIso: NOW })).toEqual({});
  });

  it('applies an opt-out from the file, however the contact stood', () => {
    expect(marketingUpdateForExistingGuest(consented, 'opt_out', { hasRecordedChoice: true, nowIso: NOW })).toEqual(
      optOut,
    );
    expect(marketingUpdateForExistingGuest(never, 'opt_out', { hasRecordedChoice: false, nowIso: NOW })).toEqual(optOut);
    expect(marketingUpdateForExistingGuest(optedOut, 'opt_out', { hasRecordedChoice: true, nowIso: NOW })).toEqual({});
  });

  it('only asks for the history when it could change the answer', () => {
    expect(marketingUpdateNeedsHistory(never, null)).toBe(true);
    expect(marketingUpdateNeedsHistory(never, 'consent')).toBe(true);
    expect(marketingUpdateNeedsHistory(never, 'opt_out')).toBe(false);
    expect(marketingUpdateNeedsHistory(consented, null)).toBe(false);
    expect(marketingUpdateNeedsHistory(optedOut, 'consent')).toBe(false);
  });
});

describe('marketingRestoreForUndo', () => {
  const before = { marketing_consent: false, marketing_consent_at: null, marketing_opt_out: false };
  const change = { marketing_consent: true, marketing_consent_at: NOW, marketing_opt_out: false };

  it('restores the opt-out, as undo always did, for records from before the change was kept', () => {
    expect(marketingRestoreForUndo({ marketing_opt_out: true }, null)).toEqual({ marketing_opt_out: true });
    expect(undoNeedsCurrentMarketing({ marketing_opt_out: true })).toBe(false);
  });

  it('leaves marketing alone when the import did not change it', () => {
    const previous = { ...before, [IMPORT_MARKETING_CHANGE_KEY]: {} };
    expect(undoNeedsCurrentMarketing(previous)).toBe(false);
    expect(marketingRestoreForUndo(previous, null)).toEqual({});
  });

  it('puts back what was there while the contact still reads as the import left them', () => {
    const previous = { ...before, [IMPORT_MARKETING_CHANGE_KEY]: change };
    expect(undoNeedsCurrentMarketing(previous)).toBe(true);
    expect(marketingRestoreForUndo(previous, { marketing_consent: true, marketing_opt_out: false })).toEqual(before);
  });

  it('keeps an unsubscribe or staff change made after the import', () => {
    const previous = { ...before, [IMPORT_MARKETING_CHANGE_KEY]: change };
    expect(marketingRestoreForUndo(previous, { marketing_consent: false, marketing_opt_out: true })).toEqual({});
    expect(marketingRestoreForUndo(previous, null)).toEqual({});
  });
});

describe('guestHasMarketingChoiceOnRecord', () => {
  it('reads the consent log, and fails safe', async () => {
    const withRow = makeRecordingDb(() => ({ data: [{ id: 'e1' }] }));
    expect(await guestHasMarketingChoiceOnRecord(withRow.db, 'v1', 'g1')).toBe(true);
    expect(withRow.calls[0]!.table).toBe('guest_marketing_consent_events');
    expect(withRow.calls[0]!.filters).toContainEqual(['eq', 'guest_id', 'g1']);

    const empty = makeRecordingDb(() => ({ data: [] }));
    expect(await guestHasMarketingChoiceOnRecord(empty.db, 'v1', 'g1')).toBe(false);

    const failing = makeRecordingDb(() => ({ error: { message: 'boom' } }));
    expect(await guestHasMarketingChoiceOnRecord(failing.db, 'v1', 'g1')).toBe(true);
  });
});
