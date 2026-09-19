import type { Story } from '@ladle/react';
import { ContactUsersPageClient } from './ContactUsersPageClient';
import type { AudienceVenue } from '@/lib/platform/broadcast-audience';
import type { BroadcastRecipientRow, BroadcastSummary } from './contact-users-shared';

/**
 * /super/contact-users with an in-memory stand-in for the four /api/platform/contact-users routes,
 * so the composer, preview, review dialog and delivery report can be seen without a superuser login
 * or a database, and without sending anything.
 */

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const audience: AudienceVenue[] = [
  ['Bloom Nail Bar', 'Appointments Plus', 'paying', [['Chloe Martin', 'chloe@bloomnails.co.uk']]],
  ['Glow Studio', 'Appointments Pro', 'paying', [['Sarah Kelly', 'sarah@glowstudio.co.uk'], ['Aoife Byrne', 'aoife@glowstudio.co.uk']]],
  ['Holywood Physio', 'Appointments Pro', 'trial', [['Mark Doherty', 'mark@holywoodphysio.com']]],
  ['Lash Lounge', 'Appointments Light', 'cancelling', [['Emma Reid', 'emma@lashlounge.ie']]],
  ['North Down Barbers', 'Appointments Plus', 'past_due', [['Jamie Hughes', 'jamie@ndbarbers.co.uk']]],
  ['Serenity Spa', 'Appointments Pro', 'complimentary', [['Grace Wilson', 'grace@serenityspa.co.uk']]],
  ['The Pilates Room', 'Appointments Plus', 'paying', [['Niamh Walsh', 'niamh@pilatesroom.co.uk']]],
  ['Glow Studio Bangor', 'Appointments Plus', 'paying', [['Sarah Kelly', 'sarah@glowstudio.co.uk']]],
  ['QA Test Salon', 'Appointments Pro', 'test', [['QA', 'qa@resneo.com']]],
].map(([name, planLabel, segment, contacts], i) => ({
  id: id(i + 1),
  name: name as string,
  slug: (name as string).toLowerCase().replace(/\s+/g, '-'),
  planLabel: planLabel as string,
  segment: segment as AudienceVenue['segment'],
  contactSource: 'admins' as const,
  contacts: (contacts as string[][]).map(([n, e]) => ({ name: n, email: e, optedOut: e === 'emma@lashlounge.ie' })),
}));

const now = Date.now();
const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

const sentBroadcast: BroadcastSummary = {
  id: id(100),
  status: 'partially_sent',
  subject: 'New in ResNeo: reminders by text',
  content: {
    eyebrow: 'New feature',
    headline: 'Text reminders are here',
    intro: 'Fewer no-shows, with a friendly text the day before.',
    body: "Hi again. You can now send **text reminders** to clients the day before their appointment.\n\n[[button: Switch them on | /dashboard/settings]]",
    greeting: true,
    signOff: 'Ryan, John and Andrew',
  },
  important: false,
  audience: { mode: 'all' },
  created_by_email: 'andrew@resneo.com',
  sent_by_email: 'andrew@resneo.com',
  created_at: iso(86400000 * 6),
  updated_at: iso(86400000 * 5),
  send_started_at: iso(86400000 * 5),
  sent_at: iso(86400000 * 5),
  recipient_count: 8,
  sent_count: 6,
  failed_count: 1,
  skipped_count: 1,
};

const sentRecipients: BroadcastRecipientRow[] = audience
  .filter((v) => v.segment !== 'test')
  .flatMap((v) => v.contacts.map((c) => ({ c, v })))
  .filter(({ c }, i, all) => all.findIndex((x) => x.c.email === c.email) === i)
  .map(({ c, v }, i) => ({
    id: id(200 + i),
    email: c.email,
    first_name: c.name?.split(' ')[0] ?? null,
    venue_names: [v.name],
    status: c.optedOut ? 'skipped_opted_out' : c.email.startsWith('jamie') ? 'failed' : 'sent',
    error: c.email.startsWith('jamie') ? 'Mailbox unavailable (550 5.1.1)' : null,
    sent_at: c.optedOut ? null : iso(86400000 * 5),
  }));

const store = new Map<string, BroadcastSummary>([[sentBroadcast.id, sentBroadcast]]);
let seq = 300;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function stub() {
  if (typeof window === 'undefined') return;
  const w = window as Window & { __contactUsersStubbed?: boolean };
  if (w.__contactUsersStubbed) return;
  w.__contactUsersStubbed = true;
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? 'GET').toUpperCase();
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const base = '/api/platform/contact-users';
    if (!url.startsWith(base)) return realFetch(input, init);
    await new Promise((r) => setTimeout(r, 250));

    if (url === `${base}/audience`) return json({ venues: audience });
    if (url === `${base}/test`) return json({ ok: true, to: 'andrew@resneo.com' });
    if (url === `${base}/broadcasts` && method === 'GET') {
      return json({ broadcasts: [...store.values()].sort((a, b) => b.updated_at.localeCompare(a.updated_at)) });
    }
    if (url === `${base}/broadcasts` && method === 'POST') {
      const b: BroadcastSummary = {
        ...sentBroadcast,
        id: id(seq++),
        status: 'draft',
        ...body,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        sent_at: null,
        send_started_at: null,
        sent_by_email: null,
        recipient_count: 0,
        sent_count: 0,
        failed_count: 0,
        skipped_count: 0,
      };
      store.set(b.id, b);
      return json({ broadcast: b }, 201);
    }
    const m = /\/broadcasts\/([^/]+)(\/send)?$/.exec(url);
    if (m) {
      const b = store.get(m[1]);
      if (!b) return json({ error: 'Email not found.' }, 404);
      if (m[2]) {
        const total = body.expected_recipient_count ?? 7;
        store.set(b.id, {
          ...b,
          ...(body.draft ?? {}),
          status: 'sent',
          sent_at: new Date().toISOString(),
          recipient_count: total + 1,
          sent_count: total,
          skipped_count: 1,
        });
        await new Promise((r) => setTimeout(r, 1500));
        return json({ result: { sent: total, failed: 0, skipped: 1, pending: 0, stoppedEarly: false } });
      }
      if (method === 'PATCH') {
        const next = { ...b, ...body, updated_at: new Date().toISOString() };
        store.set(b.id, next);
        return json({ broadcast: next });
      }
      if (method === 'DELETE') {
        store.delete(b.id);
        return json({ ok: true });
      }
      return json({ broadcast: b, recipients: b.id === sentBroadcast.id ? sentRecipients : [] });
    }
    return json({ error: 'Not stubbed' }, 404);
  };
}

export const ContactUsers: Story = () => {
  stub();
  return (
    <div className="min-h-screen bg-slate-50">
      <ContactUsersPageClient />
    </div>
  );
};
