from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def add_import(path: Path, line: str, after: str) -> None:
    t = path.read_text(encoding="utf-8")
    if line in t:
        return
    t = t.replace(after, after + "\n" + line, 1)
    path.write_text(t, encoding="utf-8")


def floor_plan() -> None:
    p = ROOT / "src/app/dashboard/floor-plan/FloorPlanLiveView.tsx"
    add_import(p, "import { Dialog } from '@/components/ui/primitives/Dialog';", "import { useToast } from '@/components/ui/Toast';")
    add_import(p, "import { Sheet } from '@/components/ui/primitives/Sheet';", "import { Dialog } from '@/components/ui/primitives/Dialog';")
    add_import(p, "import { ConfirmDialog } from '@/components/ui/primitives/ConfirmDialog';", "import { Sheet } from '@/components/ui/primitives/Sheet';")
    add_import(p, "import { Button } from '@/components/ui/primitives/Button';", "import { ConfirmDialog } from '@/components/ui/primitives/ConfirmDialog';")
    t = p.read_text(encoding="utf-8")

    # confirm
    s = t.find("      {confirmDialog && (")
    e = t.find("    </div>\n  );\n}", s)
    t = t[:s] + """      <ConfirmDialog
        open={confirmDialog != null}
        onOpenChange={(open) => {
          if (!open) setConfirmDialog(null);
        }}
        title={confirmDialog?.title ?? ''}
        message={confirmDialog?.message ?? ''}
        confirmLabel={confirmDialog?.confirmLabel ?? 'Confirm'}
        onConfirm={() => confirmDialog?.onConfirm()}
      />
""" + t[e:]

    # reschedule
    s = t.find("      {rescheduleDialog ? (")
    e = t.find("      ) : null}\n\n      {/* New booking form */}", s)
    reschedule = """      <Dialog
        open={rescheduleDialog != null}
        onOpenChange={(open) => {
          if (!open) setRescheduleDialog(null);
        }}
        title="Reschedule booking"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setRescheduleDialog(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                if (!rescheduleDialog) return;
                const { bookingId, time } = rescheduleDialog;
                setRescheduleDialog(null);
                void handleFloorTimeChange(bookingId, time);
              }}
            >
              Save
            </Button>
          </div>
        }
      >
        {rescheduleDialog ? (
          <>
            <label htmlFor="floor-reschedule-time" className="block text-xs font-medium text-slate-700">
              New start time
            </label>
            <input
              id="floor-reschedule-time"
              type="time"
              value={rescheduleDialog.time}
              onChange={(e) => setRescheduleDialog((prev) => (prev ? { ...prev, time: e.target.value } : null))}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </>
        ) : null}
      </Dialog>

"""
    t = t[:s] + reschedule + t[e + len("      ) : null}\n\n") :]

    p.write_text(t, encoding="utf-8")
    print("floor plan partial")


def bookings_dashboard() -> None:
    p = ROOT / "src/app/dashboard/bookings/BookingsDashboard.tsx"
    t = p.read_text(encoding="utf-8")
    if "changeTableBooking && (" not in t or "fixed inset-0 z-50 flex items-start" not in t:
        print("bookings change table skip")
        return
    add_import(p, "import { Dialog } from '@/components/ui/primitives/Dialog';", "import { ConfirmDialog } from '@/components/ui/primitives/ConfirmDialog';")
    s = t.find("      {changeTableBooking && (")
    e = t.find("\n      )}\n\n      <ConfirmDialog", s)
    if e < 0:
        e = t.find("\n      )}\n      <ConfirmDialog", s)
    # read inner from file - use marker after opening div
    inner_start = t.find('<h3 className="text-lg font-semibold text-slate-900">Change table</h3>', s)
    inner = t[inner_start:e]
    new = f"""      <Dialog
        open={{changeTableBooking != null}}
        onOpenChange={{(open) => {{
          if (!open && !changeTableSaving) closeChangeTableModal();
        }}}}
        title="Change table"
        size="md"
        contentClassName="max-w-md"
      >
        {inner}
      </Dialog>
"""
    t = t[:s] + new + t[e:]
    p.write_text(t, encoding="utf-8")
    print("bookings dashboard change table")


if __name__ == "__main__":
    floor_plan()
    bookings_dashboard()
