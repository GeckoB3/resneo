'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

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

const inputClass =
  'mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 shadow-sm transition-colors placeholder:text-slate-400 focus:border-brand-400 focus:outline-none focus:ring-2 focus:ring-brand-200/80';

const sectionClass =
  'rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm shadow-slate-900/5 sm:p-7';

export function ProfileClient({
  initialEmail,
  initialProfile,
  marketingRelationships,
  devices,
}: {
  initialEmail: string;
  initialProfile: Profile;
  marketingRelationships: MarketingRelationship[];
  devices: Device[];
}) {
  const router = useRouter();
  const [profile, setProfile] = useState(initialProfile);
  const [email, setEmail] = useState(initialEmail);
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
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setError('Email is required for your account.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setError('Enter a valid email address.');
      return;
    }

    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch('/api/account/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...profile,
          email: trimmedEmail,
        }),
      });
      const body = (await res.json()) as {
        error?: string;
        profile?: Profile;
        user?: { email?: string | null };
        notice?: string | null;
        email_error?: string | null;
      };
      if (!res.ok || !body.profile) {
        setError(body.error ?? 'Failed to save profile');
        return;
      }
      setProfile(body.profile);
      if (body.user?.email != null) setEmail(body.user.email);
      if (body.email_error) {
        setError(body.email_error);
        setMessage(body.notice ?? 'Profile saved.');
      } else {
        const parts = [body.notice, 'Profile saved.'].filter(Boolean);
        setMessage(parts.join(' '));
      }
      router.refresh();
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
      // Re-registering an existing device returns the refreshed row, so replace it
      // in place rather than adding a second entry for the same device.
      setKnownDevices((rows) => [
        body.device!,
        ...rows.filter((d) => d.id !== body.device!.id),
      ]);
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
    <div className="space-y-8">
      <section className={sectionClass}>
        <h2 className="text-lg font-semibold text-slate-900">Contact details</h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          Your name and phone are stored on your ResNeo profile and used when venues see your account. Email is your
          sign-in address; changing it may require confirmation from your new inbox.
        </p>
        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-800" htmlFor="profile-first-name">
            First name
            <input
              id="profile-first-name"
              name="first_name"
              autoComplete="given-name"
              value={profile.first_name ?? ''}
              onChange={(e) => setProfile((p) => ({ ...p, first_name: e.target.value }))}
              className={inputClass}
            />
          </label>
          <label className="block text-sm font-medium text-slate-800" htmlFor="profile-last-name">
            Surname
            <input
              id="profile-last-name"
              name="last_name"
              autoComplete="family-name"
              value={profile.last_name ?? ''}
              onChange={(e) => setProfile((p) => ({ ...p, last_name: e.target.value }))}
              className={inputClass}
            />
          </label>
          <label className="block text-sm font-medium text-slate-800 sm:col-span-2" htmlFor="profile-email">
            Email
            <input
              id="profile-email"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
            <span className="mt-1.5 block text-xs text-slate-500">
              This updates your login email in our authentication system. If you change it, check both inboxes until you
              confirm.
            </span>
          </label>
          <label className="block text-sm font-medium text-slate-800 sm:col-span-2" htmlFor="profile-phone">
            Phone number
            <input
              id="profile-phone"
              name="phone"
              type="tel"
              autoComplete="tel"
              value={profile.phone ?? ''}
              onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))}
              className={inputClass}
              placeholder="e.g. 07700 900000"
            />
          </label>
          <label className="block text-sm font-medium text-slate-800 sm:col-span-2" htmlFor="profile-display-name">
            Preferred display name{' '}
            <span className="font-normal text-slate-500">(optional)</span>
            <input
              id="profile-display-name"
              name="display_name"
              autoComplete="nickname"
              value={profile.display_name ?? ''}
              onChange={(e) => setProfile((p) => ({ ...p, display_name: e.target.value }))}
              className={inputClass}
              placeholder="How we greet you in the app"
            />
          </label>
        </div>
      </section>

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold text-slate-900">Regional &amp; login</h2>
        <p className="mt-1 text-sm text-slate-600">Locale and timezone affect how dates and times are shown to you.</p>
        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-800" htmlFor="profile-locale">
            Locale
            <input
              id="profile-locale"
              name="locale"
              value={profile.locale}
              onChange={(e) => setProfile((p) => ({ ...p, locale: e.target.value }))}
              className={inputClass}
            />
          </label>
          <label className="block text-sm font-medium text-slate-800" htmlFor="profile-timezone">
            Timezone
            <input
              id="profile-timezone"
              name="timezone"
              value={profile.timezone}
              onChange={(e) => setProfile((p) => ({ ...p, timezone: e.target.value }))}
              className={inputClass}
              placeholder="Europe/London"
            />
          </label>
          <label className="block text-sm font-medium text-slate-800 sm:col-span-2" htmlFor="profile-login-dest">
            Default destination after login
            <select
              id="profile-login-dest"
              name="default_login_destination"
              value={profile.default_login_destination ?? 'ask'}
              onChange={(e) =>
                setProfile((p) => ({
                  ...p,
                  default_login_destination: e.target.value as Profile['default_login_destination'],
                }))
              }
              className={inputClass}
            >
              <option value="ask">Ask when needed</option>
              <option value="account">Account</option>
              <option value="dashboard">Venue dashboard</option>
            </select>
          </label>
        </div>
      </section>

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold text-slate-900">Notification preferences</h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          These apply to your <span className="font-medium text-slate-800">ResNeo account</span> (booking confirmations
          from the platform, security notices, optional product updates). Use{' '}
          <span className="font-medium text-slate-800">Venue marketing</span> below for promotional email per venue you
          have booked with.
        </p>
        <div className="mt-5 space-y-4 text-sm text-slate-700">
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-4">
            <input
              type="checkbox"
              checked={prefs.operational_email}
              onChange={(e) => updateNotificationPreference('operational_email', e.target.checked)}
              className="mt-0.5 size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            <span>
              Operational emails: booking confirmations and reminders sent by ResNeo, plus security notices for your
              account.
            </span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-4">
            <input
              type="checkbox"
              checked={prefs.marketing_email}
              onChange={(e) => updateNotificationPreference('marketing_email', e.target.checked)}
              className="mt-0.5 size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
            />
            <span>ResNeo product updates and platform news (not venue-specific promotions).</span>
          </label>
        </div>
      </section>

      <section className={sectionClass}>
        <h2 className="text-lg font-semibold text-slate-900">Venue marketing consent</h2>
        <p className="mt-1 text-sm leading-relaxed text-slate-600">
          Each venue you have booked with may send marketing separately. Toggling here updates that venue&apos;s guest
          record only; it does not change your account-level operational email setting above.
        </p>
        {marketing.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">No linked venue relationships yet.</p>
        ) : (
          <ul className="mt-5 divide-y divide-slate-100 rounded-xl border border-slate-100">
            {marketing.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-5">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">{row.venueName}</p>
                  <p className="text-xs text-slate-500">
                    {row.marketing_consent_at ? `Consented ${row.marketing_consent_at.slice(0, 10)}` : 'No consent recorded'}
                  </p>
                </div>
                <label className="flex shrink-0 items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={row.marketing_consent}
                    onChange={(e) => void updateMarketing(row.id, e.target.checked)}
                    className="size-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  />
                  Marketing emails
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={sectionClass}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Devices</h2>
            <p className="mt-1 text-sm text-slate-600">Browsers you have registered for account security.</p>
          </div>
          <button
            type="button"
            onClick={() => void registerThisDevice()}
            className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition-colors hover:bg-slate-50"
          >
            Register this browser
          </button>
        </div>
        {knownDevices.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">No devices registered yet.</p>
        ) : (
          <ul className="mt-5 divide-y divide-slate-100 rounded-xl border border-slate-100">
            {knownDevices.map((device) => (
              <li key={device.id} className="flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-5">
                <div>
                  <p className="font-semibold text-slate-900">{device.device_name || device.platform}</p>
                  <p className="text-xs text-slate-500">
                    Last seen {device.last_seen_at ? device.last_seen_at.slice(0, 10) : device.created_at.slice(0, 10)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void removeDevice(device.id)}
                  className="text-sm font-semibold text-red-700 transition-colors hover:text-red-800"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex flex-col gap-4 border-t border-slate-200/80 pt-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-2">
          {message ? (
            <p className="rounded-xl border border-emerald-200/80 bg-emerald-50/90 px-4 py-2.5 text-sm font-medium text-emerald-900">
              {message}
            </p>
          ) : null}
          {error ? (
            <p className="rounded-xl border border-red-200/80 bg-red-50/90 px-4 py-2.5 text-sm font-medium text-red-800">
              {error}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={() => void saveProfile()}
          className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-brand-600 px-6 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
