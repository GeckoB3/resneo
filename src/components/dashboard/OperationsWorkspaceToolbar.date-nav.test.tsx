/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, render, screen, cleanup } from '@testing-library/react';
import { useState } from 'react';

/**
 * The date arrows must always step from the LATEST date, never the one captured
 * when the handler was created.
 *
 * Deriving the next date from a rendered value meant a burst of rapid clicks all
 * computed from the same date: React can process several clicks before it
 * commits a re-render of a heavy dashboard, so every handler in the burst saw
 * the stale value and the page landed short of where the user clicked to. The
 * date they stopped on was not the date they were shown.
 *
 * Both shapes are covered here because the codebase uses both: some pages let
 * the toolbar shift the date itself, others pass their own arrow handlers.
 */

/**
 * Mirrors the toolbar's own helper: local midnight, shifted, then formatted from
 * LOCAL parts. Formatting via `toISOString()` would re-encode local midnight as
 * UTC and silently move the day under any positive offset.
 */
function shiftDate(isoDate: string, deltaDays: number): string {
  const base = new Date(`${isoDate}T00:00:00`);
  base.setDate(base.getDate() + deltaDays);
  const y = base.getFullYear();
  const m = String(base.getMonth() + 1).padStart(2, '0');
  const d = String(base.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** The pattern the toolbar's built-in arrows now use. */
function UpdaterArrows({ start }: { start: string }) {
  const [date, setDate] = useState(start);
  const onDateChange = (next: string | ((previous: string) => string)) => setDate(next);
  return (
    <>
      <span data-testid="date">{date}</span>
      <button onClick={() => onDateChange((previous) => shiftDate(previous, 1))}>next</button>
      <button onClick={() => onDateChange((previous) => shiftDate(previous, -1))}>prev</button>
    </>
  );
}

/** The pattern the pages' own `navigate` handlers now use. */
function PageNavigateArrows({ start }: { start: string }) {
  const [anchorDate, setAnchorDate] = useState(start);
  const navigate = (direction: -1 | 1) =>
    setAnchorDate((previous) => shiftDate(previous, direction));
  return (
    <>
      <span data-testid="date">{anchorDate}</span>
      <button onClick={() => navigate(1)}>next</button>
      <button onClick={() => navigate(-1)}>prev</button>
    </>
  );
}

/** The old shape, kept to prove the test actually detects the bug. */
function StaleClosureArrows({ start }: { start: string }) {
  const [date, setDate] = useState(start);
  return (
    <>
      <span data-testid="date">{date}</span>
      <button onClick={() => setDate(shiftDate(date, 1))}>next</button>
    </>
  );
}

/**
 * One `act` block, so every click is processed before React commits a re-render.
 * That is exactly what a fast burst looks like on a slow-rendering page.
 */
function burst(label: string, times: number) {
  act(() => {
    for (let i = 0; i < times; i++) {
      screen.getByText(label).click();
    }
  });
}

afterEach(cleanup);

describe('date navigation under a rapid burst', () => {
  it('lands on the clicked-to date when the toolbar shifts it', () => {
    render(<UpdaterArrows start="2026-08-11" />);
    burst('next', 5);
    expect(screen.getByTestId('date')).toHaveTextContent('2026-08-16');
  });

  it('lands on the clicked-to date when the page supplies the arrows', () => {
    render(<PageNavigateArrows start="2026-08-11" />);
    burst('next', 5);
    expect(screen.getByTestId('date')).toHaveTextContent('2026-08-16');
  });

  it('returns to the start when the burst is reversed', () => {
    render(<PageNavigateArrows start="2026-08-11" />);
    burst('next', 7);
    burst('prev', 7);
    expect(screen.getByTestId('date')).toHaveTextContent('2026-08-11');
  });

  it('crosses a month boundary without losing steps', () => {
    render(<PageNavigateArrows start="2026-08-29" />);
    burst('next', 4);
    expect(screen.getByTestId('date')).toHaveTextContent('2026-09-02');
  });

  it('the old stale-closure shape loses every step but the first', () => {
    // Guards the guard: without this the tests above could pass for the wrong
    // reason if `burst` never actually coalesced the clicks.
    render(<StaleClosureArrows start="2026-08-11" />);
    burst('next', 5);
    expect(screen.getByTestId('date')).toHaveTextContent('2026-08-12');
  });
});
