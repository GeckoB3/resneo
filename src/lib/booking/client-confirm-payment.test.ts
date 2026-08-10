import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { confirmBookingPaymentWithServer } from './client-confirm-payment';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

/** Run the helper while flushing its retry timers. */
async function run(body: Parameters<typeof confirmBookingPaymentWithServer>[0]) {
  const promise = confirmBookingPaymentWithServer(body);
  await vi.runAllTimersAsync();
  return promise;
}

describe('confirmBookingPaymentWithServer', () => {
  it('maps a verified confirm to confirmed', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { confirmed: true }));
    await expect(run({ booking_id: 'b1' })).resolves.toBe('confirmed');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps BOOKING_CANCELLED to cancelled without retrying', async () => {
    fetchMock.mockResolvedValue(jsonResponse(409, { code: 'BOOKING_CANCELLED', error: 'x' }));
    await expect(run({ booking_id: 'b1' })).resolves.toBe('cancelled');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps a processing payment to processing', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, { confirmed: false, payment_status: 'processing' }),
    );
    await expect(run({ booking_id: 'b1' })).resolves.toBe('processing');
  });

  it('retries unverified answers and succeeds when the webhook lands mid-flight', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { confirmed: false }))
      .mockResolvedValueOnce(jsonResponse(200, { confirmed: true }));
    await expect(run({ booking_id: 'b1' })).resolves.toBe('confirmed');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports unconfirmed after exhausting retries on network errors', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(run({ booking_id: 'b1' })).resolves.toBe('unconfirmed');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
