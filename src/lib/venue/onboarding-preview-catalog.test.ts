import { describe, expect, it } from 'vitest';
import { resolvePreviewCatalogState } from './onboarding-preview-catalog';

describe('resolvePreviewCatalogState', () => {
  it('claims nothing while the status is unknown', () => {
    // Null covers both "still loading" and "the fetch failed": in either case the
    // screen must not assert that a catalogue exists.
    expect(resolvePreviewCatalogState(null)).toEqual({ kind: 'unknown' });
  });

  it('reports ready when the server confirms guests can book', () => {
    expect(
      resolvePreviewCatalogState({ bookingReady: true, bookingModel: 'unified_scheduling' }),
    ).toEqual({ kind: 'ready' });
  });

  it('names what is missing per booking model', () => {
    const cases = [
      ['unified_scheduling', 'service', '/dashboard/appointment-services'],
      ['practitioner_appointment', 'service', '/dashboard/appointment-services'],
      ['class_session', 'class', '/dashboard/class-timetable'],
      ['event_ticket', 'event', '/dashboard/event-manager'],
      ['resource_booking', 'resource', '/dashboard/resource-timeline'],
    ] as const;
    for (const [bookingModel, noun, href] of cases) {
      expect(resolvePreviewCatalogState({ bookingReady: false, bookingModel })).toMatchObject({
        kind: 'missing',
        noun,
        href,
      });
    }
  });

  it('stays neutral for a model with no catalogue copy rather than guessing', () => {
    // Restaurants set service periods during onboarding, so they should never land
    // here; if they somehow do, say nothing instead of naming the wrong thing.
    expect(
      resolvePreviewCatalogState({ bookingReady: false, bookingModel: 'table_reservation' }),
    ).toEqual({ kind: 'unknown' });
  });

  it('never reports ready purely because the model is unmapped', () => {
    const state = resolvePreviewCatalogState({
      bookingReady: false,
      bookingModel: 'table_reservation',
    });
    expect(state.kind).not.toBe('ready');
  });
});
