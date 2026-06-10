"""One-off: remove slug/logo/cover from VenueProfileSection (moved to BookingPageSection)."""
from pathlib import Path
import re

p = Path("src/app/dashboard/settings/sections/VenueProfileSection.tsx")
text = p.read_text(encoding="utf-8")

text = text.replace(
    """const BOOKING_SLUG_TAKEN_MESSAGE =
  'That booking page address is already taken by another venue. Choose a different slug (letters, numbers, and hyphens only).';

class SlugConflictError extends Error {
  constructor() {
    super(BOOKING_SLUG_TAKEN_MESSAGE);
    this.name = 'SlugConflictError';
  }
}

""",
    "",
)

text = text.replace(
    "  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/, 'Lowercase letters, numbers and hyphens only'),\n",
    "",
)

text = re.sub(
    r"function slugFromName\(name: string\): string \{.*?\}\n\n",
    "",
    text,
    count=1,
    flags=re.DOTALL,
)

text = text.replace("    slug: data.slug,\n", "")

text = re.sub(
    r"  const \[logoSaving.*?\n  const venueIdRef = useRef",
    "  const venueIdRef = useRef",
    text,
    count=1,
    flags=re.DOTALL,
)

text = text.replace("      slug: venue.slug ?? '',\n", "", 2)

text = text.replace("  const nameValue = watch('name');\n  const slugInput = watch('slug');\n", "")

text = re.sub(
    r"  const handleNameBlur = useCallback\(\(\) => \{.*?\}, \[nameValue, setValue\]\);\n\n",
    "",
    text,
    count=1,
    flags=re.DOTALL,
)

text = re.sub(
    r"        if \(res\.status === 409 && /slug/i\.test\(apiError\)\) \{\n          throw new SlugConflictError\(\);\n        \}\n",
    "",
    text,
)
text = text.replace(" || typeof body.slug !== 'string'", "")
text = text.replace(
    "const { name: savedName, slug: savedSlug, ...savedFields } = body",
    "const { name: savedName, ...savedFields } = body",
)
text = text.replace("      setValue('slug', savedSlug);\n", "")
text = text.replace("        slug: savedSlug,\n", "")
text = text.replace("      slugConflictFingerprintRef.current = null;\n", "")

text = re.sub(
    r"    slugConflictFingerprintRef\.current = null;\n    setSlugHint\('idle'\);\n    clearErrors\('slug'\);\n",
    "",
    text,
)

text = re.sub(
    r"  useEffect\(\(\) => \{\n    const subscription = watch\(\(_, info\) => \{.*?\}, \[watch, clearErrors\]\);\n\n",
    "",
    text,
    count=1,
    flags=re.DOTALL,
)

text = re.sub(
    r"  useEffect\(\(\) => \{\n    if \(!isAdmin\) \{\n      setSlugHint\('idle'\);\n      return;\n    \}.*?  \}, \[slugInput, isAdmin, venue\.slug\]\);\n\n",
    "",
    text,
    count=1,
    flags=re.DOTALL,
)

old_autosave = """      const normSlug = parsed.data.slug.trim().toLowerCase();
      const savedSlug = (venue.slug ?? '').trim().toLowerCase();
      if (normSlug !== savedSlug && slugHint === 'taken') {
        return;
      }
      const next = payloadFingerprint(parsed.data);
      if (next === lastSavedFingerprint.current) return;
      if (slugConflictFingerprintRef.current !== null && next === slugConflictFingerprintRef.current) {
        return;
      }"""
new_autosave = """      const next = payloadFingerprint(parsed.data);
      if (next === lastSavedFingerprint.current) return;"""
text = text.replace(old_autosave, new_autosave)

text = text.replace(
    """          if (err instanceof SlugConflictError) {
            slugConflictFingerprintRef.current = next;
            setError('slug', { type: 'server', message: err.message });
            report({ status: 'error', message: err.message });
            return;
          }
          """,
    "",
)

text = text.replace(", setError, slugHint, venue.slug", "")

text = re.sub(
    r"  const onLogoChange = useCallback\(.*?\}, \[isAdmin, coverRemoving, onUpdate, report\]\);\n\n",
    "",
    text,
    count=1,
    flags=re.DOTALL,
)

text = re.sub(
    r"      <SectionCard\.Body>\n        <motion.div className=\"mb-6\">.*?</motion.div>\n\n        <form",
    "      <SectionCard.Body>\n        <form",
    text,
    count=1,
    flags=re.DOTALL,
)
text = re.sub(
    r"      <SectionCard\.Body>\n        <div className=\"mb-6\">.*?</motion.div>\n\n        <form",
    "      <SectionCard.Body>\n        <form",
    text,
    count=1,
    flags=re.DOTALL,
)
text = re.sub(
    r"      <SectionCard\.Body>\n        <div className=\"mb-6\">.*?</motion.div>\n\n        <form",
    "      <SectionCard.Body>\n        <form",
    text,
    count=1,
    flags=re.DOTALL,
)

text = re.sub(
    r"          <div>\n            <label htmlFor=\"slug\".*?</motion.div>\n          <fieldset>",
    "          <fieldset>",
    text,
    count=1,
    flags=re.DOTALL,
)
text = re.sub(
    r"          <div>\n            <label htmlFor=\"slug\".*?</div>\n          <fieldset>",
    "          <fieldset>",
    text,
    count=1,
    flags=re.DOTALL,
)

text = text.replace(" onBlur={handleNameBlur}", "")
text = text.replace("  }, [venue.id, venue, reset, getValues, clearErrors]);", "  }, [venue.id, venue, reset, getValues]);")

p.write_text(text, encoding="utf-8")
print("Updated", p)
