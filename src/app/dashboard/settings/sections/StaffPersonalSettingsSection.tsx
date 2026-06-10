'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PhoneWithCountryField } from '@/components/phone/PhoneWithCountryField';
import { normalizeToE164 } from '@/lib/phone/e164';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { Pill } from '@/components/ui/dashboard/Pill';
import { Skeleton } from '@/components/ui/Skeleton';
import { readResponseJson } from '@/lib/http/read-response-json';
import { createClient } from '@/lib/supabase/browser';

interface StaffProfileRow {
  id: string;
  email: string;
  name: string | null;
  phone: string | null;
  role: string;
}

/**
 * Settings for non-admin venue staff: display name, sign-in email, phone, password.
 */
export function StaffPersonalSettingsSection({
  onInitialLoadComplete,
}: {
  onInitialLoadComplete?: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [profile, setProfile] = useState<StaffProfileRow | null>(null);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSuccess, setProfileSuccess] = useState<string | null>(null);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch('/api/venue/staff/me');
      const body = await readResponseJson<{ error?: string; staff?: StaffProfileRow }>(res);
      if (!res.ok) {
        throw new Error(body.error ?? 'Failed to load your profile');
      }
      if (!body.staff) {
        throw new Error('Failed to load your profile');
      }
      const row = body.staff;
      setProfile(row);
      setName(row.name ?? '');
      setEmail(row.email);
      setPhone(row.phone ?? '');
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Failed to load profile');
    } finally {
      setLoading(false);
      onInitialLoadComplete?.();
    }
  }, [onInitialLoadComplete]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSaveProfile = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setProfileError(null);
      setProfileSuccess(null);
      setSavingProfile(true);
      try {
        const emailChanged = profile !== null && email.trim().toLowerCase() !== profile.email.toLowerCase();
        const phoneTrim = phone.trim();
        const phoneE164 = phoneTrim ? normalizeToE164(phone, 'GB') : null;
        if (phoneTrim && !phoneE164) {
          setProfileError('Enter a valid phone number or leave phone blank');
          setSavingProfile(false);
          return;
        }
        const res = await fetch('/api/venue/staff/me', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: name.trim(),
            email: email.trim().toLowerCase(),
            phone: phoneE164 ?? '',
          }),
        });
        const body = await readResponseJson<{ error?: string; staff?: StaffProfileRow }>(res);
        if (!res.ok) {
          throw new Error(body.error ?? 'Could not save profile');
        }
        if (!body.staff) {
          throw new Error('Could not save profile');
        }
        const row = body.staff;
        setProfile(row);
        setName(row.name ?? '');
        setEmail(row.email);
        setPhone(row.phone ?? '');
        if (emailChanged) {
          // The server updated the auth email, but this browser's access token still
          // carries the old email claim. Mint a fresh token now so the session stays
          // consistent with the new sign-in email; the staff user_id link keeps the
          // session valid server-side even if this refresh fails.
          try {
            await createClient().auth.refreshSession();
          } catch {
            // best-effort
          }
          router.refresh();
        }
        setProfileSuccess('Profile saved.');
        setTimeout(() => setProfileSuccess(null), 4000);
      } catch (err) {
        setProfileError(err instanceof Error ? err.message : 'Could not save profile');
      } finally {
        setSavingProfile(false);
      }
    },
    [name, email, phone, profile, router],
  );

  const onChangePassword = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);
    setPasswordSuccess(null);
    if (newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters');
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }
    setChangingPassword(true);
    try {
      const res = await fetch('/api/venue/staff/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_password: newPassword }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? 'Password change failed');
      }
      setNewPassword('');
      setConfirmPassword('');
      setPasswordSuccess('Password updated.');
      router.refresh();
      setTimeout(() => setPasswordSuccess(null), 4000);
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Password change failed');
    } finally {
      setChangingPassword(false);
    }
  }, [newPassword, confirmPassword, router]);

  if (loading) {
    return (
      <Skeleton.Card className="p-0">
        <div className="border-b border-slate-100/90 px-4 py-4 sm:px-6 sm:py-5">
          <Skeleton.Line className="w-28" />
          <Skeleton.Line className="mt-3 h-6 w-48" />
        </div>
        <div className="space-y-4 px-4 py-5 sm:px-6 sm:py-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton.Block className="h-11" />
            <Skeleton.Block className="h-11" />
          </div>
          <Skeleton.Block className="h-11" />
          <Skeleton.Block className="h-10 w-32" />
        </div>
      </Skeleton.Card>
    );
  }

  if (loadError || !profile) {
    return (
      <SectionCard elevated>
        <SectionCard.Body className="space-y-3">
          <p className="text-sm text-red-600">{loadError ?? 'Could not load profile.'}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
          >
            Try again
          </button>
        </SectionCard.Body>
      </SectionCard>
    );
  }

  return (
    <div className="space-y-6">
      <SectionCard elevated>
        <SectionCard.Header
          eyebrow="Account"
          title="Your profile"
          description="Update how you appear in the dashboard, your sign-in email, and your contact number."
        />
        <SectionCard.Body>
        <form onSubmit={onSaveProfile} className="space-y-4">
          {profileSuccess ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200/80 bg-emerald-50/70 px-3 py-2.5 text-sm text-emerald-950">
              <Pill variant="success" size="sm" dot>
                Saved
              </Pill>
              <span>{profileSuccess}</span>
            </div>
          ) : null}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="staff-display-name" className="mb-1 block text-sm font-medium text-slate-700">
                Display name
              </label>
              <input
                id="staff-display-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                maxLength={200}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              />
            </div>
            <div>
              <label htmlFor="staff-email" className="mb-1 block text-sm font-medium text-slate-700">
                Sign-in email <span className="text-red-400">*</span>
              </label>
              <input
                id="staff-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              />
              <p className="mt-1 text-xs text-slate-500">Use this address when you log in.</p>
            </div>
            <div>
              <label htmlFor="staff-phone" className="mb-1 block text-sm font-medium text-slate-700">
                Phone
              </label>
              <PhoneWithCountryField
                id="staff-phone"
                value={phone}
                onChange={setPhone}
                inputClassName="w-full min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              />
              <p className="mt-1 text-xs text-slate-500">Optional. Include country code.</p>
            </div>
          </div>
          {profileError && <p className="text-sm text-red-600">{profileError}</p>}
          <button
            type="submit"
            disabled={savingProfile}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {savingProfile ? 'Saving…' : 'Save profile'}
          </button>
        </form>
        </SectionCard.Body>
      </SectionCard>

      <SectionCard elevated>
        <SectionCard.Header eyebrow="Security" title="Password" description="Change the password you use to sign in." />
        <SectionCard.Body>
        <form onSubmit={onChangePassword} className="max-w-md space-y-3">
          {passwordSuccess ? (
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-200/80 bg-emerald-50/70 px-3 py-2.5 text-sm text-emerald-950">
              <Pill variant="success" size="sm" dot>
                Saved
              </Pill>
              <span>{passwordSuccess}</span>
            </div>
          ) : null}
          <div>
            <label htmlFor="staff-new-pw" className="mb-1 block text-sm font-medium text-slate-700">
              New password
            </label>
            <input
              id="staff-new-pw"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={8}
              autoComplete="new-password"
              placeholder="Min 8 characters"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <div>
            <label htmlFor="staff-confirm-pw" className="mb-1 block text-sm font-medium text-slate-700">
              Confirm password
            </label>
            <input
              id="staff-confirm-pw"
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={8}
              autoComplete="new-password"
              placeholder="Re-enter password"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </div>
          {passwordError && <p className="text-sm text-red-600">{passwordError}</p>}
          <button
            type="submit"
            disabled={changingPassword || !newPassword || !confirmPassword}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {changingPassword ? 'Updating…' : 'Update password'}
          </button>
        </form>
        </SectionCard.Body>
      </SectionCard>
    </div>
  );
}
