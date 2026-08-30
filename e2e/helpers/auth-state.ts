import { join } from 'path';

/**
 * Where the signed-in portal customer's browser state lives (P0-1d).
 *
 * Before this, every authenticated test signed in from scratch: mint a magic
 * link server-side, visit `/auth/confirm`, wait for the redirect chain. Five
 * tests in one spec meant five full sign-ins, and every spec P0-8 and P1-3 add
 * would pay the same cost again.
 *
 * IT IS A CREDENTIAL. The file holds a live Supabase session cookie for a real
 * user on the staging project, so it is gitignored and the teardown project
 * deletes it at the end of the run. Never commit it, and never upload it as a
 * CI artifact.
 */
export const AUTH_STATE_DIR = join(process.cwd(), 'e2e', '.auth');

export const PORTAL_CUSTOMER_STATE = join(AUTH_STATE_DIR, 'portal-customer.json');

/**
 * An empty browser state: no cookies, no origins.
 *
 * The setup project writes this when the portal customer is not configured, so
 * that projects depending on the file can still START. Playwright fails the
 * whole run if a `storageState` path does not exist, which would turn "this
 * fixture is not configured" into a hard error for the specs that correctly
 * skip themselves.
 */
export const EMPTY_STORAGE_STATE = { cookies: [], origins: [] } as const;
