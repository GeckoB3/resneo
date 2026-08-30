import { defineConfig, devices } from '@playwright/test';
import { config as loadEnv } from 'dotenv';
import { join } from 'path';

loadEnv({ path: join(process.cwd(), '.env.local') });
loadEnv({ path: join(process.cwd(), '.env.e2e') });

const baseURL = process.env.E2E_BASE_URL ?? process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000';

/**
 * P0.4 smoke: public appointment book → Stripe pay → guest confirm/manage link,
 * plus the authenticated portal specs.
 *
 * Requires a fixture venue (see Docs/E2E_SMOKE.md). Skipped when E2E_VENUE_SLUG is unset.
 *
 * PROJECT LAYOUT (P0-1d). Four projects, and the boundaries between them are
 * the point:
 *
 *   setup     signs the portal customer in once and saves the browser state.
 *   chromium  the desktop suite. Runs SIGNED OUT by default.
 *   mobile    the same browser at 375px, for the specs written for it.
 *   cleanup   deletes the saved session and reports leftover fixture rows.
 *
 * `storageState` is NOT set on a project. It is opted into per file, with
 * `test.use({ storageState: PORTAL_CUSTOMER_STATE })`, because most of this
 * suite is the PUBLIC booking flow and signing those specs in would change the
 * thing under test: a signed-in guest sees prefilled details and a different
 * path through the form. A project-level state would have made every public
 * spec quietly test the authenticated flow instead.
 *
 * The mobile project matches only `*.mobile.spec.ts`, and the desktop project
 * ignores those files. Without both halves the paid specs would run twice per
 * suite, which on a Stripe fixture venue means real duplicate charges and
 * double the bookings eating the fixture's availability.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
      teardown: 'cleanup',
    },
    {
      name: 'cleanup',
      testMatch: /global\.teardown\.ts/,
    },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // Mobile specs belong to the mobile project. Without this they would run
      // here too, at a desktop viewport, asserting things about a layout they
      // were not written for.
      testIgnore: /.*\.mobile\.spec\.ts/,
      dependencies: ['setup'],
    },
    {
      name: 'mobile',
      // 375px, the width P1-2 and P1-3's acceptance criteria are written
      // against. Declared explicitly rather than borrowing a device preset,
      // because the presets drift with Playwright releases and the number in
      // those criteria has to stay the number this runs at.
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 375, height: 812 },
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
      },
      testMatch: /.*\.mobile\.spec\.ts/,
      dependencies: ['setup'],
    },
  ],
  globalSetup: './e2e/global-setup.ts',
  webServer: process.env.E2E_SKIP_WEB_SERVER
    ? undefined
    : {
        command: process.env.CI ? 'npm run start' : 'npm run dev',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
});
