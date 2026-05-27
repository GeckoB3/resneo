import { describe, expect, it } from 'vitest';
import { isGenericConsumerEmailDomain } from './anti-abuse';

describe('isGenericConsumerEmailDomain', () => {
  it('matches common UK/IE/global consumer providers', () => {
    for (const domain of [
      'gmail.com',
      'googlemail.com',
      'hotmail.com',
      'hotmail.co.uk',
      'hotmail.ie',
      'outlook.com',
      'outlook.ie',
      'live.co.uk',
      'msn.com',
      'yahoo.com',
      'yahoo.co.uk',
      'yahoo.ie',
      'ymail.com',
      'icloud.com',
      'me.com',
      'mac.com',
      'aol.com',
      'proton.me',
      'protonmail.com',
      'pm.me',
      'gmx.co.uk',
      'fastmail.com',
      'tutanota.com',
      'zoho.com',
      'btinternet.com',
      'talktalk.net',
      'virginmedia.com',
      'sky.com',
      'plus.net',
      'eircom.net',
      'iol.ie',
    ]) {
      expect(isGenericConsumerEmailDomain(domain), `expected ${domain} to be generic`).toBe(true);
    }
  });

  it('lower-cases and trims before matching', () => {
    expect(isGenericConsumerEmailDomain('  GMAIL.com ')).toBe(true);
  });

  it('rejects real business domains', () => {
    expect(isGenericConsumerEmailDomain('greenwaysalon.co.uk')).toBe(false);
    expect(isGenericConsumerEmailDomain('joeshair.com')).toBe(false);
  });

  it('rejects null / empty input', () => {
    expect(isGenericConsumerEmailDomain(null)).toBe(false);
    expect(isGenericConsumerEmailDomain(undefined)).toBe(false);
    expect(isGenericConsumerEmailDomain('')).toBe(false);
    expect(isGenericConsumerEmailDomain('   ')).toBe(false);
  });
});
