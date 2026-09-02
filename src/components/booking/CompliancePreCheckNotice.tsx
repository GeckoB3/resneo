'use client';

import { useEffect, useMemo } from 'react';

/**
 * Public booking-page compliance notice (improvement plan Phase 2, gap G4; plan §3).
 *
 * Presentational: the parent block resolves the guest's requirements once (service,
 * slot and typed email) and hands the rows in. This renders, BEFORE the guest submits,
 * what compliance records the booking needs that cannot be completed inline and (once
 * an email is known) whether they are already on file, so a `block_online`
 * requirement never surfaces as a raw 409 at submit time (spec §5.1.1).
 */

export type NoticeRequirementState = 'SATISFIED' | 'MISSING' | 'EXPIRED' | 'LOCK_PASSED';

export interface NoticeRequirement {
  compliance_type_id: string;
  compliance_type_name: string;
  enforcement: string;
  online_unmet_message?: string | null;
  /** Whether the client can complete this themselves online (vs in-venue only). */
  client_online?: boolean;
  /** Resolved for the typed email; null until an email is known. */
  state: NoticeRequirementState | null;
}

/** A requirement is online-blocking when an unmet record stops an online booking. */
function isBlocking(enforcement: string): boolean {
  return enforcement === 'block_online' || enforcement === 'block_all';
}

interface Props {
  /** Requirements to show here (the parent has already excluded the ones rendered as forms). */
  requirements: NoticeRequirement[];
  /** Drop the standalone card chrome so the host can group this inside one section. */
  embedded?: boolean;
  /** Reports whether this notice currently renders anything (for the host's shared wrapper). */
  onActiveChange?: (active: boolean) => void;
  className?: string;
}

export default function CompliancePreCheckNotice({ requirements, embedded, onActiveChange, className }: Props) {
  // Only requirements the guest can act on are shown publicly: blocking ones (must
  // be on file to book) and warn_client (soft heads-up). warn_staff is staff-only.
  const visible = useMemo(
    () => requirements.filter((r) => isBlocking(r.enforcement) || r.enforcement === 'warn_client'),
    [requirements],
  );

  const active = visible.length > 0;
  useEffect(() => {
    onActiveChange?.(active);
  }, [active, onActiveChange]);

  if (!active) return null;

  type Row = { name: string; tone: 'ok' | 'warn' | 'block'; detail: string };
  const rows: Row[] = visible.map((req) => {
    const state = req.state;
    const blocking = isBlocking(req.enforcement);
    if (state === 'SATISFIED') {
      return { name: req.compliance_type_name, tone: 'ok', detail: 'Already on file, nothing to do.' };
    }
    if (blocking) {
      // Venue's own guidance wins when set (e.g. "Please book a patch test first").
      if (req.online_unmet_message && req.online_unmet_message.trim()) {
        return { name: req.compliance_type_name, tone: 'block', detail: req.online_unmet_message.trim() };
      }
      if (state === 'LOCK_PASSED') {
        return {
          name: req.compliance_type_name,
          tone: 'block',
          detail:
            'Needs to be completed ahead of your visit, and there may not be enough time to do this online. Please contact the venue.',
        };
      }
      if (state === 'EXPIRED') {
        return {
          name: req.compliance_type_name,
          tone: 'block',
          detail: 'Your previous record has expired. Please contact the venue to renew it before you book online.',
        };
      }
      if (state === 'MISSING') {
        // Actionable default (U12) plus a nudge for the returning client who used a
        // different email last time (U13) and so reads as having nothing on file.
        return {
          name: req.compliance_type_name,
          tone: 'block',
          detail:
            'This needs to be on file before you can book online. Please contact the venue to arrange it. If you’ve done this with us before, you may have used a different email address, so it’s worth checking with them.',
        };
      }
      // Not yet resolved (no email entered yet): keep it short until we know more.
      return {
        name: req.compliance_type_name,
        tone: 'block',
        detail: 'This needs to be on file before you can book online. Please contact the venue to arrange it.',
      };
    }
    // warn_client (non-blocking): the booking proceeds and the form follows.
    if (req.client_online === false) {
      // The client cannot complete this online (e.g. an in-venue patch test); don't promise a link.
      return {
        name: req.compliance_type_name,
        tone: 'warn',
        detail: 'Your team will complete this with you at your appointment.',
      };
    }
    return {
      name: req.compliance_type_name,
      tone: 'warn',
      detail:
        state === 'EXPIRED'
          ? 'Your previous record has expired. We’ll email you a secure link to renew it.'
          : 'We’ll email you a secure link to complete this before your visit.',
    };
  });

  const hasBlock = rows.some((r) => r.tone === 'block');
  const hasWarn = rows.some((r) => r.tone === 'warn');
  const allOk = rows.every((r) => r.tone === 'ok');

  const palette = hasBlock
    ? { border: 'border-red-200', bg: 'bg-red-50', heading: 'text-red-900', body: 'text-red-800' }
    : hasWarn
      ? { border: 'border-amber-200', bg: 'bg-amber-50', heading: 'text-amber-900', body: 'text-amber-800' }
      : { border: 'border-emerald-200', bg: 'bg-emerald-50', heading: 'text-emerald-900', body: 'text-emerald-800' };

  const heading = hasBlock
    ? 'Before you can book online'
    : allOk
      ? 'Compliance: you’re all set'
      : 'Forms needed for this booking';

  return (
    <div
      className={`${embedded ? '' : 'mb-4'} rounded-xl border ${palette.border} ${palette.bg} p-3.5 ${className ?? ''}`}
      role={hasBlock ? 'alert' : 'status'}
    >
      <h4 className={`mb-2 text-xs font-semibold uppercase tracking-wider ${palette.heading}`}>{heading}</h4>
      <ul className="space-y-1.5">
        {rows.map((row, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <span aria-hidden className="mt-0.5 shrink-0">
              {row.tone === 'ok' ? '✓' : row.tone === 'block' ? '⚠' : '•'}
            </span>
            <span className={palette.body}>
              <span className="font-medium">{row.name}</span>
              {': '}
              {row.detail}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
