import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * No customer-reachable route may call a session-storage auth mutator (P0-12, C2).
 *
 * `supabase.auth.updateUser`, `.signOut` and `.refreshSession` on the
 * request-scoped client read the session from STORAGE. A Bearer (mobile)
 * request has no cookie session, so all three silently no-op while the route
 * reports success: that is how "sign out everywhere" revoked nothing and a
 * deleted account kept a working refresh token (G27). The Bearer-capable
 * replacements live in `src/lib/auth/caller-auth.ts`.
 *
 * Derived from the filesystem, not typed by hand, on the model of
 * `schedule-fail-closed-coverage.test.ts`: that file records how four routes
 * escaped an enumeration precisely because the list was hand-typed. Every
 * `route.ts` under the customer-reachable namespaces is swept, so a new route
 * that reaches for the forbidden calls fails here rather than waiting for the
 * next audit. `auth.admin.*` does not match: the admin API is the sanctioned
 * mechanism.
 */

const API = path.join(process.cwd(), 'src', 'app', 'api');

/** C2's scope: /api/account, /api/v1 and /api/booking are the customer surface. */
const SCANNED_NAMESPACES = ['account', 'v1', 'booking'] as const;

const FORBIDDEN = /\.auth\.(updateUser|signOut|refreshSession)\s*\(/;

function collectRouteFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectRouteFiles(full));
    else if (entry.name === 'route.ts') out.push(full);
  }
  return out;
}

describe('customer-reachable routes are Bearer-safe', () => {
  it('no route under /api/account, /api/v1 or /api/booking calls a session-storage auth mutator', () => {
    const offenders: string[] = [];
    for (const ns of SCANNED_NAMESPACES) {
      for (const file of collectRouteFiles(path.join(API, ns))) {
        const src = fs.readFileSync(file, 'utf8');
        const hit = src.match(FORBIDDEN);
        if (hit) {
          offenders.push(`${path.relative(API, file)} -> ${hit[0]}`);
        }
      }
    }
    expect(
      offenders,
      'These routes call session-storage auth mutators, which silently no-op for Bearer callers. ' +
        'Use getCallerAccessToken / updateAuthUserAsCaller / signOutCaller from src/lib/auth/caller-auth.ts.',
    ).toEqual([]);
  });

  it('the sweep is not vacuous: it sees the routes it exists to police', () => {
    // If a refactor moved these namespaces, the previous test would pass over
    // an empty set forever. The reschedule spec taught this lesson once already.
    const seen = SCANNED_NAMESPACES.flatMap((ns) => collectRouteFiles(path.join(API, ns)));
    expect(seen.length).toBeGreaterThan(30);
    expect(seen.some((f) => f.includes('sign-out-everywhere'))).toBe(true);
    expect(seen.some((f) => f.replace(/\\/g, '/').includes('v1/auth/logout'))).toBe(true);
  });
});
