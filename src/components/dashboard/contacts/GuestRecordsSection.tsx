'use client';

import { ContactDocumentsSection } from '@/components/dashboard/contacts/ContactDocumentsSection';

/**
 * The body of a "Records" accordion: the guest's documents and photos. Rendered
 * identically inside the contact panel and the booking panel, because the records
 * belong to the person, not to one booking.
 *
 * On a LINKED venue's booking (R26) the same card reads the OWNER venue's files through
 * `ownerVenueId`; the link decides whether they are shared at all, and whether this venue
 * may add to or delete from them.
 */
export function GuestRecordsSection({
  guestId,
  onChanged,
  onCount,
  ownerVenueId,
  canUpload,
  canRemove,
}: {
  guestId: string;
  onChanged: () => void;
  onCount?: (count: number | null) => void;
  ownerVenueId?: string;
  canUpload?: boolean;
  canRemove?: boolean;
}) {
  return (
    <section className="space-y-2">
      <h3 className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Documents and photos</h3>
      <ContactDocumentsSection
        guestId={guestId}
        onChanged={onChanged}
        onCount={onCount}
        ownerVenueId={ownerVenueId}
        canUpload={canUpload}
        canRemove={canRemove}
      />
    </section>
  );
}
