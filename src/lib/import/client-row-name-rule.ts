/**
 * Acceptance rule for a client/unknown row in the import tool.
 *
 * Rule:
 *   - At least one of `first_name` or `last_name` must be present.
 *   - When only one of those is present, at least one of `email` or `phone` is required.
 *
 * Returns a structured outcome so callers can produce either a blocking error
 * (see `run-validation.ts`) or skip the row at execute time (see `run-execute.ts`).
 */

export type ClientRowNameRuleOutcome =
  | { kind: 'ok' }
  | { kind: 'partial_name_ok' }
  | { kind: 'missing_name' }
  | { kind: 'missing_contact' };

export interface ClientRowNameRuleInput {
  firstName: string | null | undefined;
  lastName: string | null | undefined;
  /** Pass an already-trimmed string when available; raw input is also tolerated. */
  email: string | null | undefined;
  /** Pass either the normalised E.164 phone (preferred) or the raw value. */
  phone: string | null | undefined;
}

function nonEmpty(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

export function evaluateClientRowNameRule(input: ClientRowNameRuleInput): ClientRowNameRuleOutcome {
  const hasFirst = nonEmpty(input.firstName);
  const hasLast = nonEmpty(input.lastName);
  if (!hasFirst && !hasLast) return { kind: 'missing_name' };

  if (hasFirst && hasLast) return { kind: 'ok' };

  const hasContact = nonEmpty(input.email) || nonEmpty(input.phone);
  if (!hasContact) return { kind: 'missing_contact' };

  return { kind: 'partial_name_ok' };
}
