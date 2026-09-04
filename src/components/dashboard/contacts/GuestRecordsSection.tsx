'use client';

import { ContactDocumentsSection } from '@/components/dashboard/contacts/ContactDocumentsSection';

/**
 * The body of a "Records" accordion: the guest's documents and photos. Rendered
 * identically inside the contact panel and the booking panel, because the records
 * belong to the person, not to one booking.
 */
export function GuestRecordsSection({
  guestId,
  onChanged,
  onCount,
}: {
  guestId: string;
  onChanged: () => void;
  onCount?: (count: number | null) => void;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Documents and photos</h3>
      <ContactDocumentsSection guestId={guestId} onChanged={onChanged} onCount={onCount} />
    </section>
  );
}
