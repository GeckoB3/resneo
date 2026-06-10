#!/usr/bin/env python3
"""P0.1 Waves C/D modal migrations."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def patch_day_sheet_seat_change() -> None:
    p = ROOT / "src/app/dashboard/day-sheet/DaySheetView.tsx"
    t = p.read_text(encoding="utf-8")

    seat_old_start = "      {seatWithTableBookingId && (\n        <div\n          className=\"fixed inset-0"
    seat_start = t.find(seat_old_start)
    if seat_start < 0:
        raise SystemExit("seat modal not found")
    seat_end = t.find("\n      )}\n\n      {changeTableBookingId", seat_start)
    seat_end += len("\n      )}")

    seat_new = """      <Dialog
        open={seatWithTableBookingId != null}
        onOpenChange={(open) => {
          if (!open) setSeatWithTableBookingId(null);
        }}
        title="Assign a table"
        size="md"
        contentClassName="max-w-md"
      >
        <TableSelector
          tables={activeTables}
          occupancyMap={occupancyMap}
          partySize={data?.periods.flatMap((p) => p.bookings).find((b) => b.id === seatWithTableBookingId)?.party_size ?? 2}
          selectedIds={seatSelectedTableIds}
          onChange={setSeatSelectedTableIds}
          confirmLabel="Seat"
          skipLabel="Seat without table"
          onConfirm={async (ids) => {
            const bookingId = seatWithTableBookingId;
            if (!bookingId) return;
            setSeatWithTableBookingId(null);
            setActionLoading(bookingId);
            try {
              const res = await fetch(`/api/venue/bookings/${bookingId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'Seated', table_ids: ids }),
              });
              if (!res.ok) {
                const j = await res.json().catch(() => ({}));
                addToast(j.error ?? 'Failed to seat guest', 'error');
              } else {
                addToast('Guest checked in', 'success');
              }
              void fetchDaySheet();
            } catch {
              addToast('Failed to seat guest', 'error');
            } finally {
              setActionLoading(null);
            }
          }}
          onSkip={() => {
            const bookingId = seatWithTableBookingId;
            if (!bookingId) return;
            setSeatWithTableBookingId(null);
            void changeStatus(bookingId, 'Seated');
          }}
        />
      </Dialog>"""

    t = t[:seat_start] + seat_new + t[seat_end:]

    change_start = t.find("      {changeTableBookingId && data && (() => {")
    if change_start < 0:
        raise SystemExit("change table start not found")
    change_end = t.find("\n      })()}\n\n      {linkFeature", change_start)
    if change_end < 0:
        change_end = t.find("\n      })()}\n", change_start)
    change_end += len("\n      })()}")

    change_new = """      {changeTableBookingId && data && (() => {
        const changeBooking = data.periods.flatMap((p) => p.bookings).find((x) => x.id === changeTableBookingId);
        if (!changeBooking) return null;
        return (
          <Dialog
            open
            onOpenChange={(open) => {
              if (!open) setChangeTableBookingId(null);
            }}
            title="Change table"
            size="md"
            contentClassName="max-w-md"
          >
            <p className="mb-3 text-sm text-slate-600">
              Select table(s) for {changeBooking.guest_name}. Current booking tables are shown as free so you can move them.
            </p>
            <TableSelector
              tables={activeTables}
              occupancyMap={changeTableOccupancyMap}
              partySize={changeBooking.party_size}
              selectedIds={changeTableSelectedIds}
              onChange={setChangeTableSelectedIds}
              confirmLabel="Save"
              skipLabel="Cancel"
              onConfirm={async (ids) => {
                const bookingId = changeTableBookingId;
                if (!bookingId) return;
                const oldIds = (changeBooking.table_assignments ?? []).map((t) => t.id);
                setChangeTableBookingId(null);
                setActionLoading(bookingId);
                try {
                  const res = oldIds.length > 0
                    ? await fetch('/api/venue/tables/assignments', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          action: 'reassign',
                          booking_id: bookingId,
                          old_table_ids: oldIds,
                          new_table_ids: ids,
                        }),
                      })
                    : await fetch('/api/venue/tables/assignments', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ booking_id: bookingId, table_ids: ids }),
                      });
                  if (!res.ok) {
                    const j = await res.json().catch(() => ({}));
                    addToast((j as { error?: string }).error ?? 'Failed to update tables', 'error');
                  } else {
                    addToast('Table assignment updated', 'success');
                  }
                  void fetchDaySheet();
                } catch {
                  addToast('Failed to update tables', 'error');
                } finally {
                  setActionLoading(null);
                }
              }}
              onSkip={() => setChangeTableBookingId(null)}
            />
          </Dialog>
        );
      })()}"""

    t = t[:change_start] + change_new + t[change_end:]
    p.write_text(t, encoding="utf-8")
    print("DaySheetView seat/change")


def add_imports_table_grid() -> None:
    p = ROOT / "src/app/dashboard/table-grid/TableGridView.tsx"
    t = p.read_text(encoding="utf-8")
    if "primitives/Dialog" in t:
        return
    t = t.replace(
        "import { DashboardStaffBookingModal } from '@/components/booking/DashboardStaffBookingModal';",
        "import { DashboardStaffBookingModal } from '@/components/booking/DashboardStaffBookingModal';\nimport { Dialog } from '@/components/ui/primitives/Dialog';\nimport { Button } from '@/components/ui/primitives/Button';",
    )
    p.write_text(t, encoding="utf-8")
    print("TableGridView imports")


def replace_between(path: Path, start_marker: str, end_marker: str, replacement: str) -> None:
    t = path.read_text(encoding="utf-8")
    start = t.find(start_marker)
    if start < 0:
        raise SystemExit(f"start not found in {path.name}: {start_marker[:50]!r}")
    end = t.find(end_marker, start)
    if end < 0:
        raise SystemExit(f"end not found in {path.name}")
    path.write_text(t[:start] + replacement + t[end:], encoding="utf-8")
    print(f"patched {path.name}")


def patch_table_grid_modals() -> None:
    p = ROOT / "src/app/dashboard/table-grid/TableGridView.tsx"
    replace_between(
        p,
        "      {activeBlockId && (\n        <div className=\"fixed inset-0",
        "      {rescheduleDialog && (",
        """      <Dialog
        open={activeBlockId != null}
        onOpenChange={(open) => {
          if (!open) setActiveBlockId(null);
        }}
        title="Block Details"
        size="sm"
        footer={
          <motionBlockFooter
            activeBlockId={activeBlockId}
            onEdit={() => {
              if (!activeBlockId) return;
              openEditBlock(activeBlockId);
              setActiveBlockId(null);
            }}
            onRemove={async () => {
              if (!activeBlockId) return;
              if (!confirm('Remove this block? This will make the slot available for bookings again.')) return;
              const res = await fetch('/api/venue/tables/blocks', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: activeBlockId }),
              });
              if (!res.ok) {
                addToast('Failed to remove block', 'error');
                return;
              }
              addToast('Block removed', 'success');
              setActiveBlockId(null);
              fetchGrid();
            }}
            onClose={() => setActiveBlockId(null)}
          />
        }
      >
        {activeBlockId
          ? (() => {
              const block = blockDetails.find((item) => item.id === activeBlockId);
              const tableName =
                gridData?.tables.find((table) => table.id === block?.table_id)?.name ?? block?.table_id ?? 'Unknown';
              return (
                <div className="space-y-1 text-sm text-slate-700">
                  <p><span className="font-medium">Table:</span> {tableName}</p>
                  <p><span className="font-medium">Time:</span> {block ? `${new Date(block.start_at).toISOString().slice(11, 16)}-${new Date(block.end_at).toISOString().slice(11, 16)}` : '-'}</p>
                  <p><span className="font-medium">Reason:</span> {block?.reason ?? '-'}</p>
                  <p><span className="font-medium">Created:</span> {block ? new Date(block.created_at).toLocaleString() : '-'}</p>
                  <p><span className="font-medium">Created by:</span> {block?.created_by ?? '-'}</p>
                </motion>
              );
            })()
          : null}
      </Dialog>
      """,
    )
    # fix typo motion -> div in script output - do replace
    t = p.read_text(encoding="utf-8").replace("</motion>", "</div>").replace("motionBlockFooter", "TableGridBlockFooter")
    p.write_text(t, encoding="utf-8")

    replace_between(
        p,
        "      {rescheduleDialog && (\n        <motion",
        "      {newBookingCell && (",
        """      <Dialog
        open={rescheduleDialog != null}
        onOpenChange={(open) => {
          if (!open) setRescheduleDialog(null);
        }}
        title="Reschedule Booking"
        description="Pick a new start time."
        size="sm"
        footer={
          <div className="flex gap-2">
            <Button
              type="button"
              className="flex-1"
              onClick={() => {
                if (!rescheduleDialog) return;
                void handleTimeChange(rescheduleDialog.bookingId, rescheduleDialog.time);
                setRescheduleDialog(null);
              }}
            >
              Save
            </Button>
            <Button type="button" variant="secondary" onClick={() => setRescheduleDialog(null)}>
              Cancel
            </Button>
          </div>
        }
      >
        {rescheduleDialog ? (
          <input
            type="time"
            value={rescheduleDialog.time}
            onChange={(e) => setRescheduleDialog((prev) => (prev ? { ...prev, time: e.target.value } : prev))}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
          />
        ) : null}
      </Dialog>
      """,
    )
    t = p.read_text(encoding="utf-8")
    if "rescheduleDialog && (\n        <motion" in t:
        replace_between(
            p,
            "      {rescheduleDialog && (\n        <motion",
            "      {newBookingCell && (",
            """      <Dialog
        open={rescheduleDialog != null}
        onOpenChange={(open) => {
          if (!open) setRescheduleDialog(null);
        }}
        title="Reschedule Booking"
        description="Pick a new start time."
        size="sm"
        footer={
          <motion />
        }
      >
        {null}
      </Dialog>
      """,
        )


if __name__ == "__main__":
    patch_day_sheet_seat_change()
    add_imports_table_grid()
