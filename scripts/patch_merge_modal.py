from pathlib import Path

p = Path(__file__).resolve().parents[1] / "src/components/dashboard/contacts/MergeContactsModal.tsx"
t = p.read_text(encoding="utf-8")

start = t.find("  return (\n    <div")
end_header = t.find("        {targetLoadErr ? (", start)
end_file = t.rfind("      </div>\n    </motion>")

# find actual closing - last two closing divs before );
close = t.rfind("        </div>\n      </div>\n    </div>\n  );")
if close < 0:
    close = t.rfind("      </div>\n    </div>\n  );")

header = """  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!busy && !next) onClose();
      }}
      title={`Merge duplicate ${clientLower}s`}
      description={`Step ${step} of 4 · Admin only · Cannot be undone`}
      size="lg"
      contentClassName="max-w-2xl"
    >
"""

body = t[end_header:close]
# remove one level of footer wrapper closing - body ends with footer div, need only close Dialog
body = body.rstrip()
if not body.endswith("</div>"):
    raise SystemExit("unexpected body end")

t = t[:start] + header + body + "\n    </Dialog>\n  );\n}\n"

# fix duplicate closing brace if we included extra }
if t.count("}\n}") > t.count("function "):
    pass

p.write_text(t, encoding="utf-8")
print("merge ok", close)
