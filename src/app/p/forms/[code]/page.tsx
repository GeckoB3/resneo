import type { Metadata } from 'next';
import { getSupabaseAdminClient } from '@/lib/supabase';
import { loadPublicFormByCode, type PublicFormUnavailableReason } from '@/lib/compliance/public-forms-service';
import { PublicComplianceForm } from './PublicComplianceForm';

export const metadata: Metadata = {
  title: 'Complete your form',
  robots: { index: false, follow: false },
};

const UNAVAILABLE_COPY: Record<PublicFormUnavailableReason, { title: string; body: string }> = {
  not_found: {
    title: 'Form not found',
    body: 'This link is not valid. Please check the link or contact the venue.',
  },
  consumed: {
    title: 'Already submitted',
    body: 'This form has already been completed. If you need to make a change, please contact the venue.',
  },
  revoked: {
    title: 'Link no longer active',
    body: 'This form link has been cancelled. Please contact the venue for a new one.',
  },
  expired: {
    title: 'Link expired',
    body: 'This form link has expired. Please contact the venue to request a new one.',
  },
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto w-full max-w-xl">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">{children}</div>
        <p className="mt-4 text-center text-xs text-slate-400">Powered by Resneo</p>
      </div>
    </main>
  );
}

export default async function PublicComplianceFormPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const admin = getSupabaseAdminClient();
  const result = await loadPublicFormByCode(admin, code);

  if (!result.ok) {
    const copy = UNAVAILABLE_COPY[result.reason];
    return (
      <Shell>
        <h1 className="text-lg font-semibold text-slate-900">{copy.title}</h1>
        <p className="mt-2 text-sm text-slate-600">{copy.body}</p>
      </Shell>
    );
  }

  const { schema, prefill, type_name, venue_name } = result.value;
  return (
    <Shell>
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">{venue_name}</p>
        <h1 className="mt-1 text-xl font-semibold text-slate-900">{schema.title}</h1>
      </header>
      <PublicComplianceForm
        code={code}
        schema={schema}
        prefill={prefill}
        typeName={type_name}
        venueName={venue_name}
      />
    </Shell>
  );
}
