import type { CustomClientFieldDefinition } from '@/types/contacts';

function slugifyFieldKey(name: string): string {
  const s = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return s.length > 0 ? s : 'field';
}

export function fieldKeyFromName(fieldName: string): string {
  return slugifyFieldKey(fieldName);
}

/**
 * Validates and coerces `patch` values against active venue field definitions.
 * Only keys present in `definitions` (active) are returned.
 */
export function validateAndCoerceCustomFields(
  patch: Record<string, unknown>,
  definitions: CustomClientFieldDefinition[],
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const active = definitions.filter((d) => d.is_active);
  const byKey = new Map(active.map((d) => [d.field_key, d]));
  const out: Record<string, unknown> = {};

  for (const [key, raw] of Object.entries(patch)) {
    const def = byKey.get(key);
    if (!def) {
      return { ok: false, error: `Unknown or inactive custom field key: ${key}` };
    }
    if (raw === null || raw === undefined || raw === '') {
      out[key] = null;
      continue;
    }
    switch (def.field_type) {
      case 'text': {
        const t = String(raw).trim();
        if (t.length > 2000) return { ok: false, error: `Field ${def.field_name} is too long` };
        out[key] = t;
        break;
      }
      case 'number': {
        const n = typeof raw === 'number' ? raw : Number(String(raw));
        if (!Number.isFinite(n)) return { ok: false, error: `Field ${def.field_name} must be a number` };
        out[key] = n;
        break;
      }
      case 'boolean': {
        if (typeof raw === 'boolean') {
          out[key] = raw;
        } else if (raw === 'true' || raw === '1') {
          out[key] = true;
        } else if (raw === 'false' || raw === '0') {
          out[key] = false;
        } else {
          return { ok: false, error: `Field ${def.field_name} must be a boolean` };
        }
        break;
      }
      case 'date': {
        const s = String(raw).trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
          return { ok: false, error: `Field ${def.field_name} must be a YYYY-MM-DD date` };
        }
        out[key] = s;
        break;
      }
      default:
        return { ok: false, error: `Unsupported field type for ${def.field_name}` };
    }
  }

  return { ok: true, value: out };
}

/**
 * Merge validated patch into existing guest custom_fields bag.
 */
export function mergeCustomFieldsJson(
  existing: Record<string, unknown>,
  validatedPatch: Record<string, unknown>,
): Record<string, unknown> {
  return { ...existing, ...validatedPatch };
}
