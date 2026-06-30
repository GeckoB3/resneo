'use client';

import { useEffect, useMemo, useState } from 'react';

/**
 * Public booking-page compliance pre-check (improvement plan Phase 2, gap G4).
 *
 * Self-contained: given the venue + chosen service(s) it queries the public
 * pre-check endpoints and surfaces, BEFORE the guest submits, what compliance
 * records the booking needs and (once an email is known) whether they're already
 * on file. This sets expectations early (spec §5.1.1) so a `block_online`
 * requirement never surfaces as a raw 409 at submit time.
 *
 * Drops into any booking flow's details step. Renders nothing when the service
 * has no requirements, the feature is off, or the lookups fail (fail-quiet).
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface PreCheckRequirement {
  compliance_type_id: string;
  compliance_type_name: string;
  enforcement: string;
  lock_period_hours: number | null;
  online_unmet_message?: string | null;
  /** Whether the client can complete this themselves online (vs in-venue only). */
  client_online?: boolean;
}

type PreCheckState = 'SATISFIED' | 'MISSING' | 'EXPIRED' | 'LOCK_PASSED';

interface PreCheckResolved {
  compliance_type_id: string;
  compliance_type_name: string;
  enforcement: string;
  state: PreCheckState;
}

/** A requirement is online-blocking when an unmet record stops an online booking. */
function isBlocking(enforcement: string): boolean {
  return enforcement === 'block_online' || enforcement === 'block_all';
}

/** Worst-wins ranking so a type required by two services shows its most severe state. */
const STATE_RANK: Record<PreCheckState, number> = { SATISFIED: 0, LOCK_PASSED: 1, EXPIRED: 2, MISSING: 3 };

interface Props {
  venueId: string;
  /** Catalog service id(s) for the booking (one per chosen service / multi-service segment). */
  serviceIds: string[];
  /** Guest email once known (signed-in prefill or typed in the details form). */
  email?: string | null;
  /** Type ids being collected inline in the booking flow — suppressed here to avoid duplication. */
  suppressTypeIds?: string[];
  className?: string;
}

export default function CompliancePreCheckNotice({ venueId, serviceIds, email, suppressTypeIds, className }: Props) {
  const [requirements, setRequirements] = useState<PreCheckRequirement[] | null>(null);
  const [resolved, setResolved] = useState<Map<string, PreCheckState> | null>(null);

  // Stable key so effects only re-run when the actual service set changes.
  const serviceKey = useMemo(() => [...new Set(serviceIds.filter(Boolean))].sort().join(','), [serviceIds]);
  const uniqueServiceIds = useMemo(() => serviceKey.split(',').filter(Boolean), [serviceKey]);

  // 1) GET requirements for the chosen service(s) — no identity needed. All state
  // writes happen inside the async task (never synchronously in the effect body).
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    (async () => {
      if (!venueId || uniqueServiceIds.length === 0) {
        if (!cancelled) setRequirements(null);
        return;
      }
      try {
        const lists = await Promise.all(
          uniqueServiceIds.map(async (serviceId) => {
            const res = await fetch(
              `/api/public/compliance/pre-check?venue_id=${encodeURIComponent(venueId)}&service_id=${encodeURIComponent(serviceId)}`,
              { signal: controller.signal },
            );
            if (!res.ok) return [] as PreCheckRequirement[];
            const data = (await res.json()) as { requirements?: PreCheckRequirement[] };
            return data.requirements ?? [];
          }),
        );
        if (cancelled) return;
        const byType = new Map<string, PreCheckRequirement>();
        for (const req of lists.flat()) {
          if (!byType.has(req.compliance_type_id)) byType.set(req.compliance_type_id, req);
        }
        setRequirements([...byType.values()]);
      } catch {
        if (!cancelled) setRequirements(null);
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [venueId, serviceKey, uniqueServiceIds]);

  // 2) POST resolve against the guest's email (debounced) once we have one + known
  // requirements. The reset + fetch both run inside the timer callback, so no state
  // is written synchronously during the effect body.
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const timer = setTimeout(() => {
      const trimmed = (email ?? '').trim();
      if (!venueId || uniqueServiceIds.length === 0 || !requirements || requirements.length === 0 || !EMAIL_RE.test(trimmed)) {
        if (!cancelled) setResolved(null);
        return;
      }
      (async () => {
        try {
          const lists = await Promise.all(
            uniqueServiceIds.map(async (serviceId) => {
              const res = await fetch('/api/public/compliance/pre-check', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ venue_id: venueId, service_id: serviceId, email: trimmed }),
                signal: controller.signal,
              });
              if (!res.ok) return [] as PreCheckResolved[];
              const data = (await res.json()) as { requirements?: PreCheckResolved[] };
              return data.requirements ?? [];
            }),
          );
          if (cancelled) return;
          const byType = new Map<string, PreCheckState>();
          for (const r of lists.flat()) {
            const prev = byType.get(r.compliance_type_id);
            if (prev === undefined || STATE_RANK[r.state] > STATE_RANK[prev]) {
              byType.set(r.compliance_type_id, r.state);
            }
          }
          setResolved(byType);
        } catch {
          if (!cancelled) setResolved(null);
        }
      })();
    }, 500);
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
  }, [venueId, serviceKey, uniqueServiceIds, requirements, email]);

  // Only requirements the guest can act on are shown publicly: blocking ones (must
  // be on file to book) and warn_client (soft heads-up). warn_staff is staff-only.
  const suppress = useMemo(() => new Set(suppressTypeIds ?? []), [suppressTypeIds]);
  const visible = useMemo(
    () =>
      (requirements ?? []).filter(
        (r) =>
          (isBlocking(r.enforcement) || r.enforcement === 'warn_client') && !suppress.has(r.compliance_type_id),
      ),
    [requirements, suppress],
  );

  if (uniqueServiceIds.length === 0 || visible.length === 0) return null;

  type Row = { name: string; tone: 'ok' | 'warn' | 'block'; detail: string };
  const rows: Row[] = visible.map((req) => {
    const state = resolved?.get(req.compliance_type_id) ?? null;
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
          detail: 'Needs to be completed ahead of your visit, and there may not be enough time to do this online. Please contact the venue.',
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
        // different email/phone last time (U13) and so reads as having nothing on file.
        return {
          name: req.compliance_type_name,
          tone: 'block',
          detail:
            'This needs to be on file before you can book online. Please contact the venue to arrange it. If you’ve done this with us before, you may have used a different email or phone number, so it’s worth checking with them.',
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

  const hasBlock = rows.some((r) => r.tone === 'block' && r.detail !== 'Already on file, nothing to do.');
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
      className={`mb-4 rounded-xl border ${palette.border} ${palette.bg} p-3.5 ${className ?? ''}`}
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
