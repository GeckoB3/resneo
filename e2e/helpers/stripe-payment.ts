import type { Page } from '@playwright/test';

const TEST_CARD = {
  number: '4242424242424242',
  expiry: '12 / 34',
  cvc: '123',
  zip: 'BT1 1AA',
};

/**
 * Fills Stripe Payment Element fields inside nested iframes (test mode).
 * Tries several locator strategies because Stripe iframe structure varies by version.
 */
export async function fillStripePaymentElement(page: Page): Promise<void> {
  const frames = page.locator('iframe[name^="__privateStripeFrame"], iframe[src*="stripe"]');
  await frames.first().waitFor({ state: 'attached', timeout: 30_000 });

  const frameCount = await frames.count();
  for (let i = 0; i < frameCount; i++) {
    const frame = page.frameLocator('iframe').nth(i);
    const cardNumber = frame.getByRole('textbox', { name: /card number/i });
    if ((await cardNumber.count()) > 0) {
      await cardNumber.fill(TEST_CARD.number);
      const expiry = frame.getByRole('textbox', { name: /expiration|expiry/i });
      if ((await expiry.count()) > 0) {
        await expiry.fill(TEST_CARD.expiry);
      }
      const cvc = frame.getByRole('textbox', { name: /cvc|security code/i });
      if ((await cvc.count()) > 0) {
        await cvc.fill(TEST_CARD.cvc);
      }
      const zip = frame.getByRole('textbox', { name: /zip|postal/i });
      if ((await zip.count()) > 0) {
        await zip.fill(TEST_CARD.zip);
      }
      return;
    }

    const placeholderCard = frame.locator('[placeholder*="Card number"], [name="number"]');
    if ((await placeholderCard.count()) > 0) {
      await placeholderCard.fill(TEST_CARD.number);
      const exp = frame.locator('[placeholder*="MM"], [name="exp-date"]');
      if ((await exp.count()) > 0) await exp.fill('1234');
      const cvc = frame.locator('[placeholder*="CVC"], [name="cvc"]');
      if ((await cvc.count()) > 0) await cvc.fill(TEST_CARD.cvc);
      return;
    }
  }

  throw new Error('Could not locate Stripe Payment Element fields in any iframe');
}
