import { describe, expect, it } from 'vitest';
import { hasMarketingPermission, marketingSkipReason } from './marketing-permission';

describe('hasMarketingPermission', () => {
  it('needs a recorded consent', () => {
    expect(hasMarketingPermission({ marketing_consent: false, marketing_opt_out: false })).toBe(false);
    expect(hasMarketingPermission({})).toBe(false);
  });
  it('an opt-out always wins over an old consent', () => {
    expect(hasMarketingPermission({ marketing_consent: true, marketing_opt_out: true })).toBe(false);
  });
  it('consent without an opt-out grants permission', () => {
    expect(hasMarketingPermission({ marketing_consent: true, marketing_opt_out: false })).toBe(true);
    expect(hasMarketingPermission({ marketing_consent: true })).toBe(true);
  });
  it('explains a skip in staff words', () => {
    expect(marketingSkipReason({ marketing_consent: true, marketing_opt_out: true })).toBe('Opted out of marketing');
    expect(marketingSkipReason({ marketing_consent: false })).toBe('No marketing permission on file');
    expect(marketingSkipReason({ marketing_consent: true })).toBeNull();
  });
});
