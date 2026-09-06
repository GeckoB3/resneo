'use client';

import Link from 'next/link';
import { useState, useSyncExternalStore } from 'react';
import { useAssistant } from '@/components/assistant/AssistantProvider';
import { noHandoff, readHandoffOnce, subscribeToNothing } from '@/components/assistant/handoff';
import { ASSISTANT_COPY } from '@/lib/assistant/copy';

const CATEGORIES = [
  { value: 'general', label: 'General question' },
  { value: 'billing', label: 'Billing & payments' },
  { value: 'technical', label: 'Technical issue' },
  { value: 'feature_request', label: 'Feature request' },
] as const;

/**
 * The Support form. When Ask ResNeo hands a conversation over (the "Send this to support"
 * link in the drawer), the transcript arrives through sessionStorage and prefills the form.
 * The handoff is read through useSyncExternalStore so the server render stays blank and the
 * client remounts the form with the prefilled values, with no state set inside an effect.
 */
export default function SupportPage() {
  const handoff = useSyncExternalStore(subscribeToNothing, readHandoffOnce, noHandoff);
  return <SupportForm key={handoff ? 'handoff' : 'blank'} initialSubject={handoff?.subject ?? ''} initialMessage={handoff?.message ?? ''} />;
}

function SupportForm({ initialSubject, initialMessage }: { initialSubject: string; initialMessage: string }) {
  const assistant = useAssistant();
  const [category, setCategory] = useState('general');
  const [subject, setSubject] = useState(initialSubject);
  const [message, setMessage] = useState(initialMessage);
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/venue/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: subject.trim(),
          message: message.trim(),
          category,
          contact_email: contactEmail.trim() || undefined,
          contact_phone: contactPhone.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? 'Failed to send');
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div className="p-4 pb-[max(2rem,env(safe-area-inset-bottom,0px))] md:p-6 md:pb-6 lg:p-8 lg:pb-8">
        <div className="mx-auto max-w-lg">
          <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
              <svg className="h-7 w-7 text-emerald-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
              </svg>
            </div>
            <h1 className="text-xl font-bold text-slate-900">Message sent</h1>
            <p className="mt-2 text-sm text-slate-500">
              Our support team will get back to you as soon as possible. We typically respond within 24 hours.
            </p>
            <button
              onClick={() => {
                setSent(false);
                setSubject('');
                setMessage('');
                setCategory('general');
                setContactEmail('');
                setContactPhone('');
              }}
              className="mt-6 rounded-xl border border-slate-200 px-5 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Send another message
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 pb-[max(2rem,env(safe-area-inset-bottom,0px))] md:p-6 md:pb-6 lg:p-8 lg:pb-8">
      <div className="mx-auto max-w-lg">
        <h1 className="mb-2 text-2xl font-semibold text-slate-900">Support</h1>
        <p className="mb-6 text-sm text-slate-500">
          Need help? Send us a message and we&apos;ll get back to you as soon as we can.
        </p>

        {assistant.enabled ? (
          <button
            type="button"
            onClick={() => assistant.setOpen(true)}
            data-testid="support-ask-resneo-card"
            className="mb-4 flex w-full items-start gap-3 rounded-2xl border border-brand-100 bg-brand-50/70 p-4 text-left shadow-sm transition-colors hover:border-brand-200 hover:bg-brand-50"
          >
            <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-brand-700 shadow-sm ring-1 ring-brand-100">
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor" aria-hidden>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
              </svg>
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-slate-900">{ASSISTANT_COPY.supportCardTitle}</span>
              <span className="mt-0.5 block text-xs leading-5 text-slate-600">{ASSISTANT_COPY.supportCardBody}</span>
            </span>
            <svg className="mt-1 h-4 w-4 shrink-0 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
            </svg>
          </button>
        ) : null}

        <Link
          href="/help"
          className="mb-4 flex items-start gap-3 rounded-2xl border border-brand-100 bg-brand-50/70 p-4 text-left shadow-sm transition-colors hover:border-brand-200 hover:bg-brand-50"
        >
          <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-brand-700 shadow-sm ring-1 ring-brand-100">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" strokeWidth={1.8} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25A8.967 8.967 0 0 1 18 3.75c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-slate-900">Browse the help centre</span>
            <span className="mt-0.5 block text-xs leading-5 text-slate-600">
              Find guides and answers before contacting support.
            </span>
          </span>
          <svg className="mt-1 h-4 w-4 shrink-0 text-brand-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
          </svg>
        </Link>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="category" className="mb-1.5 block text-sm font-medium text-slate-700">Category</label>
              <select
                id="category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="contact_email" className="mb-1.5 block text-sm font-medium text-slate-700">
                Your email <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <input
                id="contact_email"
                type="email"
                autoComplete="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="Best address to reach you"
                maxLength={255}
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              />
              <p className="mt-1 text-xs text-slate-400">Helps us reply directly if it differs from your login email.</p>
            </div>

            <div>
              <label htmlFor="contact_phone" className="mb-1.5 block text-sm font-medium text-slate-700">
                Phone number <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <input
                id="contact_phone"
                type="tel"
                autoComplete="tel"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="e.g. +44 7700 900000"
                maxLength={40}
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              />
            </div>

            <div>
              <label htmlFor="subject" className="mb-1.5 block text-sm font-medium text-slate-700">Subject</label>
              <input
                id="subject"
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Brief summary of your question"
                required
                maxLength={200}
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
              />
            </div>

            <div>
              <label htmlFor="message" className="mb-1.5 block text-sm font-medium text-slate-700">Message</label>
              <textarea
                id="message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Describe your issue or question in detail..."
                required
                rows={6}
                maxLength={5000}
                className="w-full rounded-xl border border-slate-200 px-4 py-2.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 resize-none"
              />
              <p className="mt-1 text-xs text-slate-400">{message.length}/5000</p>
            </div>

            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">{error}</div>
            )}

            <button
              type="submit"
              disabled={submitting || !subject.trim() || !message.trim()}
              className="min-h-12 w-full rounded-xl bg-brand-600 px-4 py-3 text-base font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50"
            >
              {submitting ? 'Sending...' : 'Send Message'}
            </button>
          </form>
        </div>

        <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700 mb-3">Other ways to reach us</h2>
          <div className="space-y-2 text-sm text-slate-600">
            <p className="flex items-center gap-2">
              <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
              </svg>
              <a href="mailto:support@resneo.com" className="text-brand-600 hover:underline">support@resneo.com</a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
