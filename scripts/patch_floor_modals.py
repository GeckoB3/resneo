from pathlib import Path

p = Path(__file__).resolve().parents[1] / "src/app/dashboard/floor-plan/FloorPlanLiveView.tsx"
t = p.read_text(encoding="utf-8")

def swap(start: str, end: str, new: str) -> None:
    global t
    s = t.find(start)
    if s < 0:
        raise SystemExit(f"missing {start[:40]}")
    e = t.find(end, s)
    if e < 0:
        raise SystemExit(f"missing end for {start[:30]}")
    t = t[:s] + new + t[e:]
    print("swapped", start[:25])

# reschedule
swap(
    "      {rescheduleDialog ? (",
    "      ) : null}\n\n      {/* New booking form */}",
    """      <Dialog
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

""",
)

p.write_text(t, encoding="utf-8")
print("floor reschedule done")
