/**
 * Read JSON from a `fetch` {@link Response} exactly once.
 * Response bodies are single-use streams; calling `.json()` twice throws
 * `Failed to execute 'json' on 'Response': body stream already read`.
 *
 * Use this when you need the parsed body for both success and error handling.
 */
export async function readResponseJson<T = unknown>(response: Response): Promise<T> {
  try {
    return (await response.json()) as T;
  } catch {
    return {} as T;
  }
}
