import { describe, it, expect } from 'vitest';
import { bookingMoveFootprintMinutes } from './booking-move-footprint';

describe('bookingMoveFootprintMinutes', () => {
  it('is the bar itself for a plain booking', () => {
    expect(
      bookingMoveFootprintMinutes([
        { offsetMinutes: 0, displayMinutes: 30, coreMinutes: 30, activeMinutes: 30, tailMinutes: 0, bufferMinutes: 0 },
      ]),
    ).toBe(30);
  });

  it('reaches the foot of the buffer band drawn directly under a booking', () => {
    expect(
      bookingMoveFootprintMinutes([
        { offsetMinutes: 0, displayMinutes: 30, coreMinutes: 30, activeMinutes: 30, tailMinutes: 0, bufferMinutes: 10 },
      ]),
    ).toBe(40);
  });

  /**
   * The reported case: a 3 hour Balayage row (an older copy at a linked venue)
   * whose last hour is developing time. The card is cut at 2 hours, so the
   * green box must stop there too.
   */
  it('stops where the card is cut when processing runs into the end of the service', () => {
    expect(
      bookingMoveFootprintMinutes([
        { offsetMinutes: 0, displayMinutes: 180, coreMinutes: 180, activeMinutes: 120, tailMinutes: 0, bufferMinutes: 0 },
      ]),
    ).toBe(120);
  });

  it('leaves out processing that runs on past the service, and the band after it', () => {
    // Canonical shape: 2 hour service, 1 hour tail, 15 minute buffer after that.
    expect(
      bookingMoveFootprintMinutes([
        { offsetMinutes: 0, displayMinutes: 120, coreMinutes: 120, activeMinutes: 120, tailMinutes: 60, bufferMinutes: 15 },
      ]),
    ).toBe(120);
  });

  it('leaves out a buffer band detached from the card by an end-reaching block', () => {
    expect(
      bookingMoveFootprintMinutes([
        { offsetMinutes: 0, displayMinutes: 180, coreMinutes: 180, activeMinutes: 120, tailMinutes: 0, bufferMinutes: 15 },
      ]),
    ).toBe(120);
  });

  it('never shrinks below what the bar draws when the reach is shorter', () => {
    // A bar painted from a catalogue span (no end time) can be longer than its core.
    expect(
      bookingMoveFootprintMinutes([
        { offsetMinutes: 0, displayMinutes: 45, coreMinutes: 30, activeMinutes: 30, tailMinutes: 0, bufferMinutes: 0 },
      ]),
    ).toBe(45);
  });

  it('takes the furthest reach across rows moved together', () => {
    expect(
      bookingMoveFootprintMinutes([
        { offsetMinutes: 0, displayMinutes: 30, coreMinutes: 30, activeMinutes: 30, tailMinutes: 0, bufferMinutes: 0 },
        { offsetMinutes: 60, displayMinutes: 30, coreMinutes: 30, activeMinutes: 30, tailMinutes: 0, bufferMinutes: 15 },
      ]),
    ).toBe(105);
  });
});
