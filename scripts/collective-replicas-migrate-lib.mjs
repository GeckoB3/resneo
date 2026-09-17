/**
 * The pure parts of scripts/collective-replicas-migrate.mjs, kept apart so they can be tested
 * without a database (plan §7, Appendix G; MIG-01, MIG-02).
 */
import { createHash } from 'node:crypto';

export const PRODUCTION_REF = 'njualfobtudvlugqkqho';

/** JSON with object keys sorted at every depth, so the same report always hashes the same. */
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

/** The hash the owner signs: the plan itself, never the time it was made. */
export function reportHash(plan) {
  return createHash('sha256').update(canonicalJson(plan)).digest('hex');
}

export function parseArgs(argv) {
  const out = { mode: 'dry-run', restoreStale: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
      i += 1;
      return v;
    };
    switch (a) {
      case '--collective': out.collective = next(); break;
      case '--choices': out.choices = next(); break;
      case '--env': out.env = next(); break;
      case '--actor-user': out.actorUser = next(); break;
      case '--approved-report': out.approvedReport = next(); break;
      case '--survey': out.mode = 'survey'; break;
      case '--dry-run': out.mode = 'dry-run'; break;
      case '--apply': out.mode = 'apply'; break;
      case '--rollback': out.mode = 'rollback'; break;
      case '--restore-stale': out.restoreStale = next().split(',').map((s) => s.trim()).filter(Boolean); break;
      default: throw new Error(`Unknown argument ${a}`);
    }
  }
  if (out.mode !== 'survey' && !out.collective) throw new Error('--collective <id> is required');
  if (out.mode === 'apply' && !/^[0-9a-f]{64}$/.test(out.approvedReport ?? '')) {
    throw new Error('--apply needs --approved-report <sha256> from the signed dry run');
  }
  if ((out.mode === 'apply' || out.mode === 'rollback') && !['staging', 'production'].includes(out.env)) {
    throw new Error('--apply and --rollback need --env staging or --env production');
  }
  return out;
}

/** Refuses a write against a project that is not the one named. */
export function fenceError(env, projectRef) {
  if (env === 'production' && projectRef !== PRODUCTION_REF) {
    return `--env production, but the keys point at ${projectRef}`;
  }
  if (env === 'staging' && projectRef === PRODUCTION_REF) {
    return '--env staging, but the keys point at production';
  }
  return null;
}

/** Why a plan may not be applied, or null. */
export function planBlocker(plan, approvedHash) {
  const hash = reportHash(plan);
  if (hash !== approvedHash) return `the report has changed since it was signed (now ${hash})`;
  for (const key of ['p1', 'p2', 'p3']) {
    const count = Number(plan?.[key]?.count ?? 0);
    if (count > 0) return `${key.toUpperCase()} has ${count} to resolve first`;
  }
  return null;
}

/** A short human summary of a plan, for the terminal. */
export function summarisePlan(plan) {
  const lines = [];
  lines.push(`${plan.name} (${plan.collective}), now ${plan.service_model}`);
  lines.push(
    `Blockers: P1 ${plan.p1.count}, P2 ${plan.p2.count}, P3 ${plan.p3.count}; ` +
      `to decide: P4 ${plan.p4.count}, P5 ${plan.p5.count}`,
  );
  const created = plan.masters.filter((m) => !m.master_service_id);
  lines.push(`Offerings: ${plan.masters.length} (${created.length} with no host service: ${created.map((m) => `${m.name} ${m.choice}`).join(', ') || 'none'})`);
  const replaced = plan.links.reduce((n, l) => n + l.replaced.length, 0);
  const created2 = plan.links.filter((l) => !l.copy_service_id).length;
  lines.push(`Member links: ${plan.links.length} (${created2} new services), ${replaced} value(s) the host's replace`);
  const unmapped = plan.links.flatMap((l) => l.options).filter((o) => o.rule === 'kept_inactive' || o.rule === 'switched_off');
  lines.push(`Options with no match: ${unmapped.length} (${unmapped.filter((o) => o.rule === 'kept_inactive').length} kept for their bookings)`);
  const added = plan.member_only.filter((m) => m.choice === 'add_to_page');
  lines.push(`Member-only services: ${plan.member_only.length} (${added.length} to add to the page, the rest parked)`);
  lines.push(`Page wording the master replaces: ${plan.page_copy.length} offering(s)`);
  lines.push(`Calendar assignments to create: ${plan.assignments_to_create}; bookings to snapshot: ${plan.bookings_to_snapshot}`);
  for (const v of plan.venues) {
    const flags = [v.is_host ? 'host' : null, v.stripe_charges_enabled ? 'takes payments' : 'no payments', v.forms_on ? 'forms on' : 'forms off', v.blocker ? `blocked: ${v.blocker}` : null];
    lines.push(`  ${v.name}: ${flags.filter(Boolean).join(', ')}`);
  }
  return lines.join('\n');
}
