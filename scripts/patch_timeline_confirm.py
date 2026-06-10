from pathlib import Path

p = Path(__file__).resolve().parents[1] / "src/app/dashboard/table-grid/TimelineGrid.tsx"
t = p.read_text(encoding="utf-8")
start = t.find("      {confirmDialog && (")
end = t.find("    </DndContext>", start)
new = """      <ConfirmDialog
        open={confirmDialog != null}
        onOpenChange={(open) => {
          if (!open && confirmDialog) {
            confirmDialog.resolve(false);
            setConfirmDialog(null);
          }
        }}
        title="Confirm"
        message={confirmDialog?.message ?? ''}
        confirmLabel="Confirm"
        destructive={false}
        onConfirm={() => {
          confirmDialog?.resolve(true);
        }}
      />
"""
t = t[:start] + new + t[end:]
p.write_text(t, encoding="utf-8")
print("ok")
