"""Remove redundant getUser() gates from dashboard pages (layout handles auth)."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DASHBOARD_PAGES = ROOT / "src" / "app" / "dashboard"

PATTERN = re.compile(
    r"\n\s*const \{\s*data:\s*\{\s*user\s*\}\s*\} = await supabase\.auth\.getUser\(\);\n"
    r"\s*if \(!user\) redirect\([^)]+\);\n",
    re.MULTILINE,
)

ALT_PATTERN = re.compile(
    r"\n\s*const \{\s*\n\s*data: \{ user \},\s*\n\s*\} = await supabase\.auth\.getUser\(\);\n"
    r"\s*if \(!user\) redirect\([^)]+\);\n",
    re.MULTILINE,
)

STAFF_REDIRECT = re.compile(
    r"\n\s*const staff = await getDashboardStaff\(supabase\);\n"
    r"\s*if \(!staff\) redirect\([^)]+\);\n",
    re.MULTILINE,
)


def strip_redirect_import(content: str) -> str:
    if "redirect(" not in content:
        content = content.replace("import { redirect } from 'next/navigation';\n", "")
        content = content.replace('import { redirect } from "next/navigation";\n', "")
    return content


def main() -> None:
    changed: list[str] = []
    for path in sorted(DASHBOARD_PAGES.rglob("page.tsx")):
        text = path.read_text(encoding="utf-8")
        original = text
        text = PATTERN.sub("\n", text)
        text = ALT_PATTERN.sub("\n", text)
        text = STAFF_REDIRECT.sub("\n  const staff = await getDashboardStaff(supabase);\n", text)
        text = strip_redirect_import(text)
        if text != original:
            path.write_text(text, encoding="utf-8")
            changed.append(str(path.relative_to(ROOT)))
    print("Updated", len(changed), "files")
    for p in changed:
        print(" ", p)


if __name__ == "__main__":
    main()
