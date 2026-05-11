/**
 * Parse a fetch Response as JSON; if the body is not JSON (e.g. HTML error page,
 * platform timeout text), throw with a short excerpt of the body and status.
 */
export async function readResponseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error(`Empty response from server (${res.status} ${res.statusText})`);
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const snippet = trimmed.replace(/\s+/g, ' ').slice(0, 280);
    throw new Error(
      `Server returned non-JSON (${res.status} ${res.statusText}). ${snippet}${trimmed.length > 280 ? '…' : ''}`,
    );
  }
}
