/**
 * Grouping for the bulk "Add selected" action in the combined-page manager
 * (plan §22). The host ticks any number of member services; each becomes an
 * offering. Services that share a name (trim + lowercase) across venues are
 * merged into ONE offering seeded with every venue's source service, mirroring
 * the on-page de-duplication the picker already applies to single adds.
 */

export interface BulkAddService {
  name: string;
  venueId: string;
  sourceServiceId: string;
}

export interface BulkAddGroup {
  /** Display name for the offering (the first entry's trimmed name). */
  name: string;
  /** Source services to seed the offering from, one provider per calendar each. */
  sources: Array<{ venueId: string; sourceServiceId: string }>;
}

/**
 * Group selected services by normalised name. Entries whose name is blank after
 * trimming are dropped. Order of first appearance is preserved.
 */
export function groupServicesForBulkAdd(services: BulkAddService[]): BulkAddGroup[] {
  const groups = new Map<string, BulkAddGroup>();
  for (const svc of services) {
    const key = svc.name.trim().toLowerCase();
    if (!key) continue;
    const source = { venueId: svc.venueId, sourceServiceId: svc.sourceServiceId };
    const group = groups.get(key);
    if (group) group.sources.push(source);
    else groups.set(key, { name: svc.name.trim(), sources: [source] });
  }
  return [...groups.values()];
}
