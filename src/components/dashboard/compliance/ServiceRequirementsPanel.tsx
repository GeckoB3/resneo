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

/** Venue-wide requirement row; carries both polymorphic service FK columns. */
interface VenueRequirementRow {
  id: string;
  appointment_service_id: string | null;
  service_item_id: string | null;
  compliance_type_name: string;
}

/**
 * Settings → Compliance → Service requirements: every active service as an
 * expandable row with an at-a-glance count of its compliance requirements,
 * opening into the shared per-service requirements editor.
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
  // One venue-wide fetch powers the per-service indicators; refreshed via
  // onChanged when a requirement is added or removed inside a row.
  const { data: summary, mutate: mutateSummary } = useSWR<{ requirements: VenueRequirementRow[] }>(
    complianceEnabled ? '/api/venue/compliance/requirements' : null,
    complianceJsonFetcher,
  );
  const services = (data?.services ?? []).filter((s) => s.is_active !== false);

  const typeNamesByService = new Map<string, string[]>();
  for (const r of summary?.requirements ?? []) {
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
        title="Service requirements"
        description="Choose which compliance types each service requires, such as a patch test or a signed consent form. When a service needs a type, its bookings warn or block until the client has a valid record on file. You can set the same requirements while editing a service."
      />
      <SectionCard.Body>
        {flags && !complianceEnabled ? (
          <p className="text-sm text-slate-500">
            Turn on <span className="font-medium">Enable compliance records</span> in the General settings tab to
            connect services to compliance types.
          </p>
        ) : isLoading ? (
          <p className="text-sm text-slate-500">Loading services…</p>
        ) : services.length === 0 ? (
          <p className="text-sm text-slate-500">No services to configure yet.</p>
        ) : (
          <div className="space-y-3">
            {services.map((s) => {
              const typeNames = typeNamesByService.get(s.id) ?? [];
              return (
                <details key={s.id} className="group rounded-lg border border-slate-200">
                  <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
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
                    <span className="min-w-0 flex-1 break-words text-sm font-medium text-slate-800">{s.name}</span>
                    {summary ? (
                      typeNames.length > 0 ? (
                        <span className="shrink-0" title={typeNames.join(', ')}>
                          <Pill variant="brand" size="sm" dot>
                            {typeNames.length} requirement{typeNames.length === 1 ? '' : 's'}
                          </Pill>
                        </span>
                      ) : (
                        <span className="shrink-0 text-xs text-slate-400">No requirements</span>
                      )
                    ) : null}
                  </summary>
                  <div className="border-t border-slate-100 p-3 sm:p-4">
                    <ComplianceRequirementsEditor
                      appointmentServiceId={s.id}
                      complianceEnabled={complianceEnabled}
                      embedded
                      onChanged={() => void mutateSummary()}
                    />
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </SectionCard.Body>
    </SectionCard>
  );
}
