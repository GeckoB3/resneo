'use client';

import { useState } from 'react';
import { Dialog } from '@/components/ui/primitives/Dialog';
import { AUDIENCE_SEGMENT_LABELS, type AudienceSegment, type AudienceVenue } from '@/lib/platform/broadcast-audience';

export type SendPhase =
  | { kind: 'review' }
  | { kind: 'sending'; sent: number; failed: number; total: number }
  | { kind: 'done'; sent: number; failed: number; skipped: number; pending: number; stoppedEarly: boolean }
  /** `final`: the send was claimed on the server, so it must not be offered again from here. */
  | { kind: 'error'; message: string; final?: boolean };

interface Props {
  open: boolean;
  subject: string;
  important: boolean;
  recipientCount: number;
  venues: AudienceVenue[];
  skipped: number;
  phase: SendPhase;
  onCancel: () => void;
  onConfirm: () => void;
  onViewReport: () => void;
}

export function SendDialog(props: Props) {
  const { open, phase } = props;
  // The parent remounts the dialog (key) each time it opens, so this starts unticked every time.
  const [ack, setAck] = useState(false);

  const bySegment = new Map<AudienceSegment, number>();
  for (const v of props.venues) bySegment.set(v.segment, (bySegment.get(v.segment) ?? 0) + 1);
  const people = `${props.recipientCount} ${props.recipientCount === 1 ? 'person' : 'people'}`;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Closing mid-send would hide progress; the send itself carries on server side regardless.
        if (!next && phase.kind !== 'sending') props.onCancel();
      }}
      title="Send email"
      hideHeader
      showClose={false}
      contentClassName="max-w-lg"
    >
        {phase.kind === 'error' && phase.final ? (
          <div className="px-6 py-8 text-center">
            <h2 className="text-lg font-semibold text-slate-900">Sending was interrupted</h2>
            <p className="mt-2 text-sm text-slate-600">{phase.message}</p>
            <p className="mt-2 text-xs text-slate-500">
              The delivery report shows who has it. Finishing from there never emails anyone twice.
            </p>
            <div className="mt-6 flex justify-center gap-2">
              <button
                type="button"
                onClick={props.onCancel}
                className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
              >
                Close
              </button>
              <button
                type="button"
                onClick={props.onViewReport}
                className="rounded-xl bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                View delivery report
              </button>
            </div>
          </div>
        ) : phase.kind === 'review' || phase.kind === 'error' ? (
          <>
            <div className="border-b border-slate-100 px-6 py-5">
              <h2 className="text-lg font-semibold text-slate-900">Ready to send?</h2>
              <p className="mt-1 text-sm text-slate-500">Once it goes, it can&apos;t be recalled.</p>
            </div>
            <div className="space-y-4 px-6 py-5 text-sm">
              <Row label="Subject">
                <span className="font-medium text-slate-900">{props.subject}</span>
              </Row>
              <Row label="Recipients">
                <span className="font-semibold text-slate-900">{people}</span>
                <span className="text-slate-500">
                  {' '}
                  at {props.venues.length} {props.venues.length === 1 ? 'venue' : 'venues'}
                </span>
                <span className="mt-1.5 flex flex-wrap gap-1.5">
                  {[...bySegment.entries()].map(([s, n]) => (
                    <span key={s} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                      {AUDIENCE_SEGMENT_LABELS[s]}: {n}
                    </span>
                  ))}
                </span>
                {props.skipped > 0 ? (
                  <span className="mt-1.5 block text-xs text-slate-500">
                    {props.skipped} unsubscribed {props.skipped === 1 ? 'person' : 'people'} will be skipped.
                  </span>
                ) : null}
              </Row>
              <Row label="Type">
                {props.important ? (
                  <span className="font-medium text-amber-800">Important account notice (goes to everyone)</span>
                ) : (
                  <span className="text-slate-700">Product news (with an unsubscribe link)</span>
                )}
              </Row>
              <Row label="From">
                <span className="text-slate-700">ResNeo &lt;hello@resneo.com&gt;, replies come back to hello@</span>
              </Row>

              {phase.kind === 'error' ? (
                <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-800">{phase.message}</p>
              ) : null}

              <label className="flex cursor-pointer items-start gap-2.5 rounded-xl bg-slate-50 px-3 py-3">
                <input
                  type="checkbox"
                  checked={ack}
                  onChange={(e) => setAck(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600"
                />
                <span className="text-slate-700">
                  I&apos;ve checked the preview and sent myself a test, and I want to email {people} now.
                </span>
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-6 py-4">
              <button
                type="button"
                onClick={props.onCancel}
                className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={props.onConfirm}
                disabled={!ack}
                className="rounded-xl bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-40"
              >
                Send to {people}
              </button>
            </div>
          </>
        ) : phase.kind === 'sending' ? (
          <div className="px-6 py-8 text-center">
            <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-slate-900" />
            <h2 className="mt-4 text-lg font-semibold text-slate-900">Sending...</h2>
            <p className="mt-1 text-sm text-slate-500">
              {phase.sent + phase.failed} of {phase.total} done. Keep this tab open until it finishes.
            </p>
            <div className="mx-auto mt-4 h-2 w-full max-w-xs overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-slate-900 transition-all"
                style={{ width: `${phase.total > 0 ? Math.round(((phase.sent + phase.failed) / phase.total) * 100) : 0}%` }}
              />
            </div>
          </div>
        ) : (
          <div className="px-6 py-8 text-center">
            <div
              className={`mx-auto flex h-12 w-12 items-center justify-center rounded-full ${
                phase.failed > 0 || phase.pending > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
              }`}
            >
              <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden>
                {phase.failed > 0 || phase.pending > 0 ? (
                  <path strokeLinecap="round" d="M12 8v5m0 3.5v.01" />
                ) : (
                  <path strokeLinecap="round" strokeLinejoin="round" d="m5 12.5 4.5 4.5L19 7.5" />
                )}
              </svg>
            </div>
            <h2 className="mt-4 text-lg font-semibold text-slate-900">
              {phase.failed > 0 || phase.pending > 0 ? 'Sent, with some to finish' : 'Your email is on its way'}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Sent to {phase.sent} {phase.sent === 1 ? 'person' : 'people'}.
              {phase.skipped > 0 ? ` ${phase.skipped} skipped (unsubscribed).` : ''}
              {phase.failed > 0 ? ` ${phase.failed} failed.` : ''}
              {phase.pending > 0 ? ` ${phase.pending} still to send.` : ''}
            </p>
            {phase.failed > 0 || phase.pending > 0 ? (
              <p className="mt-2 text-xs text-slate-500">
                Open the delivery report to see why, and to finish or retry. Nobody who already got it will get it
                twice.
              </p>
            ) : null}
            <div className="mt-6 flex justify-center gap-2">
              <button
                type="button"
                onClick={props.onCancel}
                className="rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100"
              >
                Close
              </button>
              <button
                type="button"
                onClick={props.onViewReport}
                className="rounded-xl bg-slate-900 px-5 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                View delivery report
              </button>
            </div>
          </div>
        )}
    </Dialog>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[88px_1fr] gap-3">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}
