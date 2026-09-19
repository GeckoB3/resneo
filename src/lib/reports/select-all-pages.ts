/** Rows per request. PostgREST stops at 1,000 rows without saying so, so a full page means there may be more. */
export const PAGE_SIZE = 1000;

/**
 * Reads every page of a query, `PAGE_SIZE` rows at a time, so a report over a
 * busy venue is not quietly cut off at the first 1,000 rows. `page` must apply
 * a stable order and `.range(from, to)`.
 */
export async function selectAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await page(offset, offset + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) return out;
  }
}
