/** A page's `searchParams`, as Next.js passes them. */
export type PageSearchParams = Record<string, string | string[] | undefined>;

/** A `get` over a page's search params, taking the first value of a repeated key. */
export function searchParamsReader(params: PageSearchParams): { get(name: string): string | null } {
  return {
    get(name) {
      const value = params[name];
      const first = Array.isArray(value) ? value[0] : value;
      return typeof first === 'string' ? first : null;
    },
  };
}
