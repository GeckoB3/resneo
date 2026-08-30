'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/browser';
import { Button, FormField, Input } from '@/components/ui/primitives';

/**
 * The one thing the portal says to a customer on their first visit
 * (P3-4h and P3-5's explainer).
 *
 * **This is the answer to G11, not the one-click link.** The link removes the
 * wall once; a password removes it for every visit after that, with no email at
 * all. It is offered at the only moment a customer has ever been both signed in
 * and demonstrably willing to be here, which is immediately after they followed
 * their booking link.
 *
 * **A PROMPT, never a gate.** It renders inside the portal, above the page the
 * customer asked for, and dismissing it costs one click. A customer who arrived
 * to check what time their appointment is must be able to do that and leave.
 *
 * **Safe here specifically, and not in general.** `enable_confirmations` is off
 * (`supabase/config.toml:216`), so elsewhere a password-first customer gets a
 * session immediately but cannot inherit their guest records, because
 * `claim_user_account()` requires `email_confirmed_at` (migration
 * `20270103123000`). That trap does not apply on this path: everyone seeing
 * this prompt arrived through `/auth/portal`, which runs `verifyOtp` and
 * therefore already set `email_confirmed_at` and already ran the claim. They
 * are confirmed and linked before they are ever asked.
 *
 * **Not passkeys.** There is no WebAuthn anywhere in this repository and the
 * Supabase config has it off; adding an authenticator is its own project.
 *
 * **P3-5's first-run explainer is HERE rather than a second banner**, and that
 * is the whole design decision. Two dismissible boxes stacked above the booking
 * a customer came to read is worse than either alone, and they would appear
 * together: this one is in the layout, and a hub-only explainer would be missed
 * by everybody who arrives on their booking, which is everybody who follows a
 * link. One first-run moment, one box, one action.
 *
 * The explainer says the one thing a customer cannot infer from the page in
 * front of them: that this is ONE account across every ResNeo venue, not a
 * login for the venue they just booked. The shortcuts on the hub already say
 * what each section holds, so repeating that would be noise.
 */
export function PortalFirstRunBanner() {
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (dismissed || done) return null;

  /**
   * Remember the dismissal on the USER, not in this browser.
   *
   * The plan asks for "genuinely once and not once per device", so
   * `localStorage` is wrong: the same customer on a phone and a laptop would
   * be asked twice. `user_metadata` travels with the account, costs no
   * migration, and comes back with `getUser()` so the layout can read it for
   * free. Written client-side because it is the customer's own preference on
   * their own record; `has_set_password`, the other half of this decision,
   * already lives there.
   *
   * A failure here is not worth surfacing: the prompt is hidden either way and
   * the worst case is being asked once more on the next visit.
   */
  async function dismiss() {
    setDismissed(true);
    try {
      await createClient().auth.updateUser({
        data: { portal_password_prompt_dismissed_at: new Date().toISOString() },
      });
    } catch (err) {
      console.warn('[portal-password-prompt] could not record dismissal:', err);
    }
  }

  async function save() {
    if (busy) return;
    setError(null);
    if (password.length < 8) {
      setError('Use at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Those two passwords do not match.');
      return;
    }
    setBusy(true);
    try {
      // The route that already exists, and which sets `has_set_password` so
      // this prompt does not come back.
      const res = await fetch('/api/account/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? 'Could not save that password. Please try again.');
        return;
      }
      setDone(true);
      router.refresh();
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    /*
      NAMED BY `aria-label`, NOT BY A HEADING, and the e2e suite is what said so.

      As an `<h2>` it did two things wrong at once. It collided with the
      profile page's own "Password" section heading, which
      `portal-navigation.spec.ts` selects by accessible name, so a heading
      lookup matched two elements. And this banner renders in the LAYOUT,
      above `{children}`, so its heading came before the page's own `<h1>` and
      broke the document outline on every portal page.

      A region with a label is what this is: named for assistive technology,
      absent from the heading order.
    */
    <section
      aria-label="Set a password for faster sign-in"
      className="mb-4 rounded-2xl border border-brand-200 bg-brand-50/50 p-3 sm:mb-6 sm:p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-2 sm:gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-brand-900">
            Set a password to get straight back in
          </p>
          {/*
            KEPT SMALL ON PURPOSE, and measured rather than guessed.

            This sits above the thing the customer came for. At 190px tall it
            pushed the next booking card off the bottom of a 375x812 phone,
            which P1-2's acceptance forbids; its e2e test caught that twice,
            the second time only in CI, because Linux and Windows wrap the
            same sentence into different numbers of lines. Trimming words to
            squeeze under the limit is therefore not a fix, it is a coin
            toss on the next font change.

            So the size is structural: tighter padding and margin below `sm`,
            smaller text, and one sentence that says the only thing a customer
            cannot infer from the page in front of them. Keep it under about
            130px on a 375px screen and there is real headroom.
          */}
          <p className="mt-1 text-xs text-brand-900/80 sm:text-sm">
            Every booking with any ResNeo venue appears here. Add a password to skip the email next
            time.
          </p>
        </div>
        {!open && (
          <div className="flex shrink-0 gap-2">
            <Button type="button" onClick={() => setOpen(true)} className="min-h-9 sm:min-h-10">
              Set a password
            </Button>
            <Button type="button" variant="secondary" onClick={() => void dismiss()} className="min-h-9 sm:min-h-10">
              Not now
            </Button>
          </div>
        )}
      </div>

      {open && (
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="New password">
              <Input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </FormField>
            <FormField label="Confirm password">
              <Input
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </FormField>
          </div>
          {error && (
            <p role="alert" className="text-sm font-medium text-red-700">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => void save()} loading={busy} className="min-h-10">
              {busy ? 'Saving…' : 'Save password'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void dismiss()}
              className="min-h-10"
            >
              Not now
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
