'use client';

import { useCallback, useEffect, useState } from 'react';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import {
  DEFAULT_LINKED_NOTIFICATION_PREFS,
  LINKED_NOTIFICATION_CATEGORIES,
  LINKED_NOTIFICATION_LABELS,
  type LinkedNotificationCategory,
  type LinkedNotificationPrefs,
} from '@/lib/linked-accounts/notification-prefs';

function Switch({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50 ${
        checked ? 'bg-brand-600' : 'bg-slate-300'
      }`}
    >
      <span
        aria-hidden
        className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition ${
          checked ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

/**
 * §17.4 — per-venue email preferences for cross-venue write activity. In-app
 * notifications (the bell) are always created; this only controls the email
 * channel. Self-contained: fetches and saves its own state.
 */
export function NotificationPrefsCard() {
  const [prefs, setPrefs] = useState<LinkedNotificationPrefs>(DEFAULT_LINKED_NOTIFICATION_PREFS);
  const [loaded, setLoaded] = useState(false);
  const [savingKey, setSavingKey] = useState<LinkedNotificationCategory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/venue/notifications/preferences', { cache: 'no-store' });
        if (res.ok && alive) {
          const data = (await res.json()) as { prefs?: LinkedNotificationPrefs };
          if (data.prefs) setPrefs(data.prefs);
        }
      } catch {
        /* keep defaults */
      } finally {
        if (alive) setLoaded(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const toggle = useCallback(
    async (key: LinkedNotificationCategory) => {
      const next = !prefs[key];
      setPrefs((p) => ({ ...p, [key]: next })); // optimistic
      setSavingKey(key);
      setError(null);
      try {
        const res = await fetch('/api/venue/notifications/preferences', {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ [key]: next }),
        });
        if (!res.ok) throw new Error('save failed');
        const data = (await res.json()) as { prefs?: LinkedNotificationPrefs };
        if (data.prefs) setPrefs(data.prefs);
      } catch {
        setPrefs((p) => ({ ...p, [key]: !next })); // revert
        setError('Could not save that change. Please try again.');
      } finally {
        setSavingKey(null);
      }
    },
    [prefs],
  );

  return (
    <SectionCard elevated>
      <SectionCard.Header
        eyebrow="Linked accounts"
        title="Notification emails"
        description="Choose which activity from your linked venues emails you. In-app notifications always appear in the bell, regardless of these settings."
      />
      <SectionCard.Body className="space-y-1">
        {error ? (
          <p className="mb-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {error}
          </p>
        ) : null}
        {LINKED_NOTIFICATION_CATEGORIES.map((key) => {
          const label = LINKED_NOTIFICATION_LABELS[key];
          const sentence = `Email me when a linked venue ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
          return (
            <div
              key={key}
              className="flex items-center justify-between gap-4 rounded-lg px-1 py-2.5"
            >
              <span className="text-sm text-slate-700">{sentence}</span>
              <Switch
                checked={prefs[key]}
                disabled={!loaded || savingKey === key}
                label={sentence}
                onChange={() => toggle(key)}
              />
            </div>
          );
        })}
        <p className="pt-2 text-xs text-slate-400">
          Notes-only edits can be noisy; they email only if you turn the last option on. Emails go
          to your venue&rsquo;s contact address and active admins.
        </p>
      </SectionCard.Body>
    </SectionCard>
  );
}
