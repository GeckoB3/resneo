'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import CompliancePreCheckNotice, { type NoticeRequirement } from './CompliancePreCheckNotice';
import BookingComplianceForms, {
  type BookingComplianceFormsState,
  type BookingInlineForm,
} from './BookingComplianceForms';
import type { ComplianceFormSchema } from '@/lib/compliance/form-schema';

/**
 * The shared "Before you book" card for the public booking flow (plan §3).
 *
 * Owns the one request that decides what compliance the booking needs: for the chosen
 * service(s) and slot, and, once the guest has typed a well-formed email, whether each
 * requirement is already on file for THAT guest. From the answer it renders:
 *   - an inline form for each unmet, client-completable, `inline` requirement, and
 *   - a notice row for anything the guest cannot complete here (staff-only, link, or
 *     a lock period that has already passed).
 * A requirement the guest already satisfies renders nothing, so a returning customer
 * books unimpeded. Before the email is known no form is shown; a one-line placeholder
 * says the check will happen once the email is entered.
 *
 * Used by both the single/multi-service flow and the group flow so they behave identically.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_DEBOUNCE_MS = 500;

export type BookingRequirementState = 'SATISFIED' | 'MISSING' | 'EXPIRED' | 'LOCK_PASSED';

/** One entry of the booking-requirements response. */
export interface BookingRequirementView {
  compliance_type_id: string;
  compliance_type_name: string;
  enforcement: string;
  lock_period_hours: number | null;
  online_collection: string;
  client_online: boolean;
  online_unmet_message: string | null;
  /** Resolved for the typed email; null until an email is known. */
  state: BookingRequirementState | null;
  /** Present only when this guest still needs to complete the form here. */
  form: { version_id: string; form_schema: ComplianceFormSchema } | null;
}

export interface BookingComplianceState extends BookingComplianceFormsState {
  /** True while the requirements for the current service, slot and email are being resolved. */
  resolving: boolean;
}

interface Props {
  venueId: string;
  /** Catalog service id(s) for the booking (one per chosen service / group attendee). */
  serviceIds: string[];
  /**
   * The chosen calendar. On a combined booking page (`venueId` is a collective) the
   * server needs it to find which member venue's requirements apply.
   */
  practitionerId?: string | null;
  /** Guest email as typed (signed-in prefill or the details form); resolved once well-formed. */
  email?: string | null;
  /** The chosen slot, so lock periods and expiry are judged against the actual booking. */
  bookingDate?: string | null;
  bookingTime?: string | null;
  submittingBooking?: boolean;
  /** Bump to re-resolve, e.g. after the server rejected the booking on compliance. */
  refreshKey?: number;
  onChange: (state: BookingComplianceState) => void;
}

const EMPTY_FORMS_STATE: BookingComplianceFormsState = {
  submissions: [],
  draftId: '',
  mandatoryComplete: true,
  inlineTypeIds: [],
};

export default function BookingComplianceBlock({
  venueId,
  serviceIds,
  practitionerId,
  email,
  bookingDate,
  bookingTime,
  submittingBooking,
  refreshKey = 0,
  onChange,
}: Props) {
  const [requirements, setRequirements] = useState<BookingRequirementView[] | null>(null);
  const [identityKnown, setIdentityKnown] = useState(false);
  // The venue the forms and pre-booking uploads belong to. Normally `venueId`; on a
  // combined page the server answers with the owning member venue instead.
  const [formsVenueId, setFormsVenueId] = useState<string>(venueId);
  // The request key the current `requirements` answer; `resolving` is derived from it so
  // no state is written synchronously inside the effect body.
  const [resolvedKey, setResolvedKey] = useState<string | null>(null);
  const [formsState, setFormsState] = useState<BookingComplianceFormsState>(EMPTY_FORMS_STATE);
  const [precheckActive, setPrecheckActive] = useState(false);

  // Stable key so effects only re-run when the actual service set changes.
  const serviceKey = useMemo(() => [...new Set(serviceIds.filter(Boolean))].sort().join(','), [serviceIds]);
  const uniqueServiceIds = useMemo(() => serviceKey.split(',').filter(Boolean), [serviceKey]);

  const trimmedEmail = (email ?? '').trim();
  const identityEmail = EMAIL_RE.test(trimmedEmail) ? trimmedEmail : '';
  const lastEmailRef = useRef(identityEmail);

  const requestKey = JSON.stringify([
    venueId,
    practitionerId ?? '',
    serviceKey,
    identityEmail,
    bookingDate ?? '',
    bookingTime ?? '',
    refreshKey,
  ]);
  const hasServices = Boolean(venueId) && uniqueServiceIds.length > 0;
  const resolving = hasServices && resolvedKey !== requestKey;

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    // Debounce only when the email is what changed; a service or slot change resolves at once.
    const delay = identityEmail !== lastEmailRef.current ? EMAIL_DEBOUNCE_MS : 0;
    lastEmailRef.current = identityEmail;
    const timer = setTimeout(() => {
      (async () => {
        if (!hasServices) {
          if (!cancelled) {
            setRequirements(null);
            setIdentityKnown(false);
            setResolvedKey(requestKey);
          }
          return;
        }
        try {
          const res = await fetch('/api/public/compliance/booking-requirements', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              venue_id: venueId,
              service_ids: uniqueServiceIds,
              practitioner_id: practitionerId || undefined,
              email: identityEmail || undefined,
              booking_date: bookingDate || undefined,
              booking_time: bookingTime || undefined,
            }),
            signal: controller.signal,
          });
          if (cancelled) return;
          if (!res.ok) {
            // Fail quiet: the server re-checks at booking time, so a lookup failure must
            // never trap the guest on this step.
            setRequirements(null);
            setIdentityKnown(false);
            setResolvedKey(requestKey);
            return;
          }
          const data = (await res.json()) as {
            identity_known?: boolean;
            requirements?: BookingRequirementView[];
            venue_id?: string;
          };
          if (cancelled) return;
          setRequirements(data.requirements ?? []);
          setIdentityKnown(Boolean(data.identity_known));
          setFormsVenueId(data.venue_id || venueId);
          setResolvedKey(requestKey);
        } catch {
          if (!cancelled) {
            setRequirements(null);
            setIdentityKnown(false);
            setResolvedKey(requestKey);
          }
        }
      })();
    }, delay);
    return () => {
      cancelled = true;
      controller.abort();
      clearTimeout(timer);
    };
    // `requestKey` folds in every input; `uniqueServiceIds` is derived from `serviceKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  const forms = useMemo<BookingInlineForm[]>(
    () =>
      (requirements ?? [])
        .filter((r): r is BookingRequirementView & { form: NonNullable<BookingRequirementView['form']> } => r.form !== null)
        .map((r) => ({
          compliance_type_id: r.compliance_type_id,
          compliance_type_name: r.compliance_type_name,
          enforcement: r.enforcement,
          lock_period_hours: r.lock_period_hours,
          version_id: r.form.version_id,
          form_schema: r.form.form_schema,
        })),
    [requirements],
  );

  // Rows for the notice: whatever is not being collected as a form here. An inline,
  // client-completable requirement is shown as a row only once it is known the guest
  // cannot satisfy it online any more (the lock period has passed); a satisfied one
  // renders nothing at all.
  const noticeRequirements = useMemo<NoticeRequirement[]>(
    () =>
      (requirements ?? [])
        .filter((r) => {
          const collectedInline = r.online_collection === 'inline' && r.client_online;
          if (!collectedInline) return true;
          return r.state === 'LOCK_PASSED';
        })
        .map((r) => ({
          compliance_type_id: r.compliance_type_id,
          compliance_type_name: r.compliance_type_name,
          enforcement: r.enforcement,
          online_unmet_message: r.online_unmet_message,
          client_online: r.client_online,
          state: r.state,
        })),
    [requirements],
  );

  const awaitingIdentity =
    !identityKnown && (requirements ?? []).some((r) => r.online_collection === 'inline' && r.client_online);

  useEffect(() => {
    onChange({ ...formsState, resolving });
    // onChange is provided fresh each render by the parent; depending on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formsState, resolving]);

  const inlineActive = forms.length > 0 && Boolean(formsState.draftId);
  const active = precheckActive || inlineActive || awaitingIdentity;

  return (
    <div className={active ? 'mb-4 rounded-xl border border-slate-200 bg-white p-4' : ''}>
      {active && <h4 className="mb-3 text-sm font-semibold text-slate-900">Before you book</h4>}
      <div className="space-y-3">
        <CompliancePreCheckNotice requirements={noticeRequirements} embedded onActiveChange={setPrecheckActive} />
        {awaitingIdentity && (
          <p className="text-xs text-slate-500" data-testid="compliance-awaiting-identity">
            {identityEmail && resolving
              ? 'Checking whether a form is needed for this booking…'
              : 'Some services need a short form. We will check whether one is needed once you have entered your email.'}
          </p>
        )}
        <BookingComplianceForms
          venueId={formsVenueId}
          forms={forms}
          submittingBooking={submittingBooking}
          onChange={setFormsState}
        />
      </div>
    </div>
  );
}
