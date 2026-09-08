import { describe, it, expect } from 'vitest';
import { bookingMoveFootprintMinutes } from './booking-move-footprint';

describe('bookingMoveFootprintMinutes', () => {
  it('is the bar itself for a plain booking', () => {
    expect(
      bookingMoveFootprintMinutes([
        { offsetMinutes: 0, displayMinutes: 30, coreMinutes: 30, tailMinutes: 0, bufferMinutes: 0 },
      ]),
    ).toBe(30);
  });

  it('reaches the foot of the buffer band drawn under a booking', () => {
    expect(
      bookingMoveFootprintMinutes([
        { offsetMinutes: 0, displayMinutes: 30, coreMinutes: 30, tailMinutes: 0, bufferMinutes: 10 },
      ]),
    ).toBe(40);
  });

  /**
   * The reported case: a 30 minute service with a 30 minute wait after it,
   * then a Blow Dry. The bar spans 10:30 to 12:00, so the outline must too.
   */
  it('spans every service of a visit, the wait between them included', () => {
    expect(
      bookingMoveFootprintMinutes([
        { offsetMinutes: 0, displayMinutes: 30, coreMinutes: 30, tailMinutes: 30, bufferMinutes: 0 },
        { offsetMinutes: 60, displayMinutes: 30, coreMinutes: 30, tailMinutes: 0, bufferMinutes: 0 },
      ]),
    ).toBe(90);
  });

  it('adds the last service\'s buffer band to a visit', () => {
    expect(
      bookingMoveFootprintMinutes([
        { offsetMinutes: 0, displayMinutes: 30, coreMinutes: 30, tailMinutes: 30, bufferMinutes: 0 },
        { offsetMinutes: 60, displayMinutes: 30, coreMinutes: 30, tailMinutes: 0, bufferMinutes: 15 },
      ]),
    ).toBe(105);
  });

  it('never shrinks below what the bar draws when the reach is shorter', () => {
    // A bar painted from a catalogue span (no end time) can be longer than its core.
    expect(
      bookingMoveFootprintMinutes([
        { offsetMinutes: 0, displayMinutes: 45, coreMinutes: 30, tailMinutes: 0, bufferMinutes: 0 },
      ]),
    ).toBe(45);
  });
});
