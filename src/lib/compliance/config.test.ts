import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMPLIANCE_CONFIG,
  COMPLIANCE_PLATFORM_DEFAULT_LINK_EXPIRY_DAYS,
  parseComplianceConfig,
  resolveFormLinkExpiryDays,
} from '@/lib/compliance/config';
import {
  mergeVenueFeatureFlagsPatch,
  parseVenueFeatureFlags,
  resolveAppointmentsFeatureFlag,
  venueFeatureFlagsForStorage,
} from '@/lib/feature-flags/resolve';

describe('parseComplianceConfig', () => {
  it('returns full defaults for null/undefined', () => {
    expect(parseComplianceConfig(null)).toEqual(DEFAULT_COMPLIANCE_CONFIG);
    expect(parseComplianceConfig({})).toEqual(DEFAULT_COMPLIANCE_CONFIG);
  });

  it('fills missing keys with defaults but keeps provided values', () => {
    const cfg = parseComplianceConfig({ compliance: { reminder_cadence_days: 3 } });
    expect(cfg.reminder_cadence_days).toBe(3);
    expect(cfg.default_form_link_channel).toBe('email');
    expect(cfg.form_link_expiry_days).toBe(COMPLIANCE_PLATFORM_DEFAULT_LINK_EXPIRY_DAYS);
  });

  it('falls back to defaults on invalid stored shape', () => {
    const cfg = parseComplianceConfig({ compliance: { reminder_cadence_days: -5 } });
    expect(cfg).toEqual(DEFAULT_COMPLIANCE_CONFIG);
  });
});

describe('resolveFormLinkExpiryDays', () => {
  it('prefers the per-type override', () => {
    expect(resolveFormLinkExpiryDays(30, DEFAULT_COMPLIANCE_CONFIG)).toBe(30);
  });
  it('falls back to venue config then platform default', () => {
    expect(resolveFormLinkExpiryDays(null, { ...DEFAULT_COMPLIANCE_CONFIG, form_link_expiry_days: 21 })).toBe(21);
    expect(resolveFormLinkExpiryDays(undefined, DEFAULT_COMPLIANCE_CONFIG)).toBe(
      COMPLIANCE_PLATFORM_DEFAULT_LINK_EXPIRY_DAYS,
    );
  });
  it('ignores non-positive overrides', () => {
    expect(resolveFormLinkExpiryDays(0, DEFAULT_COMPLIANCE_CONFIG)).toBe(
      COMPLIANCE_PLATFORM_DEFAULT_LINK_EXPIRY_DAYS,
    );
  });
});

describe('compliance_records_enabled flag wiring', () => {
  it('defaults off and turns on via venue flag', () => {
    expect(resolveAppointmentsFeatureFlag('compliance_records_enabled', {})).toBe(false);
    expect(resolveAppointmentsFeatureFlag('compliance_records_enabled', { compliance_records_enabled: true })).toBe(
      true,
    );
  });

  it('parses and round-trips the nested compliance config through storage', () => {
    const parsed = parseVenueFeatureFlags({
      compliance_records_enabled: true,
      compliance: { reminder_cadence_days: 14, default_capture_method: 'client_online' },
    });
    expect(parsed.compliance_records_enabled).toBe(true);
    expect(parsed.compliance?.reminder_cadence_days).toBe(14);

    const merged = mergeVenueFeatureFlagsPatch({}, parsed);
    const stored = venueFeatureFlagsForStorage(merged);
    expect(stored.compliance_records_enabled).toBe(true);
    expect((stored.compliance as { reminder_cadence_days: number }).reminder_cadence_days).toBe(14);
  });

  it('removing the enable flag does not wipe the saved compliance config', () => {
    const current = parseVenueFeatureFlags({
      compliance_records_enabled: true,
      compliance: { lock_period_hours: 48 },
    });
    const merged = mergeVenueFeatureFlagsPatch(current, { compliance_records_enabled: false });
    expect(merged.compliance_records_enabled).toBeUndefined();
    expect(merged.compliance?.lock_period_hours).toBe(48);
  });
});
