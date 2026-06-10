from pathlib import Path
p = Path(__file__).resolve().parents[1] / "src/app/dashboard/floor-plan/FloorPlanLiveView.tsx"
t = p.read_text(encoding="utf-8")
old = """      {/* Confirm dialog */}
      {confirmDialog && (
        <motion className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setConfirmDialog(null)}>
          <motion className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold text-slate-900">{confirmDialog.title}</h3>
            <p className="mt-2 text-sm text-slate-600">{confirmDialog.message}</p>
            <motion className="mt-4 flex gap-2">
              <button type="button" onClick={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }} className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700">{confirmDialog.confirmLabel}</button>
              <button type="button" onClick={() => setConfirmDialog(null)} className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
            </motion>
          </motion>
        </motion>
      )}"""
old = old.replace("<motion", "<div").replace("</motion>", "</div>")
new = """      <ConfirmDialog
        open={confirmDialog != null}
        onOpenChange={(open) => {
          if (!open) setConfirmDialog(null);
        }}
        title={confirmDialog?.title ?? ''}
        message={confirmDialog?.message ?? ''}
        confirmLabel={confirmDialog?.confirmLabel ?? 'Confirm'}
        onConfirm={() => confirmDialog?.onConfirm()}
      />"""
if old not in t:
    # read exact slice
    s = t.find("      {/* Confirm dialog */}")
    e = t.find("      )}\n    </div>\n  );\n}", s)
    old = t[s:e+len("      )}")]
    print("using slice", len(old))
t = t.replace(old, new, 1)
p.write_text(t, encoding="utf-8")
print("done")
