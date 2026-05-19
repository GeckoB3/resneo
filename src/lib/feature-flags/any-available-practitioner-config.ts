import { z } from 'zod';
import type { PractitionerSlot } from '@/lib/availability/appointment-engine';

export const ANY_AVAILABLE_ASSIGNMENT_MODES = ['priority', 'random'] as const;
export type AnyAvailableAssignmentMode = (typeof ANY_AVAILABLE_ASSIGNMENT_MODES)[number];

export const anyAvailablePractitionerConfigSchema = z.object({
  mode: z.enum(ANY_AVAILABLE_ASSIGNMENT_MODES),
  /** Priority order (calendar / practitioner ids). Used when mode is `priority`. */
  calendar_order: z.array(z.string().uuid()).default([]),
});

export type AnyAvailablePractitionerConfig = z.infer<typeof anyAvailablePractitionerConfigSchema>;

export const DEFAULT_ANY_AVAILABLE_PRACTITIONER_CONFIG: AnyAvailablePractitionerConfig = {
  mode: 'priority',
  calendar_order: [],
};

export function parseAnyAvailablePractitionerConfig(
  flags: { any_available_practitioner_config?: unknown } | null | undefined,
): AnyAvailablePractitionerConfig {
  const raw = flags?.any_available_practitioner_config;
  const parsed = anyAvailablePractitionerConfigSchema.safeParse(raw);
  if (!parsed.success) {
    return { ...DEFAULT_ANY_AVAILABLE_PRACTITIONER_CONFIG };
  }
  return parsed.data;
}

/** Merge configured order with any ids not listed (append in `fallbackOrder`). */
export function effectiveCalendarOrder(
  config: AnyAvailablePractitionerConfig,
  practitionerIds: string[],
  fallbackOrder: string[] = [],
): string[] {
  const idSet = new Set(practitionerIds);
  const fromConfig = config.calendar_order.filter((id) => idSet.has(id));
  const seen = new Set(fromConfig);
  const tail: string[] = [];
  for (const id of [...fallbackOrder, ...practitionerIds]) {
    if (!idSet.has(id) || seen.has(id)) continue;
    seen.add(id);
    tail.push(id);
  }
  return [...fromConfig, ...tail];
}

function rankPractitioner(id: string, order: string[]): number {
  const idx = order.indexOf(id);
  return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
}

export function pickPractitionerSlotForPooledTime(
  candidates: PractitionerSlot[],
  config: AnyAvailablePractitionerConfig,
  calendarOrder: string[],
): PractitionerSlot | null {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!;

  if (config.mode === 'random') {
    const index = Math.floor(Math.random() * candidates.length);
    return candidates[index] ?? candidates[0]!;
  }

  const order = effectiveCalendarOrder(config, candidates.map((c) => c.practitioner_id), calendarOrder);
  const sorted = [...candidates].sort((a, b) => {
    const ra = rankPractitioner(a.practitioner_id, order);
    const rb = rankPractitioner(b.practitioner_id, order);
    if (ra !== rb) return ra - rb;
    return a.practitioner_name.localeCompare(b.practitioner_name);
  });
  return sorted[0] ?? null;
}

export function collapsePooledSlotsByStartTime(
  slots: PractitionerSlot[],
  config: AnyAvailablePractitionerConfig,
  calendarOrder: string[] = [],
): PractitionerSlot[] {
  const byTime = new Map<string, PractitionerSlot[]>();
  for (const slot of slots) {
    const key = slot.start_time.trim().slice(0, 5);
    const list = byTime.get(key) ?? [];
    list.push(slot);
    byTime.set(key, list);
  }

  const collapsed: PractitionerSlot[] = [];
  for (const [, candidates] of byTime) {
    const picked = pickPractitionerSlotForPooledTime(candidates, config, calendarOrder);
    if (picked) collapsed.push(picked);
  }

  collapsed.sort(
    (a, b) =>
      a.start_time.localeCompare(b.start_time) ||
      a.practitioner_name.localeCompare(b.practitioner_name),
  );
  return collapsed;
}
