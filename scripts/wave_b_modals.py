#!/usr/bin/env python3
"""P0.1 Wave B: migrate hand-rolled modals to Dialog/Sheet primitives."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_block(path: Path, start_marker: str, end_marker: str, replacement: str) -> None:
    text = path.read_text(encoding="utf-8")
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f"start not found in {path}: {start_marker[:60]!r}")
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit(f"end not found in {path}")
    end += len(end_marker)
    path.write_text(text[:start] + replacement + text[end:], encoding="utf-8")
    print(f"patched {path.relative_to(ROOT)}")


def ensure_import(path: Path, import_line: str) -> None:
    text = path.read_text(encoding="utf-8")
    if import_line in text:
        return
    anchor = "'use client';\n\n"
    if anchor not in text:
        raise SystemExit(f"no anchor in {path}")
    text = text.replace(anchor, anchor + import_line + "\n", 1)
    path.write_text(text, encoding="utf-8")
    print(f"import {path.name}")


def patch_availability_settings() -> None:
    path = ROOT / "src/app/dashboard/availability/AppointmentAvailabilitySettings.tsx"
    ensure_import(path, "import { Dialog } from '@/components/ui/primitives/Dialog';")
    ensure_import(path, "import { Button } from '@/components/ui/primitives/Button';")

    team_start = "              {/* Add/Edit modal */}\n              {showForm && isAdmin && ("
    team_end = "\n              )}\n            </div>\n          )}\n\n          {/* ─── Working Hours"
    team_new = """              {/* Add/Edit modal */}
              {isAdmin ? (
                <Dialog
                  open={showForm}
                  onOpenChange={(open) => {
                    if (!open) {
                      setShowForm(false);
                      setCalendarModalError(null);
                    }
                  }}
                  title={editingId ? 'Edit calendar' : 'Add calendar'}
                  size="md"
                  footer={
                    <div className="flex justify-end gap-3">
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          setShowForm(false);
                          setCalendarModalError(null);
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        onClick={() => void savePractitioner()}
                        loading={saving}
                        disabled={saving}
                      >
                        {saving ? 'Saving...' : 'Save'}
                      </Button>
                    </div>
                  }
                >
                  {calendarModalError ? (
                    <motionAlert role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                      {calendarModalError}
                    </motionAlert>
                  ) : null}"""
    # fix motionAlert typo below

    text = path.read_text(encoding="utf-8")
    start = text.find(team_start)
    if start < 0:
        raise SystemExit("team modal start missing")
    # find inner content: from after opening div through before footer buttons div
    inner_start = text.find('<div className="space-y-4">', start)
    footer_start = text.find('<motionFooter', start)
    if inner_start < 0:
        inner_start = text.find('<div className="space-y-4">', start)
    footer_start = text.find('                    <motionFooter', start)
    if footer_start < 0:
        footer_start = text.find('                    <div className="mt-6 flex justify-end gap-3">', start)
    end = text.find(team_end, start)
    if end < 0:
        raise SystemExit("team modal end missing")

    inner = text[inner_start:footer_start]
    team_block = team_new.replace(
        """                  {calendarModalError ? (
                    <motionAlert role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
                      {calendarModalError}
                    </motionAlert>
                  ) : null}""",
        """                  {calendarModalError ? (
                    <div
                      role="alert"
                      className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
                    >
                      {calendarModalError}
                    </div>
                  ) : null}""",
    ) + inner + """
                </Dialog>
              ) : null}"""

    path.write_text(text[:start] + team_block + text[end:], encoding="utf-8")
    print("team form dialog")

    upgrade_start = "      {showUpgradeModal && ("
    upgrade_end = "      )}\n    </div>\n  );\n}"
    upgrade_new = """      <Dialog
        open={showUpgradeModal}
        onOpenChange={setShowUpgradeModal}
        title="Upgrade to add more calendars"
        description="Your current subscription includes a limited number of calendars (team members). To add another practitioner, visit your plan settings to adjust your calendar allowance."
        size="sm"
        footer={
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="secondary" onClick={() => setShowUpgradeModal(false)}>
              Close
            </Button>
            <Button type="button" asChild>
              <Link href="/dashboard/settings?tab=plan">View plans &amp; upgrade</Link>
            </Button>
          </div>
        }
      >
        {entitlement && !entitlement.unlimited && entitlement.calendar_limit != null ? (
          <p className="text-sm text-slate-700">
            You are using{' '}
            <span className="font-semibold">
              {entitlement.active_practitioners} of {entitlement.calendar_limit}
            </span>{' '}
            calendar{entitlement.calendar_limit === 1 ? '' : 's'}.
          </p>
        ) : null}
      </Dialog>"""
    replace_block(path, upgrade_start, upgrade_end, upgrade_new)


def patch_appointment_services() -> None:
    path = ROOT / "src/app/dashboard/appointment-services/AppointmentServicesView.tsx"
    ensure_import(path, "import { Dialog } from '@/components/ui/primitives/Dialog';")
    ensure_import(path, "import { Button } from '@/components/ui/primitives/Button';")

    text = path.read_text(encoding="utf-8")

    # --- create/edit service modal ---
    s = text.find("      {/* Create / Edit Modal */}\n      {showModal && (")
    e = text.find("\n      )}\n\n      {showAddCalendarModal", s)
    if s < 0 or e < 0:
        raise SystemExit("service modal bounds")
    inner_start = text.find("{error &&", s)
    inner_end = text.find("            <motionFooter", s)
    if inner_end < 0:
        inner_end = text.find("            <div className=\"mt-6 flex justify-end gap-3\">", s)
    inner = text[inner_start:inner_end]
    service_dialog = f"""      <Dialog
        open={{showModal}}
        onOpenChange={{(open) => {{
          if (!open) setShowModal(false);
        }}}}
        title={{editingId ? 'Edit Service' : 'Add Service'}}
        size="lg"
        contentClassName="max-w-4xl"
        footer={{
          <div className="flex justify-end gap-3">
            <Button type="button" variant="secondary" onClick={{() => setShowModal(false)}}>
              Cancel
            </Button>
            <Button type="button" onClick={{handleSave}} loading={{saving}} disabled={{saving}}>
              {{saving ? 'Saving...' : editingId ? 'Save Changes' : 'Create Service'}}
            </Button>
          </div>
        }}
      >
        {inner}
      </Dialog>

"""
    text = text[:s] + service_dialog + text[e + len("\n      )}") :]

    # --- add calendar modal ---
    s = text.find("      {showAddCalendarModal && isAdmin && (")
    e = text.find("\n      )}\n\n      {serviceToDelete", s)
    add_inner_start = text.find("{addCalendarModalError", s)
    add_inner_end = text.find("            <motionFooter", s)
    if add_inner_end < 0:
        add_inner_end = text.find("            <div className=\"flex flex-wrap gap-2\">", s)
        # skip title/desc - find after input
        add_inner_start = text.find("{addCalendarModalError", s)
        add_inner_end = text.find("            <div className=\"flex flex-wrap gap-2\">", s)
    add_body = text[text.find("<p className=\"mb-4 text-sm", s) : add_inner_end]
    add_dialog = f"""      {{isAdmin ? (
        <Dialog
          open={{showAddCalendarModal}}
          onOpenChange={{(open) => {{
            if (creatingCalendar) return;
            if (!open) {{
              setShowAddCalendarModal(false);
              setAddCalendarModalError(null);
            }}
          }}}}
          title="Add calendar"
          description="Same defaults as Calendar availability: weekly hours are set automatically; you can edit them later."
          size="sm"
          footer={{
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={{() => void handleCreateCalendar()}} loading={{creatingCalendar}} disabled={{creatingCalendar}}>
                {{creatingCalendar ? 'Creating…' : 'Create and assign'}}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={{() => {{
                  setShowAddCalendarModal(false);
                  setAddCalendarModalError(null);
                }}}}
                disabled={{creatingCalendar}}
              >
                Cancel
              </Button>
            </div>
          }}
        >
          {{addCalendarModalError ? (
            <div role="alert" className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {{addCalendarModalError}}
            </div>
          ) : null}}
          <label className="mb-1 block text-xs font-medium text-slate-600">Display name *</label>
          <input
            type="text"
            value={{newCalendarName}}
            onChange={{(e) => setNewCalendarName(e.target.value)}}
            placeholder="e.g. Room 2, Senior stylist"
            disabled={{creatingCalendar}}
            className="mb-4 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500 disabled:opacity-60"
            autoFocus
            onKeyDown={{(e) => {{
              if (e.key === 'Enter') {{
                e.preventDefault();
                void handleCreateCalendar();
              }}
            }}}}
          />
        </Dialog>
      ) : null}}

"""
    text = text[:s] + add_dialog + text[e + len("\n      )}") :]

    # --- delete service ---
    s = text.find("      {serviceToDelete && (")
    e = text.find("\n      )}\n\n      {overrideService", s)
    del_dialog = """      <Dialog
        open={serviceToDelete != null}
        onOpenChange={(open) => {
          if (!open && !deleteServiceBusy) closeDeleteServiceModal();
        }}
        title="Delete this service?"
        description={
          serviceToDelete
            ? `${serviceToDelete.name} will be removed. Calendar links to this service will be cleared. This cannot be undone.`
            : undefined
        }
        size="sm"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={closeDeleteServiceModal} disabled={deleteServiceBusy}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={() => void confirmDeleteService()}
              loading={deleteServiceBusy}
              disabled={deleteServiceBusy}
            >
              {deleteServiceBusy ? 'Deleting…' : 'Delete service'}
            </Button>
          </div>
        }
      >
        {deleteServiceModalError ? (
          <motionAlert role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {deleteServiceModalError}
          </motionAlert>
        ) : null}
      </Dialog>

"""
    del_dialog = del_dialog.replace("<motionAlert", "<div").replace("</motionAlert>", "</div>")
    text = text[:s] + del_dialog + text[e + len("\n      )}") :]

    path.write_text(text, encoding="utf-8")
    print("AppointmentServicesView")


def patch_eslint() -> None:
    path = ROOT / "eslint.config.mjs"
    text = path.read_text(encoding="utf-8")
    needle = "  // Konva floor plan:"
    block = """  // P0.1: discourage new hand-rolled modal overlays (use Dialog/Sheet primitives).
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/components/ui/primitives/**",
      "src/components/booking/BookingDetailSurface.tsx",
      "src/components/practitioner-calendar/ClassInstanceDetailSheet.tsx",
    ],
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          selector: "Literal[value=/fixed inset-0/]",
          message:
            "Prefer Dialog or Sheet from @/components/ui/primitives/ instead of hand-rolled modal overlays.",
        },
      ],
    },
  },
  """
    if "P0.1: discourage new hand-rolled" in text:
        print("eslint already patched")
        return
    if needle not in text:
        raise SystemExit("eslint anchor missing")
    path.write_text(text.replace(needle, block + needle, 1), encoding="utf-8")
    print("eslint.config.mjs")


if __name__ == "__main__":
    patch_availability_settings()
    patch_appointment_services()
    patch_eslint()
