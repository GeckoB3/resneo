/**
 * The older combined-page manager's actions on a shared-services collective (plan §6.4 "the fold",
 * Appendix E notes on `PATCH .../catalogue`; test MGR-01; W11).
 *
 * The manager and older app builds still send the catalogue route's twelve actions. On this model
 * each one is answered the engine's way, with a code where there is no equivalent:
 *
 *   create_item, create_items   offer the host's own services; a member's service or none: 409
 *                               COLLECTIVE_OFFERING_NEEDS_HOST_SERVICE
 *   archive_item                withdraw
 *   update_item                 the page photo only; anything else is changed on the Services
 *                               page: 409 COLLECTIVE_EDIT_ON_SERVICES_PAGE
 *   add_provider, remove_provider, set_providers
 *                               the calendar offering (contract 13), with one result per operation,
 *                               so a partial failure is reported rather than called success (CB-45)
 *   sync_provider, link_provider, sync_all_providers, unlink_all_providers
 *                               nothing to do: every copy follows its master; 200
 *   detach_provider             409 COLLECTIVE_REPLICAS_ALWAYS_FOLLOW
 *   heading actions             headings follow the services: 409 COLLECTIVE_HEADINGS_FOLLOW_SERVICES
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';
import type { ApiErrorCode } from '@/lib/api/error-codes';
import type { catalogueActionSchema } from '@/lib/linked-accounts/validation';
import { collectiveDbError } from '@/lib/linked-accounts/replicas/db-errors';
import { runBulkOps, type BulkOp, type BulkOpResult } from '@/lib/linked-accounts/replicas/bulk-ops';
import { applyLinksInline } from '@/lib/linked-accounts/replicas/inline-apply';

type CatalogueActionInput = z.infer<typeof catalogueActionSchema>;

export type ShimResult =
  | { ok: true; results?: BulkOpResult[] }
  | { ok: false; status: number; error: string; code?: ApiErrorCode; results?: BulkOpResult[] };

export interface ShimContext {
  admin: SupabaseClient;
  collectiveId: string;
  collectiveName: string;
  hostVenueId: string;
  hostVenueName: string;
  userId: string | null;
}

const HEADING_ACTIONS = new Set([
  'create_category',
  'rename_category',
  'delete_category',
  'reorder_categories',
  'reorder_items',
  'sync_categories',
]);
const FOLLOWING_ACTIONS = new Set(['sync_provider', 'link_provider', 'sync_all_providers', 'unlink_all_providers']);

const refuse = (status: number, code: ApiErrorCode, error: string): ShimResult => ({ ok: false, status, code, error });

export async function applyReplicasCatalogueAction(ctx: ShimContext, input: CatalogueActionInput): Promise<ShimResult> {
  const names = { collective: ctx.collectiveName, host: ctx.hostVenueName };

  if (HEADING_ACTIONS.has(input.action)) {
    return refuse(
      409,
      'COLLECTIVE_HEADINGS_FOLLOW_SERVICES',
      `Headings on the ${ctx.collectiveName} page follow the headings of your services. Change them on your Services page, under Categories.`,
    );
  }
  if (FOLLOWING_ACTIONS.has(input.action)) return { ok: true };
  if (input.action === 'detach_provider') {
    return refuse(
      409,
      'COLLECTIVE_REPLICAS_ALWAYS_FOLLOW',
      `Every venue's copy of a service on the ${ctx.collectiveName} page follows yours, so it cannot be detached.`,
    );
  }

  const bulk = async (ops: BulkOp[]): Promise<ShimResult> => {
    if (ops.length === 0) return { ok: false, status: 400, error: 'No changes to save.' };
    const outcome = await runBulkOps(ctx.admin, {
      collectiveId: ctx.collectiveId,
      actorVenueId: ctx.hostVenueId,
      actorUserId: ctx.userId,
      names,
      ops,
    });
    if (outcome.linkIds.length > 0) {
      await applyLinksInline(ctx.admin, outcome.linkIds, { actorVenueId: ctx.hostVenueId, actorUserId: ctx.userId });
    }
    const failed = outcome.results.filter((r) => !r.ok);
    if (failed.length === 0) return { ok: true, results: outcome.results };
    // A partial failure is reported per operation, never as success (CB-45).
    return {
      ok: false,
      status: failed.length === outcome.results.length ? 409 : 207,
      error:
        failed.length === outcome.results.length
          ? (failed[0]!.message ?? 'None of the changes could be applied.')
          : `${failed.length} of ${outcome.results.length} changes could not be applied.`,
      code: failed[0]!.code as ApiErrorCode | undefined,
      results: outcome.results,
    };
  };

  const masterOf = async (itemId: string | undefined) => {
    if (!itemId) return null;
    const { data } = await ctx.admin
      .from('collective_service_items')
      .select('id, master_service_id')
      .eq('id', itemId)
      .eq('collective_id', ctx.collectiveId)
      .maybeSingle();
    return (data?.master_service_id as string | null | undefined) ?? null;
  };

  /** The calendars at a venue that offer its copy of an offering. */
  const calendarsOffering = async (itemId: string, venueId: string): Promise<string[]> => {
    const { data: link } = await ctx.admin
      .from('collective_service_replicas')
      .select('replica_service_id')
      .eq('collective_service_item_id', itemId)
      .eq('venue_id', venueId)
      .is('released_at', null)
      .maybeSingle();
    const serviceId = (link?.replica_service_id as string | null | undefined) ?? (venueId === ctx.hostVenueId ? await masterOf(itemId) : null);
    if (!serviceId) return [];
    const { data: rows } = await ctx.admin.from('calendar_service_assignments').select('calendar_id').eq('service_item_id', serviceId);
    return (rows ?? []).map((r) => r.calendar_id as string);
  };

  switch (input.action) {
    case 'create_item':
    case 'create_items': {
      const sources =
        input.action === 'create_item'
          ? (input.sourceServiceIds ?? []).map((s) => ({ venueId: s.venueId, serviceId: s.sourceServiceId }))
          : (input.services ?? []).map((s) => ({ venueId: s.venueId, serviceId: s.sourceServiceId }));
      if (sources.length === 0 || sources.some((s) => s.venueId !== ctx.hostVenueId)) {
        return refuse(
          409,
          'COLLECTIVE_OFFERING_NEEDS_HOST_SERVICE',
          `Only one of ${ctx.hostVenueName}'s own services can go on the ${ctx.collectiveName} page. To use another venue's service, use Add from another venue on your Services page.`,
        );
      }
      return bulk([...new Set(sources.map((s) => s.serviceId))].map((serviceId) => ({ op: 'offer', service_id: serviceId })));
    }

    case 'archive_item': {
      const master = await masterOf(input.itemId);
      if (!master) return { ok: false, status: 404, error: 'That service is not on the page.' };
      return bulk([{ op: 'withdraw', service_id: master }]);
    }

    case 'update_item': {
      const other = (['name', 'description', 'category', 'categoryId', 'displayOrder', 'defaultDurationMinutes', 'defaultPricePence', 'pricingDisplay', 'allowAnyAvailable'] as const).filter(
        (key) => input[key] !== undefined,
      );
      if (other.length > 0) {
        return refuse(
          409,
          'COLLECTIVE_EDIT_ON_SERVICES_PAGE',
          `A service on the ${ctx.collectiveName} page is changed on your Services page, and every venue follows it.`,
        );
      }
      if (!input.itemId || input.imageUrl === undefined) return { ok: false, status: 400, error: 'Nothing to change.' };
      const { data, error } = await ctx.admin
        .from('collective_service_items')
        .update({ image_url: input.imageUrl || null })
        .eq('id', input.itemId)
        .eq('collective_id', ctx.collectiveId)
        .select('id')
        .maybeSingle();
      if (error) {
        const coded = collectiveDbError(error, names);
        return coded
          ? { ok: false, status: coded.status, error: coded.body.error, code: coded.code }
          : { ok: false, status: 500, error: 'Could not change the photo.' };
      }
      return data ? { ok: true } : { ok: false, status: 404, error: 'That service is not on the page.' };
    }

    case 'add_provider': {
      const master = await masterOf(input.itemId);
      if (!master || !input.venueId) return { ok: false, status: 400, error: 'Choose a service and a venue.' };
      if (!input.practitionerId) {
        return { ok: false, status: 400, error: 'Choose which calendar should offer this service.' };
      }
      return bulk([{ op: 'assign', service_id: master, venue_id: input.venueId, calendar_id: input.practitionerId }]);
    }

    case 'remove_provider': {
      const ops = await opsForProviderRemoval(input.providerId);
      if (!ops) return { ok: false, status: 404, error: 'That calendar is no longer on the page.' };
      return bulk(ops);
    }

    case 'set_providers': {
      const ops: BulkOp[] = [];
      for (const op of input.ops ?? []) {
        if (op.op === 'remove') {
          ops.push(...((await opsForProviderRemoval(op.providerId)) ?? []));
          continue;
        }
        const master = await masterOf(op.itemId);
        if (!master || !op.venueId || !op.practitionerId) continue;
        ops.push({ op: 'assign', service_id: master, venue_id: op.venueId, calendar_id: op.practitionerId });
      }
      return bulk(ops);
    }

    default:
      return { ok: false, status: 400, error: 'Unknown action.' };
  }

  async function opsForProviderRemoval(providerId: string | undefined): Promise<BulkOp[] | null> {
    if (!providerId) return null;
    const { data: provider } = await ctx.admin
      .from('collective_service_providers')
      .select('id, item_id, venue_id, practitioner_id')
      .eq('id', providerId)
      .maybeSingle();
    if (!provider) return null;
    const master = await masterOf(provider.item_id as string);
    if (!master) return null;
    const venueId = provider.venue_id as string;
    const calendars = provider.practitioner_id
      ? [provider.practitioner_id as string]
      : await calendarsOffering(provider.item_id as string, venueId);
    return calendars.map((calendarId) => ({ op: 'unassign', service_id: master, venue_id: venueId, calendar_id: calendarId }));
  }
}
