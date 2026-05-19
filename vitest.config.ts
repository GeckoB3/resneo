import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    exclude: ['**/node_modules/**', '**/.claude/**', '**/dist/**', '**/e2e/**'],
    env: {
      // Policy resolver imports Stripe-backed helpers; tests must not require a local .env.
      STRIPE_SECRET_KEY: 'sk_test_vitest_placeholder',
      PAYMENT_TOKEN_SECRET: 'vitest_payment_token_secret',
      NEXT_PUBLIC_BASE_URL: 'https://vitest.example',
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
