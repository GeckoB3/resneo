'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  emptyBroadcastContent,
  normaliseBroadcastContent,
  type BroadcastContent,
} from '@/lib/platform/broadcast-email';
import type { AudienceVenue, BroadcastRecipient } from '@/lib/platform/broadcast-audience';
import { Composer, type SaveState } from './Composer';
import { HistoryView } from './HistoryView';
import { SendDialog, type SendPhase } from './SendDialog';
import {
  apiJson,
  type BroadcastSummary,
  type ComposerDraft,
  type StarterTemplate,
} from './contact-users-shared';

function emptyDraft(): ComposerDraft {
  return {
    subject: '',
    content: emptyBroadcastContent(),
    important: false,
    audienceMode: 'all',
    selectedVenueIds: [],
  };
}

function isBlank(d: ComposerDraft): boolean {
  return !d.subject.trim() && !d.content.headline.trim() && !d.content.intro.trim() && !d.content.body.trim();
}

function draftPayload(d: ComposerDraft) {
  return {
    subject: d.subject,
    content: d.content,
    important: d.important,
    audience: d.audienceMode === 'all' ? { mode: 'all' } : { mode: 'selected', venue_ids: d.selectedVenueIds },
  };
}

function draftFromRow(b: BroadcastSummary): ComposerDraft {
  const a = (b.audience ?? {}) as { mode?: string; venue_ids?: unknown };
  const selected = a.mode === 'selected' && Array.isArray(a.venue_ids) ? (a.venue_ids as string[]) : [];
  return {
    subject: b.subject ?? '',
    content: normaliseBroadcastContent(b.content),
    important: b.important,
    audienceMode: a.mode === 'selected' ? 'selected' : 'all',
    selectedVenueIds: selected,
  };
}

const AUTOSAVE_MS = 1200;

export function ContactUsersPageClient() {
  const [tab, setTab] = useState<'compose' | 'history'>('compose');

  // Audience
  const [audience, setAudience] = useState<AudienceVenue[] | null>(null);
  const [audienceLoading, setAudienceLoading] = useState(true);
  const [audienceError, setAudienceError] = useState<string | null>(null);

  // Composer + autosave
  const [draft, setDraft] = useState<ComposerDraft>(emptyDraft);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const latestDraft = useRef<ComposerDraft>(draft);
  const draftIdRef = useRef<string | null>(null);
  const dirty = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const saveChain = useRef<Promise<void>>(Promise.resolve());

  // History
  const [broadcasts, setBroadcasts] = useState<BroadcastSummary[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resumingId, setResumingId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  // Test + send
  const [testState, setTestState] = useState<{ busy: boolean; message: string | null; error: boolean }>({
    busy: false,
    message: null,
    error: false,
  });
  const [dialog, setDialog] = useState<{
    open: boolean;
    key: number;
    recipients: BroadcastRecipient[];
    venues: AudienceVenue[];
    skipped: number;
    phase: SendPhase;
    broadcastId: string | null;
  }>({ open: false, key: 0, recipients: [], venues: [], skipped: 0, phase: { kind: 'review' }, broadcastId: null });

  const loadAudience = useCallback(async () => {
    setAudienceLoading(true);
    try {
      const data = await apiJson<{ venues: AudienceVenue[] }>('/api/platform/contact-users/audience');
      setAudience(data.venues);
      setAudienceError(null);
    } catch (e) {
      setAudienceError(e instanceof Error ? e.message : 'Could not load venues.');
    } finally {
      setAudienceLoading(false);
    }
  }, []);

  const loadHistory = useCallback(async () => {
    try {
      const data = await apiJson<{ broadcasts: BroadcastSummary[] }>('/api/platform/contact-users/broadcasts');
      setBroadcasts(data.broadcasts);
      setHistoryError(null);
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : 'Could not load emails.');
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAudience();
    void loadHistory();
  }, [loadAudience, loadHistory]);

  // ---- autosave ---------------------------------------------------------------------------

  const flush = useCallback((): Promise<void> => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    saveChain.current = saveChain.current.then(async () => {
      if (!dirty.current) return;
      const snapshot = latestDraft.current;
      if (!draftIdRef.current && isBlank(snapshot)) {
        dirty.current = false;
        return;
      }
      dirty.current = false;
      setSaveState('saving');
      try {
        const body = JSON.stringify(draftPayload(snapshot));
        if (draftIdRef.current) {
          await apiJson(`/api/platform/contact-users/broadcasts/${draftIdRef.current}`, { method: 'PATCH', body });
        } else {
          const created = await apiJson<{ broadcast: BroadcastSummary }>('/api/platform/contact-users/broadcasts', {
            method: 'POST',
            body,
          });
          draftIdRef.current = created.broadcast.id;
          setDraftId(created.broadcast.id);
        }
        setSaveState('saved');
        setSavedAt(new Date().toISOString());
      } catch (e) {
        dirty.current = true;
        const status = (e as { status?: number }).status;
        if (status === 409) {
          // Sent from another tab: keep the text, but save any further edits as a fresh draft.
          draftIdRef.current = null;
          setDraftId(null);
        }
        setSaveState('error');
      }
    });
    return saveChain.current;
  }, []);

  const scheduleSave = useCallback(() => {
    dirty.current = true;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void flush(), AUTOSAVE_MS);
  }, [flush]);

  useEffect(() => {
    function beforeUnload(e: BeforeUnloadEvent) {
      if (dirty.current && !isBlank(latestDraft.current)) {
        void flush();
        e.preventDefault();
      }
    }
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    };
  }, [flush]);

  const setComposer = useCallback((next: ComposerDraft, id: string | null, markDirty: boolean) => {
    latestDraft.current = next;
    draftIdRef.current = id;
    dirty.current = markDirty;
    setDraft(next);
    setDraftId(id);
    setSaveState('idle');
    setSavedAt(null);
    setTestState({ busy: false, message: null, error: false });
  }, []);

  const onChange = useCallback(
    (patch: Partial<ComposerDraft>) => {
      const next = { ...latestDraft.current, ...patch };
      latestDraft.current = next;
      setDraft(next);
      scheduleSave();
    },
    [scheduleSave],
  );

  const onContentChange = useCallback(
    (patch: Partial<BroadcastContent>) => {
      const next = { ...latestDraft.current, content: { ...latestDraft.current.content, ...patch } };
      latestDraft.current = next;
      setDraft(next);
      scheduleSave();
    },
    [scheduleSave],
  );

  // ---- actions ------------------------------------------------------------------------------

  function applyTemplate(t: StarterTemplate) {
    onChange({
      subject: t.subject,
      important: t.important ?? false,
      content: { ...latestDraft.current.content, ...t.content },
    });
  }

  async function startNew() {
    await flush();
    setComposer(emptyDraft(), null, false);
    void loadHistory();
  }

  async function deleteDraft() {
    const id = draftIdRef.current;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    await saveChain.current;
    if (id) {
      try {
        await apiJson(`/api/platform/contact-users/broadcasts/${id}`, { method: 'DELETE' });
      } catch (e) {
        setTestState({ busy: false, message: e instanceof Error ? e.message : 'Could not delete.', error: true });
        return;
      }
    }
    setComposer(emptyDraft(), null, false);
    void loadHistory();
  }

  async function sendTest(sample: { firstName: string | null; venueName: string }) {
    setTestState({ busy: true, message: null, error: false });
    try {
      const res = await apiJson<{ to: string }>('/api/platform/contact-users/test', {
        method: 'POST',
        body: JSON.stringify({ draft: draftPayload(latestDraft.current), sample }),
      });
      setTestState({ busy: false, message: `Test sent to ${res.to}. Check your inbox.`, error: false });
    } catch (e) {
      setTestState({ busy: false, message: e instanceof Error ? e.message : 'Test failed.', error: true });
    }
  }

  function openReview(recipients: BroadcastRecipient[], venues: AudienceVenue[]) {
    const all = venues.flatMap((v) => v.contacts);
    const uniqueOptedOut = new Set(all.filter((c) => c.optedOut).map((c) => c.email));
    setDialog((d) => ({
      open: true,
      key: d.key + 1,
      recipients,
      venues,
      skipped: latestDraft.current.important ? 0 : uniqueOptedOut.size,
      phase: { kind: 'review' },
      broadcastId: null,
    }));
  }

  async function confirmSend() {
    const expected = dialog.recipients.length;
    setDialog((d) => ({ ...d, phase: { kind: 'sending', sent: 0, failed: 0, total: expected } }));

    dirty.current = true;
    await flush();
    const id = draftIdRef.current;
    if (!id) {
      setDialog((d) => ({ ...d, phase: { kind: 'error', message: 'The draft could not be saved. Try again.' } }));
      return;
    }

    const poll = window.setInterval(async () => {
      try {
        const data = await apiJson<{ broadcast: BroadcastSummary }>(`/api/platform/contact-users/broadcasts/${id}`);
        setDialog((d) =>
          d.phase.kind === 'sending'
            ? {
                ...d,
                phase: {
                  kind: 'sending',
                  sent: data.broadcast.sent_count,
                  failed: data.broadcast.failed_count,
                  total: d.phase.total,
                },
              }
            : d,
        );
      } catch {
        // progress is cosmetic
      }
    }, 2000);

    try {
      const res = await apiJson<{
        result: { sent: number; failed: number; skipped: number; pending: number; stoppedEarly: boolean };
      }>(`/api/platform/contact-users/broadcasts/${id}/send`, {
        method: 'POST',
        body: JSON.stringify({ draft: draftPayload(latestDraft.current), expected_recipient_count: expected }),
      });
      setDialog((d) => ({ ...d, broadcastId: id, phase: { kind: 'done', ...res.result } }));
      setComposer(emptyDraft(), null, false);
    } catch (e) {
      const status = (e as { status?: number }).status;
      const message = e instanceof Error ? e.message : 'Sending failed.';
      if (status === 409) void loadAudience();
      if (status === 500 || status === undefined) {
        // The send was claimed and may have partly gone out: never offer it again as a draft here.
        setComposer(emptyDraft(), null, false);
        setDialog((d) => ({ ...d, broadcastId: id, phase: { kind: 'error', message, final: true } }));
        return;
      }
      setDialog((d) => ({ ...d, phase: { kind: 'error', message } }));
    } finally {
      window.clearInterval(poll);
      void loadHistory();
    }
  }

  async function openFromHistory(b: BroadcastSummary) {
    await flush();
    setComposer(draftFromRow(b), b.id, false);
    setSelectedId(null);
    setTab('compose');
    window.scrollTo({ top: 0 });
  }

  async function duplicate(b: BroadcastSummary) {
    await flush();
    setComposer(draftFromRow(b), null, true);
    scheduleSave();
    setSelectedId(null);
    setTab('compose');
    window.scrollTo({ top: 0 });
  }

  async function deleteFromHistory(b: BroadcastSummary) {
    try {
      await apiJson(`/api/platform/contact-users/broadcasts/${b.id}`, { method: 'DELETE' });
      if (draftIdRef.current === b.id) setComposer(emptyDraft(), null, false);
      setSelectedId(null);
      await loadHistory();
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : 'Could not delete the draft.');
    }
  }

  async function resume(b: BroadcastSummary) {
    setResumingId(b.id);
    try {
      await apiJson(`/api/platform/contact-users/broadcasts/${b.id}/send`, {
        method: 'POST',
        body: JSON.stringify({ resume: true }),
      });
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : 'Could not resume sending.');
    } finally {
      setResumingId(null);
      await loadHistory();
      setRefreshKey((k) => k + 1);
    }
  }

  async function switchTab(next: 'compose' | 'history') {
    if (next === 'history') {
      await flush();
      void loadHistory();
    }
    setTab(next);
  }

  const draftCount = broadcasts.filter((b) => b.status === 'draft').length;

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Contact Users</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            Email the people who run subscribing venues about new features and important news. Every email goes out
            in the ResNeo brand from hello@resneo.com, and replies come straight back to the team.
          </p>
        </div>
        <div className="inline-flex rounded-xl bg-slate-200/70 p-1 text-sm font-semibold">
          <button
            type="button"
            onClick={() => void switchTab('compose')}
            className={`rounded-lg px-4 py-1.5 ${tab === 'compose' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Compose
          </button>
          <button
            type="button"
            onClick={() => void switchTab('history')}
            className={`rounded-lg px-4 py-1.5 ${tab === 'history' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
          >
            Sent and drafts
            {draftCount > 0 ? (
              <span className="ml-1.5 rounded-full bg-slate-900 px-1.5 py-0.5 text-[10px] text-white">{draftCount}</span>
            ) : null}
          </button>
        </div>
      </div>

      {tab === 'compose' ? (
        <Composer
          draft={draft}
          onChange={onChange}
          onContentChange={onContentChange}
          audience={audience}
          audienceLoading={audienceLoading}
          audienceError={audienceError}
          onReloadAudience={() => void loadAudience()}
          saveState={saveState}
          savedAt={savedAt}
          hasDraftRow={draftId !== null}
          onApplyTemplate={applyTemplate}
          onNew={() => void startNew()}
          onDeleteDraft={() => void deleteDraft()}
          onSendTest={(s) => void sendTest(s)}
          testState={testState}
          onReview={openReview}
        />
      ) : (
        <HistoryView
          broadcasts={broadcasts}
          loading={historyLoading}
          error={historyError}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onEdit={(b) => void openFromHistory(b)}
          onDuplicate={(b) => void duplicate(b)}
          onDelete={deleteFromHistory}
          onResume={resume}
          resumingId={resumingId}
          refreshKey={refreshKey}
        />
      )}

      <SendDialog
        key={dialog.key}
        open={dialog.open}
        subject={draft.subject || broadcasts.find((b) => b.id === dialog.broadcastId)?.subject || ''}
        important={draft.important}
        recipientCount={dialog.recipients.length}
        venues={dialog.venues}
        skipped={dialog.skipped}
        phase={dialog.phase}
        onCancel={() => setDialog((d) => ({ ...d, open: false }))}
        onConfirm={() => void confirmSend()}
        onViewReport={() => {
          const id = dialog.broadcastId;
          setDialog((d) => ({ ...d, open: false }));
          setSelectedId(id);
          setTab('history');
        }}
      />
    </div>
  );
}
