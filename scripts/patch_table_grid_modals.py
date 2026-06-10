#!/usr/bin/env python3
from pathlib import Path

p = Path(__file__).resolve().parents[1] / "src/app/dashboard/table-grid/TableGridView.tsx"
t = p.read_text(encoding="utf-8")


def swap(start_marker: str, end_marker: str, replacement: str) -> None:
    global t
    start = t.find(start_marker)
    if start < 0:
        raise SystemExit(f"missing start: {start_marker[:60]!r}")
    end = t.find(end_marker, start)
    if end < 0:
        raise SystemExit(f"missing end after: {start_marker[:40]!r}")
    t = t[:start] + replacement + t[end:]


swap(
    "      {rescheduleDialog && (",
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
          <motion className="flex gap-2">
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
          </motion>
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
""".replace("<motion className", "<div className").replace("</motion>", "</div>"),
)

swap(
    "      {activeBlockId && (",
    "      <Dialog\n        open={rescheduleDialog",
    """      <Dialog
        open={activeBlockId != null}
        onOpenChange={(open) => {
          if (!open) setActiveBlockId(null);
        }}
        title="Block Details"
        size="sm"
        footer={
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              className="flex-1"
              onClick={() => {
                if (!activeBlockId) return;
                openEditBlock(activeBlockId);
                setActiveBlockId(null);
              }}
            >
              Edit Block
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={async () => {
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
            >
              Remove Block
            </Button>
            <Button type="button" variant="secondary" onClick={() => setActiveBlockId(null)}>
              Close
            </Button>
          </div>
        }
      >
        {activeBlockId
          ? (() => {
              const block = blockDetails.find((item) => item.id === activeBlockId);
              const tableName =
                gridData?.tables.find((table) => table.id === block?.table_id)?.name ?? block?.table_id ?? 'Unknown';
              return (
                <motion className="space-y-1 text-sm text-slate-700">
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
""".replace("<motion className", "<div className").replace("</motion>", "</div>"),
)

# blockForm: replace outer wrapper only
bf_start = t.find("      {blockForm && (")
bf_end = t.find("\n      )}\n    </div>\n  );\n}", bf_start)
if bf_start < 0 or bf_end < 0:
    raise SystemExit("blockForm bounds")
inner = t[bf_start + len("      {blockForm && (\n"): bf_end]
# inner starts with <div fixed...> and ends before )}
# strip first two div wrappers and last two closing divs
lines = inner.splitlines()
# find content between outer divs - use marker
content_start = inner.find('            <h3 className="text-base font-semibold')
if content_start < 0:
    raise SystemExit("block h3")
content = inner[content_start:]
# remove trailing closing divs from content
while content.rstrip().endswith("</div>"):
    content = content.rstrip()[:-6].rstrip()

block_new = f"""      <Dialog
        open={{blockForm != null}}
        onOpenChange={{(open) => {{
          if (!open && !blockSaving) setBlockForm(null);
        }}}}
        title={{blockForm?.id ? 'Edit Table Block' : 'Block Table'}}
        size="md"
      >
{content}
      </Dialog>
"""
t = t[:bf_start] + block_new + t[bf_end:]

p.write_text(t, encoding="utf-8")
print("TableGridView modals patched")
