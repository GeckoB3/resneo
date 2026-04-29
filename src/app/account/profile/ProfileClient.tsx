'use client';

import { useMemo, useState } from 'react';

type Profile = {
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  locale: string;
  timezone: string;
  default_login_destination: 'account' | 'dashboard' | 'ask' | null;
  notification_preferences: Record<string, unknown>;
};

type MarketingRelationship = {
  id: string;
  venueName: string;
  marketing_consent: boolean;
  marketing_consent_at: string | null;
  marketing_opt_out: boolean;
};

type Device = {
  id: string;
  platform: string;
  device_name: string | null;
  last_seen_at: string | null;
  created_at: string;
};

export function ProfileClient({
  initialProfile,
  marketingRelationships,
  devices,
}: {
  initialProfile: Profile;
  marketingRelationships: MarketingRelationship[];
  devices: Device[];
}) {
  const [profile, setProfile] = useState(initialProfile);
  const [marketing, setMarketing] = useState(marketingRelationships);
  const [knownDevices, setKnownDevices] = useState(devices);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const prefs = useMemo(() => {
    const p = profile.notification_preferences ?? {};
    return {
      operational_email: p.operational_email !== false,
      marketing_email: p.marketing_email === true,
    };
  }, [profile.notification_preferences]);

  async function saveProfile() {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch('/api/account/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      });
      const body = (await res.json()) as { error?: string; profile?: Profile };
      if (!res.ok || !body.profile) {
        setError(body.error ?? 'Failed to save profile');
        return;
      }
      setProfile(body.profile);
      setMessage('Profile saved.');
    } catch {
      setError('Network error');
    } finally {
      setSaving(false);
    }
  }

  async function updateMarketing(guestId: string, marketing_consent: boolean) {
    setError(null);
    setMarketing((rows) => rows.map((r) => (r.id === guestId ? { ...r, marketing_consent } : r)));
    const res = await fetch('/api/account/marketing-preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guest_id: guestId, marketing_consent }),
    });
    if (!res.ok) {
      setError('Could not update marketing preference.');
      setMarketing((rows) => rows.map((r) => (r.id === guestId ? { ...r, marketing_consent: !marketing_consent } : r)));
    }
  }

  async function removeDevice(deviceId: string) {
    const res = await fetch(`/api/account/devices/${encodeURIComponent(deviceId)}`, { method: 'DELETE' });
    if (res.ok) {
      setKnownDevices((rows) => rows.filter((d) => d.id !== deviceId));
    } else {
      setError('Could not remove device.');
    }
  }

  async function registerThisDevice() {
    setError(null);
    const res = await fetch('/api/account/devices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        platform: 'web',
        device_name: typeof navigator === 'undefined' ? 'Web browser' : navigator.userAgent.slice(0, 120),
      }),
    });
    const body = (await res.json().catch(() => ({}))) as { device?: Device; error?: string };
    if (res.ok && body.device) {
      setKnownDevices((rows) => [body.device!, ...rows]);
      setMessage('This browser has been registered.');
      return;
    }
    setError(body.error ?? 'Could not register this browser.');
  }

  function updateNotificationPreference(key: 'operational_email' | 'marketing_email', value: boolean) {
    setProfile((p) => ({
      ...p,
      notification_preferences: {
        ...(p.notification_preferences ?? {}),
        [key]: value,
      },
    }));
  }

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-medium text-slate-900">Profile</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-700">
            Display name
            <input
              value={profile.display_name ?? ''}
              onChange={(e) => setProfile((p) => ({ ...p, display_name: e.target.value }))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Phone
            <input
              value={profile.phone ?? ''}
              onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Locale
            <input
              value={profile.locale}
              onChange={(e) => setProfile((p) => ({ ...p, locale: e.target.value }))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Timezone
            <input
              value={profile.timezone}
              onChange={(e) => setProfile((p) => ({ ...p, timezone: e.target.value }))}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            />
          </label>
          <label className="block text-sm font-medium text-slate-700 sm:col-span-2">
            Default destination after login
            <select
              value={profile.default_login_destination ?? 'ask'}
              onChange={(e) =>
                setProfile((p) => ({
                  ...p,
                  default_login_destination: e.target.value as Profile['default_login_destination'],
                }))
              }
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            >
              <option value="ask">Ask when needed</option>
              <option value="account">Account</option>
              <option value="dashboard">Venue dashboard</option>
            </select>
          </label>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-medium text-slate-900">Notification preferences</h2>
        <p className="mt-2 text-sm text-slate-600">
          These apply to your <span className="font-medium">ReserveNI account</span> (booking confirmations from the
          platform, security notices, optional product updates). Use <span className="font-medium">Venue marketing</span>{' '}
          below for promotional email per venue you have booked with.
        </p>
        <div className="mt-4 space-y-3 text-sm text-slate-700">
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={prefs.operational_email}
              onChange={(e) => updateNotificationPreference('operational_email', e.target.checked)}
              className="mt-1"
            />
            <span>
              Operational emails: booking confirmations and reminders sent by ReserveNI, plus security notices for your
              account.
            </span>
          </label>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={prefs.marketing_email}
              onChange={(e) => updateNotificationPreference('marketing_email', e.target.checked)}
              className="mt-1"
            />
            <span>ReserveNI product updates and platform news (not venue-specific promotions).</span>
          </label>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-medium text-slate-900">Venue marketing consent</h2>
        <p className="mt-2 text-sm text-slate-600">
          Each venue you have booked with may send marketing separately. Toggling here updates that venue&apos;s guest
          record only; it does not change your account-level operational email setting above.
        </p>
        {marketing.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">No linked venue relationships yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-200">
            {marketing.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-4 py-3">
                <div>
                  <p className="font-medium text-slate-900">{row.venueName}</p>
                  <p className="text-xs text-slate-500">
                    {row.marketing_consent_at ? `Consented ${row.marketing_consent_at.slice(0, 10)}` : 'No consent recorded'}
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={row.marketing_consent}
                    onChange={(e) => void updateMarketing(row.id, e.target.checked)}
                  />
                  Marketing emails
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-medium text-slate-900">Devices</h2>
          <button
            type="button"
            onClick={() => void registerThisDevice()}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50"
          >
            Register this browser
          </button>
        </div>
        {knownDevices.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">No devices registered yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-200">
            {knownDevices.map((device) => (
              <li key={device.id} className="flex items-center justify-between gap-4 py-3">
                <div>
                  <p className="font-medium text-slate-900">{device.device_name || device.platform}</p>
                  <p className="text-xs text-slate-500">
                    Last seen {device.last_seen_at ? device.last_seen_at.slice(0, 10) : device.created_at.slice(0, 10)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void removeDevice(device.id)}
                  className="text-sm font-medium text-red-700 hover:underline"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {message ? <p className="text-sm text-green-800">{message}</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      <button
        type="button"
        disabled={saving}
        onClick={() => void saveProfile()}
        className="rounded-md bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {saving ? 'Saving...' : 'Save changes'}
      </button>
    </div>
  );
}
