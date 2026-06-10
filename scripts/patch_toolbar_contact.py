from pathlib import Path

p = Path(__file__).resolve().parents[1] / "src/components/dashboard/toolbar-guest-search/ToolbarContactDetailModal.tsx"
t = p.read_text(encoding="utf-8")

start = t.find("  if (!open) return null;")
end = t.rfind("}\n")  # last line of function - wrong

start = t.find("  if (!open) return null;\n\n  const title")
end = t.find("}\n", start)  # end of function - find last closing before EOF

# function ends at line 258
end = t.find("\n}\n", start) + 2

panel_start = t.find("<ContactDetailPanel", start)
panel_end = t.find("/>\n        </div>", panel_start) + 3

panel = t[panel_start:panel_end]

new = f"""  const title = guestSearchResultLabel(row);

  return (
    <>
      <Dialog
        open={{open}}
        onOpenChange={{(next) => {{
          if (mergeOpen) {{
            if (!next) setMergeOpen(false);
            return;
          }}
          if (!next) onClose();
        }}}}
        title={{title}}
        size="md"
        contentClassName="flex max-h-[min(85dvh,85vh)] w-full max-w-lg flex-col overflow-hidden"
      >
        {panel}
      </Dialog>

      {{mergeOpen && venue.isAdmin ? (
        <MergeContactsModal
          targetGuestId={{row.id}}
          clientLower={{venue.clientLower}}
          onClose={{() => setMergeOpen(false)}}
          onMerged={{() => {{
            void loadDetail(row.id);
            onGuestUpdated?.();
            setMergeOpen(false);
          }}}}
        />
      ) : null}}
    </>
  );
"""

t = t[:start] + new + t[end:]
p.write_text(t, encoding="utf-8")
print("toolbar contact ok")
