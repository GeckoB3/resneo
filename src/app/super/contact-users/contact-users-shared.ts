import type { BroadcastContent } from '@/lib/platform/broadcast-email';
import type { AudienceSegment } from '@/lib/platform/broadcast-audience';

export type BroadcastStatus = 'draft' | 'sending' | 'sent' | 'partially_sent' | 'failed';

export interface BroadcastSummary {
  id: string;
  status: BroadcastStatus;
  subject: string;
  content: unknown;
  important: boolean;
  audience: unknown;
  created_by_email: string | null;
  sent_by_email: string | null;
  created_at: string;
  updated_at: string;
  send_started_at: string | null;
  sent_at: string | null;
  recipient_count: number;
  sent_count: number;
  failed_count: number;
  skipped_count: number;
}

export interface BroadcastRecipientRow {
  id: string;
  email: string;
  first_name: string | null;
  venue_names: string[] | null;
  status: 'pending' | 'sent' | 'failed' | 'skipped_opted_out';
  error: string | null;
  sent_at: string | null;
}

export interface ComposerDraft {
  subject: string;
  content: BroadcastContent;
  important: boolean;
  audienceMode: 'all' | 'selected';
  selectedVenueIds: string[];
}

export const SEGMENT_PILL: Record<AudienceSegment, string> = {
  paying: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  trial: 'bg-sky-50 text-sky-700 ring-sky-200',
  cancelling: 'bg-amber-50 text-amber-800 ring-amber-200',
  past_due: 'bg-rose-50 text-rose-700 ring-rose-200',
  complimentary: 'bg-violet-50 text-violet-700 ring-violet-200',
  test: 'bg-slate-100 text-slate-600 ring-slate-200',
};

export const STATUS_LABEL: Record<BroadcastStatus, string> = {
  draft: 'Draft',
  sending: 'Sending',
  sent: 'Sent',
  partially_sent: 'Partly sent',
  failed: 'Not sent',
};

export const STATUS_PILL: Record<BroadcastStatus, string> = {
  draft: 'bg-slate-100 text-slate-600',
  sending: 'bg-sky-100 text-sky-700',
  sent: 'bg-emerald-100 text-emerald-700',
  partially_sent: 'bg-amber-100 text-amber-800',
  failed: 'bg-rose-100 text-rose-700',
};

export function publicBaseUrl(): string {
  const env = process.env.NEXT_PUBLIC_BASE_URL?.trim();
  if (env) return env.replace(/\/$/, '');
  return typeof window !== 'undefined' ? window.location.origin : 'https://www.resneo.com';
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`) as Error & { status?: number; data?: unknown };
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export interface StarterTemplate {
  id: string;
  label: string;
  description: string;
  subject: string;
  content: Pick<BroadcastContent, 'eyebrow' | 'headline' | 'intro' | 'body'>;
  important?: boolean;
}

/** Starting points for the composer. Plain, warm, second person, and no em-dashes. */
export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    id: 'feature',
    label: 'New feature',
    description: 'Announce one new feature, with steps and a button.',
    subject: 'New in ResNeo: [feature name]',
    content: {
      eyebrow: 'New feature',
      headline: 'Say hello to [feature name]',
      intro: 'A quicker way to [what it helps with], available on your account today.',
      body: [
        "We've just added [feature name] to ResNeo, and we think you're going to love it.",
        '',
        '## What it does',
        '',
        '[One or two sentences on the problem it solves and how it helps your day.]',
        '',
        '## How to get started',
        '',
        '1. Sign in to your dashboard.',
        '2. Go to **Settings**, then **[section]**.',
        '3. Switch on **[feature name]** and save.',
        '',
        '[[button: Try it now | /dashboard]]',
        '',
        '> **Good to know:** [a helpful tip, or who the feature is available to].',
        '',
        "As always, we'd love to hear what you think. Just hit reply.",
      ].join('\n'),
    },
  },
  {
    id: 'roundup',
    label: 'Product update',
    description: 'A roundup of several improvements.',
    subject: "What's new in ResNeo this month",
    content: {
      eyebrow: 'Product update',
      headline: "What's new in ResNeo",
      intro: "Here's a quick look at everything we've improved for you recently.",
      body: [
        "We've been busy making ResNeo faster, simpler and more useful for {venue_name}. Here are the highlights.",
        '',
        '### [First improvement]',
        '[A sentence or two on what changed and why it helps.]',
        '',
        '### [Second improvement]',
        '[A sentence or two on what changed and why it helps.]',
        '',
        '### Smaller fixes',
        '',
        '- [A small improvement]',
        '- [Another small improvement]',
        '- [A fix you asked for]',
        '',
        '[[button: Open your dashboard | /dashboard]]',
        '',
        'Thank you for being part of ResNeo. Your feedback shapes everything we build.',
      ].join('\n'),
    },
  },
  {
    id: 'notice',
    label: 'Important notice',
    description: 'Service news every account holder must see.',
    subject: 'Important: [what is changing] on [date]',
    important: true,
    content: {
      eyebrow: 'Important notice',
      headline: '[What is changing]',
      intro: 'Please take a moment to read this. It affects how you use ResNeo.',
      body: [
        "We're writing to let you know that [what is happening] on **[date and time]**.",
        '',
        '> **What this means for you:** [the practical effect, in one or two sentences].',
        '',
        '## What you need to do',
        '',
        '[Nothing at all, or the steps they need to take.]',
        '',
        "If you have any questions, just reply to this email and we'll help.",
      ].join('\n'),
    },
  },
];
