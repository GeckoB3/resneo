'use client';

import { ExpandedBookingContent } from '@/app/dashboard/bookings/ExpandedBookingContent';
import type { GuestMessageSendResult } from '@/lib/booking/guest-message-channel';
import { canMarkNoShowForSlot } from '@/lib/table-management/booking-status';
import { isTableReservationBooking } from '@/lib/booking/infer-booking-row-model';
import type { BookingDetailExpandedContext } from '@/components/booking/booking-detail-expanded-context';

export function BookingDetailExpandedContent({ ctx }: { ctx: BookingDetailExpandedContext }) {
  const {
    bookingForExpanded,
    detailForExpanded,
    isHydrated,
    tableManagementEnabled,
    venueId,
    venueCurrency,
    customMessage,
    actionLoading,
    setCustomMessage,
    setActionLoading,
    setError,
    bookingId,
    load,
    d,
    executeStatusChange,
    onUpdated,
    bookingStyleIsTable,
    showAssignModal,
    setShowAssignModal,
    suggestionsLoading,
    assignmentSuggestions,
    assignedTables,
    allTables,
    recommendedTableIds,
    venueTimezone,
    guestHistoryListRefresh,
    stackDepth,
    setNestedBookingOpen,
  } = ctx;

  return (
    <>
        <ExpandedBookingContent
          booking={bookingForExpanded}
          detail={isHydrated ? detailForExpanded : undefined}
          detailLoading={!isHydrated}
          tableManagementEnabled={tableManagementEnabled}
          venueId={d.venue_id || venueId || ''}
          venueCurrency={venueCurrency ?? 'GBP'}
          draftMessage={customMessage}
          sendingMessage={actionLoading}
          onMessageDraftChange={setCustomMessage}
          onSendMessage={async (channel): Promise<GuestMessageSendResult> => {
            setActionLoading(true);
            try {
              const res = await fetch(`/api/venue/bookings/${bookingId}/message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: customMessage, channel }),
              });
              const payload = (await res.json().catch(() => ({}))) as {
                success?: boolean;
                error?: string;
                errors?: string[];
              };
              if (!res.ok || !payload.success) {
                const errMsg = payload.errors?.join('; ') ?? payload.error ?? 'Failed to send message';
                setError(errMsg);
                return { ok: false, error: errMsg };
              }
              if (payload.errors?.length) {
                const w = payload.errors.join('; ');
                setError(null);
                setCustomMessage('');
                await load();
                return { ok: true, warning: `Sent with issues: ${w}` };
              }
              setError(null);
              setCustomMessage('');
              await load();
              return { ok: true };
            } catch {
              const errMsg = 'Failed to send message.';
              setError(errMsg);
              return { ok: false, error: errMsg };
            } finally {
              setActionLoading(false);
            }
          }}
          onStatusAction={(status) => {
            if (status === 'No-Show' && !canMarkNoShowForSlot(d.booking_date, d.booking_time?.slice(0, 5) ?? '12:00', 0)) {
              setError('No-show can only be marked after the booking start time');
              return;
            }
            void executeStatusChange(status);
          }}
          onDetailUpdated={() => {
            void (async () => {
              await load();
              onUpdated();
            })();
          }}
          onRequestChangeTable={
            bookingStyleIsTable && d.status === 'Seated'
              ? () => setShowAssignModal(true)
              : undefined
          }
          venueTimezone={venueTimezone}
          guestHistoryListRefresh={guestHistoryListRefresh}
          relatedBookingsStackDepth={stackDepth}
          onOpenRelatedGuestBooking={(payload) => {
            setNestedBookingOpen({
              id: payload.bookingId,
              snapshot: payload.snapshot,
              isAppointment: !isTableReservationBooking(payload.row),
            });
          }}
        />
        {showAssignModal ? (
          <div className="mx-2 mb-2 rounded-xl border border-brand-200 bg-brand-50/30 p-3">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-slate-900">Table assignment</p>
              <button
                type="button"
                onClick={() => setShowAssignModal(false)}
                className="rounded-lg px-2 py-1 text-[11px] font-semibold text-slate-500 hover:bg-white/70"
              >
                Close
              </button>
            </div>
            {suggestionsLoading ? (
              <p className="mb-3 text-xs text-slate-500">Finding best table options...</p>
            ) : assignmentSuggestions.length > 0 ? (
              <div className="mb-3 space-y-2">
                {assignmentSuggestions.slice(0, 6).map((suggestion, idx) => (
                  <button
                    key={`${suggestion.table_ids.join('|')}-${suggestion.source}`}
                    type="button"
                    disabled={actionLoading}
                    onClick={async () => {
                      setActionLoading(true);
                      try {
                        const assignRes = await fetch('/api/venue/tables/assignments', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(assignedTables.length > 0
                            ? {
                                action: 'reassign',
                                booking_id: bookingId,
                                old_table_ids: assignedTables.map((x) => x.id),
                                new_table_ids: suggestion.table_ids,
                              }
                            : { booking_id: bookingId, table_ids: suggestion.table_ids }
                          ),
                        });
                        if (!assignRes.ok) {
                          const payload = await assignRes.json().catch(() => ({}));
                          setError(payload.error ?? 'Failed to assign tables');
                          return;
                        }
                        setShowAssignModal(false);
                        await load();
                        onUpdated();
                      } finally {
                        setActionLoading(false);
                      }
                    }}
                    className={`w-full rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                      idx === 0
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{suggestion.table_names.join(' + ')}</span>
                      <span className="text-[10px] uppercase">
                        {suggestion.source === 'manual' ? 'Pre-configured' : suggestion.source === 'auto' ? 'Auto-detected' : 'Single'}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px]">
                      Capacity {suggestion.combined_capacity} - Spare {suggestion.spare_covers}
                    </p>
                  </button>
                ))}
              </div>
            ) : (
              <p className="mb-3 text-xs text-slate-500">No ranked suggestions available. Choose manually below.</p>
            )}
            <div className="flex flex-wrap gap-1.5">
              {allTables.map((table) => (
                <button
                  key={table.id}
                  type="button"
                  onClick={async () => {
                    setActionLoading(true);
                    try {
                      const assignRes = await fetch('/api/venue/tables/assignments', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(assignedTables.length > 0
                          ? { action: 'reassign', booking_id: bookingId, old_table_ids: assignedTables.map((x) => x.id), new_table_ids: [table.id] }
                          : { booking_id: bookingId, table_ids: [table.id] }
                        ),
                      });
                      if (!assignRes.ok) {
                        const payload = await assignRes.json().catch(() => ({}));
                        setError(payload.error ?? 'Failed to assign table');
                        return;
                      }
                      setShowAssignModal(false);
                      await load();
                      onUpdated();
                    } finally {
                      setActionLoading(false);
                    }
                  }}
                  disabled={actionLoading}
                  className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    assignedTables.some((assigned) => assigned.id === table.id)
                      ? 'border-brand-300 bg-brand-50 text-brand-700'
                      : recommendedTableIds.includes(table.id)
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {table.name} ({table.max_covers}){recommendedTableIds.includes(table.id) ? ' - Recommended' : ''}
                </button>
              ))}
            </div>
          </div>
        ) : null}
    </>
  );
}
