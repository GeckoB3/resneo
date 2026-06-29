/**
 * Escape a literal value for use in a PostgREST `.ilike()` / `.like()` filter.
 *
 * PostgREST passes the value straight into SQL `ILIKE`, where `%` and `_` are
 * wildcards and `\` is the escape character. Identity lookups (e.g. matching an
 * email exactly, case-insensitively) must escape these, otherwise an address like
 * `john_doe@example.com` matches `johnXdoe@example.com` too — over-matching that
 * can make staff/guest identity resolution ambiguous, or match the wrong row.
 */
export function escapeLikePattern(value: string): string {
  // The character class includes the backslash itself, so every metacharacter
  // (\, %, _) is escaped exactly once in a single pass.
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
