'use client';

import { useDeferredValue, useMemo, useState } from 'react';
import {
  BROADCAST_EYEBROW_PRESETS,
  BROADCAST_LIMITS,
  renderBroadcastEmail,
  type BroadcastContent,
} from '@/lib/platform/broadcast-email';
import {
  buildBroadcastRecipients,
  selectAudienceVenues,
  type AudienceVenue,
  type BroadcastRecipient,
} from '@/lib/platform/broadcast-audience';
import { BodyEditor } from './BodyEditor';
import { EmailPreview } from './EmailPreview';
import { RecipientPicker } from './RecipientPicker';
import { STARTER_TEMPLATES, publicBaseUrl, type ComposerDraft, type StarterTemplate } from './contact-users-shared';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

interface Props {
  draft: ComposerDraft;
  onChange: (patch: Partial<ComposerDraft>) => void;
  onContentChange: (patch: Partial<BroadcastContent>) => void;
  audience: AudienceVenue[] | null;
  audienceLoading: boolean;
  audienceError: string | null;
  onReloadAudience: () => void;
  saveState: SaveState;
  savedAt: string | null;
  hasDraftRow: boolean;
  onApplyTemplate: (t: StarterTemplate) => void;
  onNew: () => void;
  onDeleteDraft: () => void;
  onSendTest: (sample: { firstName: string | null; venueName: string }) => void;
  testState: { busy: boolean; message: string | null; error: boolean };
  onReview: (recipients: BroadcastRecipient[], venues: AudienceVenue[]) => void;
}

const SAMPLE = { key: 'sample', firstName: 'Alex', venueNames: ['Your venue'] };

export function Composer(props: Props) {
  const { draft, onChange, onContentChange, audience } = props;
  const { content } = draft;
  const [previewKey, setPreviewKey] = useState<string>('auto');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const selection = useMemo(
    () =>
      draft.audienceMode === 'all'
        ? ({ mode: 'all' } as const)
        : ({ mode: 'selected', venueIds: draft.selectedVenueIds } as const),
    [draft.audienceMode, draft.selectedVenueIds],
  );
  const chosenVenues = useMemo(() => selectAudienceVenues(audience ?? [], selection), [audience, selection]);
  const recipients = useMemo(() => buildBroadcastRecipients(chosenVenues), [chosenVenues]);
  const sendable = draft.important ? recipients : recipients.filter((r) => !r.optedOut);
  const skipped = recipients.length - sendable.length;
  const venuesWithoutAddress = chosenVenues.filter((v) => v.contacts.length === 0).length;

  const previewRecipient = useMemo(() => {
    if (previewKey === 'sample') return SAMPLE;
    const found = previewKey !== 'auto' ? sendable.find((r) => r.email === previewKey) : undefined;
    const r = found ?? sendable.find((x) => x.firstName) ?? sendable[0];
    return r ? { key: r.email, firstName: r.firstName, venueNames: r.venueNames } : SAMPLE;
  }, [previewKey, sendable]);

  const deferredDraft = useDeferredValue(draft);
  const rendered = useMemo(
    () =>
      renderBroadcastEmail({
        baseUrl: publicBaseUrl(),
        subject: deferredDraft.subject,
        content: {
          ...deferredDraft.content,
          headline: deferredDraft.content.headline || 'Your headline',
          body: deferredDraft.content.body || '*Your message will appear here.*',
        },
        recipient: { firstName: previewRecipient.firstName, venueNames: previewRecipient.venueNames },
        important: deferredDraft.important,
        unsubscribeUrl: deferredDraft.important ? null : `${publicBaseUrl()}/updates/unsubscribe?test=1`,
      }),
    [deferredDraft, previewRecipient],
  );

  const isBlank =
    !draft.subject.trim() && !content.headline.trim() && !content.intro.trim() && !content.body.trim();
  const missing: string[] = [];
  if (!draft.subject.trim()) missing.push('a subject');
  if (!content.headline.trim()) missing.push('a headline');
  if (!content.body.trim()) missing.push('a message');
  const canSend = missing.length === 0 && sendable.length > 0 && !props.audienceLoading;

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* Left: the form */}
      <div className="min-w-0 space-y-6">
        {isBlank ? (
          <section className="rounded-2xl border border-dashed border-slate-300 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-900">Start from a template</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              A ready-made structure you can edit. Replace anything in [square brackets].
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              {STARTER_TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => props.onApplyTemplate(t)}
                  className="rounded-xl border border-slate-200 p-3 text-left transition hover:border-blue-300 hover:bg-blue-50/40"
                >
                  <span className="block text-sm font-semibold text-slate-900">{t.label}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-slate-500">{t.description}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <SectionHeading step={1} title="Who should get it?" />
          <div className="mt-4">
            <RecipientPicker
              venues={audience}
              loading={props.audienceLoading}
              error={props.audienceError}
              mode={draft.audienceMode}
              selectedIds={draft.selectedVenueIds}
              important={draft.important}
              onModeChange={(audienceMode) => onChange({ audienceMode })}
              onSelectedChange={(selectedVenueIds) => onChange({ selectedVenueIds })}
              onRetry={props.onReloadAudience}
            />
          </div>
          <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
            {props.audienceLoading ? (
              'Working out recipients...'
            ) : (
              <>
                Goes to{' '}
                <strong className="text-slate-900">
                  {sendable.length} {sendable.length === 1 ? 'person' : 'people'}
                </strong>{' '}
                at {chosenVenues.length} {chosenVenues.length === 1 ? 'venue' : 'venues'}.
                {skipped > 0 ? (
                  <span className="text-slate-500">
                    {' '}
                    {skipped} unsubscribed from product news and will be skipped.
                  </span>
                ) : null}
                {venuesWithoutAddress > 0 ? (
                  <span className="text-rose-600">
                    {' '}
                    {venuesWithoutAddress} {venuesWithoutAddress === 1 ? 'venue has' : 'venues have'} no email address.
                  </span>
                ) : null}
                <span className="mt-1 block text-xs text-slate-500">
                  Sent to each venue&apos;s account admins. Someone who runs several venues gets one email.
                </span>
              </>
            )}
          </div>
        </section>

        <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <SectionHeading step={2} title="Write the email" />

          <Field label="Subject line" count={draft.subject.length} max={BROADCAST_LIMITS.subject}>
            <input
              value={draft.subject}
              onChange={(e) => onChange({ subject: e.target.value.slice(0, BROADCAST_LIMITS.subject) })}
              placeholder="New in ResNeo: online deposits"
              className={inputCls}
            />
          </Field>

          <Field label="Label" hint="The small tag above the headline. Leave empty to hide it.">
            <div className="flex flex-wrap gap-1.5">
              {BROADCAST_EYEBROW_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => onContentChange({ eyebrow: p })}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                    content.eyebrow === p
                      ? 'bg-[#E7FAFA] text-[#097075] ring-1 ring-[#00C2C7]'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            <input
              value={content.eyebrow}
              onChange={(e) => onContentChange({ eyebrow: e.target.value.slice(0, BROADCAST_LIMITS.eyebrow) })}
              placeholder="Or type your own"
              className={`${inputCls} mt-2`}
            />
          </Field>

          <Field label="Headline" count={content.headline.length} max={BROADCAST_LIMITS.headline}>
            <input
              value={content.headline}
              onChange={(e) => onContentChange({ headline: e.target.value.slice(0, BROADCAST_LIMITS.headline) })}
              placeholder="Take deposits when clients book online"
              className={`${inputCls} text-base font-semibold`}
            />
          </Field>

          <Field
            label="Introduction"
            hint="One or two sentences under the headline. Inboxes also show it as the preview text."
            count={content.intro.length}
            max={BROADCAST_LIMITS.intro}
          >
            <textarea
              value={content.intro}
              onChange={(e) => onContentChange({ intro: e.target.value.slice(0, BROADCAST_LIMITS.intro) })}
              rows={2}
              placeholder="Cut no-shows by asking for a deposit at the moment of booking."
              className={inputCls}
            />
          </Field>

          <div>
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-medium text-slate-600">Message</span>
              <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={content.greeting}
                  onChange={(e) => onContentChange({ greeting: e.target.checked })}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600"
                />
                Start with &ldquo;Hi first name,&rdquo;
              </label>
            </div>
            <BodyEditor
              value={content.body}
              onChange={(body) => onContentChange({ body })}
              maxLength={BROADCAST_LIMITS.body}
            />
            <p className="mt-1.5 text-[11px] text-slate-500">
              Personalise with{' '}
              <button
                type="button"
                onClick={() => onContentChange({ body: `${content.body}{first_name}` })}
                className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700 hover:bg-slate-200"
              >
                {'{first_name}'}
              </button>{' '}
              and{' '}
              <button
                type="button"
                onClick={() => onContentChange({ body: `${content.body}{venue_name}` })}
                className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-700 hover:bg-slate-200"
              >
                {'{venue_name}'}
              </button>{' '}
              in the subject, headline, introduction or message.
            </p>
          </div>

          <Field label="Signed by" hint="Shown above &ldquo;The ResNeo team&rdquo;.">
            <input
              value={content.signOff}
              onChange={(e) => onContentChange({ signOff: e.target.value.slice(0, BROADCAST_LIMITS.signOff) })}
              className={inputCls}
            />
          </Field>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <SectionHeading step={3} title="Type of email" />
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <TypeCard
              active={!draft.important}
              onClick={() => onChange({ important: false })}
              title="Product news"
              detail="Features, tips and news. Includes an unsubscribe link, and skips anyone who has unsubscribed."
            />
            <TypeCard
              active={draft.important}
              onClick={() => onChange({ important: true })}
              title="Important account notice"
              detail="Service changes everyone must know about, such as downtime, pricing or terms. Goes to everyone."
              tone="amber"
            />
          </div>
          {draft.important ? (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
              Only use this for genuine service information. Sending promotional news as an important notice ignores
              people&apos;s choice to unsubscribe.
            </p>
          ) : null}
        </section>

        <div className="sticky bottom-0 z-10 -mx-1 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs text-slate-500">
              <SaveIndicator state={props.saveState} savedAt={props.savedAt} hasDraft={props.hasDraftRow} />
              {props.testState.message ? (
                <p className={`mt-0.5 ${props.testState.error ? 'text-rose-600' : 'text-emerald-700'}`}>
                  {props.testState.message}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {props.hasDraftRow ? (
                <button
                  type="button"
                  onClick={() => {
                    if (confirmDelete) {
                      setConfirmDelete(false);
                      props.onDeleteDraft();
                    } else {
                      setConfirmDelete(true);
                    }
                  }}
                  onBlur={() => setConfirmDelete(false)}
                  className={`rounded-xl px-3 py-2 text-sm font-semibold ${
                    confirmDelete ? 'bg-rose-600 text-white hover:bg-rose-700' : 'text-rose-600 hover:bg-rose-50'
                  }`}
                >
                  {confirmDelete ? 'Click again to delete' : 'Delete draft'}
                </button>
              ) : null}
              {!isBlank ? (
                <button
                  type="button"
                  onClick={props.onNew}
                  className="rounded-xl px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100"
                >
                  New email
                </button>
              ) : null}
              <button
                type="button"
                onClick={() =>
                  props.onSendTest({
                    firstName: previewRecipient.firstName,
                    venueName: previewRecipient.venueNames[0] ?? 'Your venue',
                  })
                }
                disabled={props.testState.busy || missing.length > 0}
                title={missing.length > 0 ? `Add ${missing.join(', ')} first` : 'Sends this email to your own address'}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                {props.testState.busy ? 'Sending test...' : 'Send me a test'}
              </button>
              <button
                type="button"
                onClick={() => props.onReview(sendable, chosenVenues)}
                disabled={!canSend}
                title={
                  missing.length > 0
                    ? `Add ${missing.join(', ')} first`
                    : sendable.length === 0
                      ? 'Choose at least one venue with an email address'
                      : undefined
                }
                className="rounded-xl bg-slate-900 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:opacity-40"
              >
                Review and send
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Right: the preview */}
      <div className="min-w-0">
        <div className="xl:sticky xl:top-6">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Live preview</p>
          <EmailPreview
            html={rendered.html}
            subject={rendered.subject}
            preheader={rendered.preheader}
            className="xl:max-h-[calc(100dvh-5rem)] xl:overflow-y-auto"
            toolbar={
              <label className="flex items-center gap-2 text-xs text-slate-500">
                Preview as
                <select
                  value={previewKey}
                  onChange={(e) => setPreviewKey(e.target.value)}
                  className="max-w-[220px] rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
                >
                  <option value="auto">First recipient</option>
                  <option value="sample">Sample (Alex, Your venue)</option>
                  {sendable.slice(0, 100).map((r) => (
                    <option key={r.email} value={r.email}>
                      {(r.firstName ?? r.email) + ', ' + r.venueNames[0]}
                    </option>
                  ))}
                </select>
              </label>
            }
          />
        </div>
      </div>
    </div>
  );
}

const inputCls =
  'w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-100';

function SectionHeading({ step, title }: { step: number; title: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
        {step}
      </span>
      <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
    </div>
  );
}

function Field({
  label,
  hint,
  count,
  max,
  children,
}: {
  label: string;
  hint?: string;
  count?: number;
  max?: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-slate-600">{label}</span>
        {count !== undefined && max !== undefined ? (
          <span className={`text-[11px] ${count > max * 0.9 ? 'text-amber-600' : 'text-slate-400'}`}>
            {count}/{max}
          </span>
        ) : null}
      </div>
      {children}
      {hint ? <p className="mt-1 text-[11px] text-slate-500">{hint}</p> : null}
    </div>
  );
}

function TypeCard({
  active,
  onClick,
  title,
  detail,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  detail: string;
  tone?: 'amber';
}) {
  const on = tone === 'amber' ? 'border-amber-500 bg-amber-50/60 ring-2 ring-amber-100' : 'border-blue-500 bg-blue-50/60 ring-2 ring-blue-100';
  const dot = tone === 'amber' ? 'border-amber-600' : 'border-blue-600';
  const dotFill = tone === 'amber' ? 'bg-amber-600' : 'bg-blue-600';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`flex items-start gap-3 rounded-xl border p-4 text-left transition ${active ? on : 'border-slate-200 hover:border-slate-300'}`}
    >
      <span
        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${active ? dot : 'border-slate-300'}`}
      >
        {active ? <span className={`h-2 w-2 rounded-full ${dotFill}`} /> : null}
      </span>
      <span>
        <span className="block text-sm font-semibold text-slate-900">{title}</span>
        <span className="mt-0.5 block text-xs leading-5 text-slate-500">{detail}</span>
      </span>
    </button>
  );
}

function SaveIndicator({ state, savedAt, hasDraft }: { state: SaveState; savedAt: string | null; hasDraft: boolean }) {
  if (state === 'saving') return <span>Saving draft...</span>;
  if (state === 'error') return <span className="text-rose-600">Draft not saved. It will retry when you next edit.</span>;
  if (hasDraft && savedAt) {
    return (
      <span>
        Draft saved{' '}
        {new Date(savedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
      </span>
    );
  }
  return <span>Drafts save automatically as you type.</span>;
}
