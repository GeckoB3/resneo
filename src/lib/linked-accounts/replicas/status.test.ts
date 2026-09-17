import { describe, expect, it } from 'vitest';
import { hiddenPillVenue, resolveCollectiveServiceStatus, type CollectiveLinkState } from './status';

const link = (over: Partial<CollectiveLinkState> = {}): CollectiveLinkState => ({
  venue_id: 'v1', venue_name: 'Light 3', replica_service_id: 'r1', behind: false, failing: false,
  last_applied_at: '2026-09-16T09:00:00Z', ...over,
});

const input = (over: Partial<Parameters<typeof resolveCollectiveServiceStatus>[0]> = {}) => ({
  role: 'master' as const, paused: false, links: [link()], hiddenReasons: [], ...over,
});

describe('resolveCollectiveServiceStatus', () => {
  it('is up to date when every venue has the current version', () => {
    expect(resolveCollectiveServiceStatus(input())).toEqual({
      status: 'up_to_date', status_reason: null, last_applied_at: '2026-09-16T09:00:00Z',
    });
  });

  it('names the venue that is still setting the service up', () => {
    const r = resolveCollectiveServiceStatus(input({ links: [link({ replica_service_id: null })] }));
    expect(r.status).toBe('setting_up');
    expect(r.status_reason).toContain('Light 3');
  });

  it('says a change is on its way, naming the venues', () => {
    const r = resolveCollectiveServiceStatus(input({
      links: [link({ behind: true }), link({ venue_id: 'v2', venue_name: 'Aura', behind: true })],
    }));
    expect(r.status).toBe('updating');
    expect(r.status_reason).toBe('A change is on its way to Light 3 and Aura.');
  });

  it('puts a failure above ordinary lag, and says it is being retried', () => {
    const r = resolveCollectiveServiceStatus(input({ links: [link({ behind: true, failing: true })] }));
    expect(r.status).toBe('failed');
    expect(r.status_reason).toContain('being retried');
  });

  it('a paused page beats everything else', () => {
    expect(resolveCollectiveServiceStatus(input({ paused: true, links: [link({ failing: true })] })).status).toBe('paused');
  });

  it('explains what guests cannot book, and where', () => {
    const r = resolveCollectiveServiceStatus(input({
      hiddenReasons: [
        { venue_id: 'v1', venue_name: 'Light 3', reason: 'payments' },
        { venue_id: 'v2', venue_name: 'Aura', reason: 'forms' },
      ],
    }));
    expect(r.status).toBe('hidden');
    expect(r.status_reason).toBe(
      'Guests cannot book this at Light 3, because card payments are not set up there. Guests cannot book this at Aura, because forms are switched off there.',
    );
    expect(r.status_reason).not.toContain('\u2014');
  });

  it('joins two reasons at one venue, and names the venue on the pill', () => {
    const reasons = [
      { venue_id: 'v1', venue_name: 'Light 3', reason: 'forms' as const },
      { venue_id: 'v1', venue_name: 'Light 3', reason: 'payments' as const },
    ];
    expect(resolveCollectiveServiceStatus(input({ hiddenReasons: reasons })).status_reason).toBe(
      'Guests cannot book this at Light 3, because card payments are not set up there and forms are switched off there.',
    );
    expect(hiddenPillVenue(reasons)).toBe('Light 3');
    expect(hiddenPillVenue([...reasons, { venue_id: 'v2', venue_name: 'Aura', reason: 'forms' }])).toBeNull();
    expect(hiddenPillVenue([{ venue_id: 'v1', venue_name: 'Light 3', reason: 'staff_only' }])).toBeNull();
  });

  it('keeps the most recent update time across venues', () => {
    const r = resolveCollectiveServiceStatus(input({
      links: [link({ last_applied_at: '2026-09-15T08:00:00Z' }), link({ venue_id: 'v2', venue_name: 'Aura', last_applied_at: '2026-09-16T10:30:00Z' })],
    }));
    expect(r.last_applied_at).toBe('2026-09-16T10:30:00Z');
  });

  it('a service with no members yet is simply up to date', () => {
    expect(resolveCollectiveServiceStatus(input({ links: [] })).status).toBe('up_to_date');
  });
});
