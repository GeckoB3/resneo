from pathlib import Path

p = Path(__file__).resolve().parents[1] / "src/app/dashboard/floor-plan/FloorPlanLiveView.tsx"
t = p.read_text(encoding="utf-8")
imp = "import { ConfirmDialog } from '@/components/ui/primitives/ConfirmDialog';"
if imp not in t:
    t = t.replace(
        "import { useToast } from '@/components/ui/Toast';",
        "import { useToast } from '@/components/ui/Toast';\n" + imp,
    )
s = t.find("      {confirmDialog && (")
e = t.find("    </motion>", s)
if e < 0:
    e = t.find("    </motion>", s)
if e < 0:
    e = t.find("    </motion>", s)
# find end of confirm block - before undo toast
e = t.find("\n\n      {/* Undo toast */}", s)
if s < 0 or e < 0:
    raise SystemExit(f"bounds {s} {e}")
new = """      <ConfirmDialog
        open={confirmDialog != null}
        onOpenChange={(open) => {
          if (!open) setConfirmDialog(null);
        }}
        title={confirmDialog?.title ?? ''}
        message={confirmDialog?.message ?? ''}
        confirmLabel={confirmDialog?.confirmLabel ?? 'Confirm'}
        onConfirm={() => confirmDialog?.onConfirm()}
      />

"""
t = t[:s] + new + t[e:]
p.write_text(t, encoding="utf-8")
print("ok")
