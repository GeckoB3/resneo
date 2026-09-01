'use client';

import useSWR from 'swr';
import { SectionCard } from '@/components/ui/dashboard/SectionCard';
import { Pill } from '@/components/ui/dashboard/Pill';
import { ComplianceRequirementsEditor } from '@/components/dashboard/compliance/ComplianceRequirementsEditor';
import { complianceJsonFetcher } from '@/components/dashboard/compliance/shared';

interface ServiceRow {
  id: string;
  name: string;
  is_active?: boolean;
}

/** One requirement row from the venue-wide list; carries both polymorphic service FK columns. */
interface VenueRequirementRow {
  id: string;
  scope?: string;
  appointment_service_id: string | null;
  service_item_id: string | null;
  compliance_type_name: string;
}

/** A row applies to every appointment booking when it is venue-scoped (no service FK). */
function isVenueWide(r: VenueRequirementRow): boolean {
  return r.scope === 'venue' || (!r.appointment_service_id && !r.service_item_id);
}

function ChevronIcon() {
  return (
    <svg
      className="h-4 w-4 shrink-0 text-slate-400 transition-transform duration-150 group-open:rotate-90"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

function CountPill({ names, loaded }: { names: string[]; loaded: boolean }) {
  if (!loaded) return null;
  if (names.length === 0) return <span className="shrink-0 text-xs text-slate-400">No requirements</span>;
  return (
    <span className="shrink-0" title={names.join(', ')}>
      <Pill variant="brand" size="sm" dot>
        {names.length} requirement{names.length === 1 ? '' : 's'}
      </Pill>
    </span>
  );
}

/**
 * Settings → Compliance → Requirements: a pinned "All bookings" row for the
 * requirements every appointment booking must meet (plan §4), then every active
 * service as an expandable row with an at-a-glance count of its own requirements.
 * Both open into the shared requirements editor.
 */
export function ServiceRequirementsPanel() {
  const { data: flags } = useSWR<{ raw: { compliance_records_enabled?: boolean } }>(
    '/api/venue/feature-flags',
    complianceJsonFetcher,
  );
  const { data, isLoading } = useSWR<{ services: ServiceRow[] }>(
    '/api/venue/appointment-services',
    complianceJsonFetcher,
  );
  const complianceEnabled = flags?.raw?.compliance_records_enabled ?? false;
  // One venue-wide fetch powers the per-row indicators; refreshed via
  // onChanged when a requirement is added or removed inside a row.
  const { data: summary, mutate: mutateSummary } = useSWR<{ requirements: VenueRequirementRow[] }>(
    complianceEnabled ? '/api/venue/compliance/requirements' : null,
    complianceJsonFetcher,
  );
  const services = (data?.services ?? []).filter((s) => s.is_active !== false);

  const venueWideNames: string[] = [];
  const typeNamesByService = new Map<string, string[]>();
  for (const r of summary?.requirements ?? []) {
    if (isVenueWide(r)) {
      venueWideNames.push(r.compliance_type_name);
      continue;
    }
    const serviceId = r.appointment_service_id ?? r.service_item_id;
    if (!serviceId) continue;
    const names = typeNamesByService.get(serviceId) ?? [];
    names.push(r.compliance_type_name);
    typeNamesByService.set(serviceId, names);
  }

  return (
    <SectionCard elevated>
      <SectionCard.Header
        eyebrow="Compliance"
        title="Requirements"
        description="Choose which compliance types every booking needs, and which extra ones each service needs, such as a patch test or a signed consent form. When a booking needs a type, it warns or blocks until the client has a valid record on file. You can set a service's own requirements while editing that service too."
      />
      <SectionCard.Body>
        {flags && !complianceEnabled ? (
          <p className="text-sm text-slate-500">
            Turn on <span className="font-medium">Enable compliance records</span> in the General settings tab to
            connect services to compliance types.
          </p>
        ) : isLoading ? (
          <p className="text-sm text-slate-500">Loading services…</p>
        ) : (
          <div className="space-y-3">
            <details className="group rounded-lg border border-brand-200 bg-brand-50/30">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
                <ChevronIcon />
                <span className="min-w-0 flex-1 break-words text-sm font-medium text-slate-800">All bookings</span>
                <CountPill names={venueWideNames} loaded={Boolean(summary)} />
              </summary>
              <div className="border-t border-brand-100 p-3 sm:p-4">
                <p className="mb-3 text-xs text-slate-600">
                  Forms listed here are asked for on every appointment booking, whatever the service. Use this for
                  a new client intake form or a general consent. A form with no expiry is asked for once per
                  client; one that expires is asked for again after that long; a per-visit form is asked for
                  every time.
                </p>
                <ComplianceRequirementsEditor
                  scope="venue"
                  complianceEnabled={complianceEnabled}
                  embedded
                  onChanged={() => void mutateSummary()}
                />
              </div>
            </details>

            {services.length === 0 ? (
              <p className="text-sm text-slate-500">No services to configure yet.</p>
            ) : (
              services.map((s) => {
                const typeNames = typeNamesByService.get(s.id) ?? [];
                return (
                  <details key={s.id} className="group rounded-lg border border-slate-200">
                    <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
                      <ChevronIcon />
                      <span className="min-w-0 flex-1 break-words text-sm font-medium text-slate-800">{s.name}</span>
                      <CountPill names={typeNames} loaded={Boolean(summary)} />
                    </summary>
                    <div className="border-t border-slate-100 p-3 sm:p-4">
                      <ComplianceRequirementsEditor
                        appointmentServiceId={s.id}
                        complianceEnabled={complianceEnabled}
                        embedded
                        venueWideTypeNames={venueWideNames}
                        onChanged={() => void mutateSummary()}
                      />
                    </div>
                  </details>
                );
              })
            )}
          </div>
        )}
      </SectionCard.Body>
    </SectionCard>
  );
}
