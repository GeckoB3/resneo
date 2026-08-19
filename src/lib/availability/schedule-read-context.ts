/**
 * Stage 7: knowing, per request, whether any schedule read failed open.
 *
 * `SA-C3`. Every availability fetcher reads `res.data ?? []`, so a failed query is
 * indistinguishable from a genuine "nothing here": "I could not read the leave table"
 * becomes "nobody is on leave", and the engine sells the day. Stage 1 item 4 made those
 * failures visible in Sentry. This makes them ACTIONABLE, by letting a guest-facing route
 * find out that the answer it is about to return was built on a missing input.
 *
 * WHY A LISTENER RATHER THAN A RETURN VALUE. There are 44 fail-open read sites across 11
 * files, and every one already calls `reportAvailabilityReadFailure`. Threading a result
 * through all of them would be an enormous diff whose main risk is the one site that gets
 * missed, silently keeping the old behaviour exactly where it matters. Hooking the reporter
 * that already exists covers all 44 by construction.
 *
 * WHY THE NODE IMPORT LIVES HERE and not in `availability-read-failure.ts`: the engines are
 * reachable from browser bundles (which is why the Sentry import there is dynamic), and a
 * static `node:async_hooks` import would break that. This module is server-only and
 * registers itself with the reporter, so the reporter needs no Node dependency at all.
 *
 * See Docs/Resneo_Scheduling_Resolver_Plan_August_2026.md §4 Stage 7, decision (J).
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import {
  setScheduleReadFailureListener,
  type ScheduleReadFailure,
} from '@/lib/availability/availability-read-failure';

interface ScheduleReadContext {
  failures: ScheduleReadFailure[];
}

const storage = new AsyncLocalStorage<ScheduleReadContext>();

let registered = false;

/** Registers the collector once, lazily, so importing this module is enough to arm it. */
function ensureRegistered(): void {
  if (registered) return;
  registered = true;
  setScheduleReadFailureListener((failure) => {
    const ctx = storage.getStore();
    if (ctx) ctx.failures.push(failure);
  });
}

export interface ScheduleReadOutcome<T> {
  result: T;
  /** Empty when every schedule read succeeded. */
  failures: ScheduleReadFailure[];
}

/**
 * Runs `fn` and reports which schedule reads failed open inside it.
 *
 * Does NOT change what `fn` returns or throws. A caller that wants the old fail-open
 * behaviour simply ignores `failures`, which is what every non-guest path still does.
 */
export async function withScheduleReadContext<T>(fn: () => Promise<T>): Promise<ScheduleReadOutcome<T>> {
  ensureRegistered();
  const ctx: ScheduleReadContext = { failures: [] };
  const result = await storage.run(ctx, fn);
  return { result, failures: ctx.failures };
}
