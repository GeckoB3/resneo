'use client';

import { useState } from 'react';
import CompliancePreCheckNotice from './CompliancePreCheckNotice';
import BookingComplianceForms, { type BookingComplianceState } from './BookingComplianceForms';

/**
 * The shared "Before you book" card for the public booking flow: composes the
 * compliance pre-check notice and the inline forms into one section. Self-manages
 * whether it has anything to show (so the card chrome + heading appear only when at
 * least one child has content) and reports the collected compliance state up. Used by
 * both the single/multi-service flow and the group flow so they behave identically.
 */
export default function BookingComplianceBlock({
  venueId,
  serviceIds,
  email,
  submittingBooking,
  onChange,
}: {
  venueId: string;
  /** Catalog service id(s) for the booking (one per chosen service / group attendee). */
  serviceIds: string[];
  /** Guest email once known (signed-in prefill or typed in the details form). */
  email?: string | null;
  submittingBooking?: boolean;
  onChange: (state: BookingComplianceState) => void;
}) {
  const [precheckActive, setPrecheckActive] = useState(false);
  const [inlineActive, setInlineActive] = useState(false);
  const [inlineTypeIds, setInlineTypeIds] = useState<string[]>([]);
  const active = precheckActive || inlineActive;

  return (
    <div className={active ? 'mb-4 rounded-xl border border-slate-200 bg-white p-4' : ''}>
      {active && <h4 className="mb-3 text-sm font-semibold text-slate-900">Before you book</h4>}
      <div className="space-y-3">
        <CompliancePreCheckNotice
          venueId={venueId}
          serviceIds={serviceIds}
          email={email}
          suppressTypeIds={inlineTypeIds}
          embedded
          onActiveChange={setPrecheckActive}
        />
        <BookingComplianceForms
          venueId={venueId}
          serviceIds={serviceIds}
          submittingBooking={submittingBooking}
          embedded
          onActiveChange={setInlineActive}
          onChange={(state) => {
            setInlineTypeIds(state.inlineTypeIds);
            onChange(state);
          }}
        />
      </div>
    </div>
  );
}
