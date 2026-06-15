import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Data Processing Agreement - ResNeo',
  description:
    'Data Processing Agreement governing how JAR 26 LTD trading as ResNeo processes personal data on behalf of business customers under UK GDPR.',
};

const LAST_UPDATED = '03 May 2026';

export default function DataProcessingPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-5">
          <Link href="/">
            <Image src="/Logo.png" alt="ResNeo" width={120} height={36} className="h-8 w-auto" />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <div className="rounded-2xl border border-slate-200 bg-white px-8 py-10 shadow-sm">
          <h1 className="mb-2 text-3xl font-bold text-slate-900">Data Processing Agreement</h1>
          <p className="mb-2 text-sm text-slate-500">Last updated: {LAST_UPDATED}</p>
          <p className="mb-8 text-sm text-slate-500">
            This Data Processing Agreement (&ldquo;DPA&rdquo;) forms part of the{' '}
            <Link href="/terms/customer" className="text-brand-600 hover:underline">
              Customer Terms
            </Link>{' '}
            and governs the processing of personal data by JAR 26 LTD trading as ResNeo on behalf of business
            customers. It is entered into by ResNeo and the Customer automatically on acceptance of the Customer
            Terms.
          </p>

          <div className="space-y-8 text-sm leading-relaxed text-slate-700">

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">1. Definitions</h2>
              <p>In this DPA, the following terms have the meanings given below. Terms not defined here have the
              meanings given in the{' '}
              <Link href="/terms/customer" className="text-brand-600 hover:underline">Customer Terms</Link>.</p>
              <ul className="mt-3 space-y-2 pl-0">
                <li>
                  <strong>&ldquo;Controller&rdquo;</strong> means the Customer (you), who determines the purposes
                  and means of processing personal data relating to your guests, clients, and staff.
                </li>
                <li className="mt-2">
                  <strong>&ldquo;Processor&rdquo;</strong> means JAR 26 LTD trading as ResNeo, who processes
                  personal data on behalf of the Controller.
                </li>
                <li className="mt-2">
                  <strong>&ldquo;Data Protection Law&rdquo;</strong> means the UK General Data Protection
                  Regulation (UK GDPR) as retained in UK law by the European Union (Withdrawal) Act 2018, the Data
                  Protection Act 2018, and any other applicable UK data protection legislation, as amended from time
                  to time.
                </li>
                <li className="mt-2">
                  <strong>&ldquo;Personal Data&rdquo;</strong> has the meaning given in Data Protection Law —
                  broadly, any information relating to an identified or identifiable living individual.
                </li>
                <li className="mt-2">
                  <strong>&ldquo;Processing&rdquo;</strong> has the meaning given in Data Protection Law, and
                  includes storing, organising, retrieving, using, disclosing, and deleting personal data.
                </li>
                <li className="mt-2">
                  <strong>&ldquo;Sub-processor&rdquo;</strong> means any third-party processor engaged by ResNeo
                  to process Personal Data in connection with the ResNeo platform.
                </li>
                <li className="mt-2">
                  <strong>&ldquo;Data Subject&rdquo;</strong> means an identified or identifiable individual whose
                  Personal Data is processed.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">
                2. Roles: controller and processor
              </h2>
              <p>
                The parties acknowledge that, in relation to personal data processed through the ResNeo platform
                on the Customer&rsquo;s behalf:
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>
                  the <strong>Customer is the data controller</strong> — you determine the purposes and means of
                  collecting and using personal data about your guests, clients, and staff through the platform;
                </li>
                <li>
                  <strong>ResNeo is the data processor</strong> — we process that personal data only on your
                  behalf, in accordance with your instructions and this DPA.
                </li>
              </ul>
              <p className="mt-3">
                Each party remains independently responsible for its own compliance with Data Protection Law in
                relation to personal data for which it acts as controller.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">
                3. Subject matter, nature, and purpose of processing
              </h2>
              <p>ResNeo processes Personal Data as part of providing the ResNeo platform to you. The nature
              and purpose of processing is:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>storing, managing, and retrieving booking and reservation records;</li>
                <li>managing guest profiles and contact information;</li>
                <li>sending automated booking confirmations, reminders, and notifications;</li>
                <li>processing payments and deposits through Stripe on your behalf;</li>
                <li>providing you with reporting and analytics on your bookings;</li>
                <li>enabling you and your staff to access and manage guest and booking data through the dashboard;</li>
                <li>maintaining audit logs and records necessary to operate the platform.</li>
              </ul>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">
                4. Types of personal data and categories of data subjects
              </h2>
              <p>
                <strong>Categories of data subjects:</strong> your guests and clients who make or are associated
                with bookings; your staff members and admin users who access the platform.
              </p>
              <p className="mt-3">
                <strong>Types of personal data processed may include:</strong>
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>names;</li>
                <li>email addresses;</li>
                <li>phone numbers (including mobile numbers for SMS communications);</li>
                <li>booking details (dates, times, party size, service type, notes);</li>
                <li>payment references (Stripe payment intent IDs — not card numbers, which are held by Stripe);</li>
                <li>deposit and transaction records;</li>
                <li>communications history (email and SMS confirmation and reminder records);</li>
                <li>
                  staff account information (name, email address, account credentials managed via Supabase Auth).
                </li>
              </ul>
              <p className="mt-3">
                ResNeo does not intentionally process special category personal data (such as health data,
                biometric data, or criminal offence data). You must not upload special category data to the
                platform unless you have a lawful basis to do so and have first discussed this with us.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">5. Duration of processing</h2>
              <p>
                ResNeo will process Personal Data for the duration of your subscription, and for up to 30 days
                after termination to allow for data export. After this period, we will delete or anonymise Personal
                Data within a reasonable timeframe in accordance with our data retention practices, unless we are
                required to retain it longer by law.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">
                6. ResNeo&rsquo;s obligations as processor
              </h2>
              <p>ResNeo will:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>
                  process Personal Data only on your documented instructions, including as set out in this DPA,
                  the Customer Terms, and as required by law;
                </li>
                <li>
                  not process Personal Data for any purpose other than providing the platform and related services,
                  unless required to do so by law (in which case we will inform you, to the extent permitted by
                  law);
                </li>
                <li>
                  ensure that staff authorised to process Personal Data are bound by appropriate confidentiality
                  obligations;
                </li>
                <li>
                  implement appropriate technical and organisational measures to protect Personal Data against
                  accidental or unlawful destruction, loss, alteration, unauthorised disclosure, or access (see
                  section 9);
                </li>
                <li>
                  assist you, to the extent reasonably possible, in responding to requests from data subjects
                  exercising their rights under Data Protection Law (see section 7);
                </li>
                <li>
                  notify you without undue delay (and within 72 hours where feasible) upon becoming aware of a
                  personal data breach affecting Personal Data processed on your behalf (see section 10);
                </li>
                <li>
                  at your request, provide information reasonably necessary to demonstrate compliance with this DPA
                  and Data Protection Law;
                </li>
                <li>
                  on termination of the Customer Terms, delete or anonymise Personal Data in accordance with
                  section 5 of this DPA, unless retention is required by law.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">7. Your obligations as controller</h2>
              <p>You confirm that, in relation to Personal Data processed through the platform, you:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>
                  have a lawful basis under Data Protection Law for collecting and processing the Personal Data you
                  upload or generate through the platform;
                </li>
                <li>
                  have provided, or will provide, data subjects with the information required by Data Protection Law
                  (including a privacy notice) about how their data is used;
                </li>
                <li>
                  are responsible for handling data subject rights requests (access, rectification, erasure,
                  restriction, portability, objection) received by you directly, and will notify us promptly where
                  our assistance is required;
                </li>
                <li>
                  are responsible for ensuring that any personal data you instruct us to process is accurate and
                  not excessive for the stated purpose.
                </li>
              </ul>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">8. Sub-processors</h2>
              <p>
                You provide general authorisation for ResNeo to engage sub-processors to help deliver the
                platform. ResNeo will ensure that sub-processors are bound by data protection obligations
                equivalent to those in this DPA.
              </p>
              <p className="mt-3">
                We will notify you of any intended changes to sub-processors (additions or replacements) by
                updating this page and providing at least 14 days&rsquo; notice by email. You may object to a new
                sub-processor on legitimate data protection grounds; if we cannot accommodate your objection, you
                may terminate your subscription without penalty.
              </p>
              <p className="mt-4 font-medium text-slate-800">Current sub-processors:</p>
              <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="px-4 py-2.5 text-left font-semibold text-slate-700">Sub-processor</th>
                      <th className="px-4 py-2.5 text-left font-semibold text-slate-700">Purpose</th>
                      <th className="px-4 py-2.5 text-left font-semibold text-slate-700">Location</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    <tr>
                      <td className="px-4 py-2.5 font-medium text-slate-700">Supabase Inc.</td>
                      <td className="px-4 py-2.5 text-slate-600">
                        Database hosting, authentication, and real-time data
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">EU (AWS eu-west-1)</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2.5 font-medium text-slate-700">Stripe, Inc.</td>
                      <td className="px-4 py-2.5 text-slate-600">
                        Payment processing and Stripe Connect (deposit collection)
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">USA / EU</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2.5 font-medium text-slate-700">Twilio Inc.</td>
                      <td className="px-4 py-2.5 text-slate-600">
                        SMS booking confirmations, reminders, and notifications
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">USA / EU</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2.5 font-medium text-slate-700">Twilio SendGrid</td>
                      <td className="px-4 py-2.5 text-slate-600">
                        Transactional email (booking confirmations, reminders)
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">USA / EU</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2.5 font-medium text-slate-700">Vercel Inc.</td>
                      <td className="px-4 py-2.5 text-slate-600">
                        Platform hosting and serverless compute
                      </td>
                      <td className="px-4 py-2.5 text-slate-600">USA / EU</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">9. Security measures</h2>
              <p>
                ResNeo implements and maintains appropriate technical and organisational measures to protect
                Personal Data. These include:
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>
                  encryption of data in transit using TLS and at rest using encryption provided by our
                  infrastructure providers;
                </li>
                <li>row-level security controls at the database layer to isolate data by venue;</li>
                <li>access controls limiting staff access to Personal Data on a need-to-know basis;</li>
                <li>authentication controls including password requirements managed through Supabase Auth;</li>
                <li>use of environment-separated secrets management (server-side only) for API keys and credentials;</li>
                <li>regular dependency updates and security patching;</li>
                <li>
                  reliance on sub-processors (Supabase, Vercel, Stripe) who maintain their own ISO 27001 or
                  equivalent security certifications.
                </li>
              </ul>
              <p className="mt-3">
                We will review and update security measures from time to time to respond to new threats and
                industry developments. We will provide information about our security measures on request.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">10. Personal data breaches</h2>
              <p>
                If ResNeo becomes aware of a personal data breach affecting Personal Data processed on your
                behalf, we will notify you without undue delay and, where feasible, within 72 hours of becoming
                aware. Notification will include:
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>a description of the nature of the breach, including the categories and approximate number of
                data subjects and records affected (to the extent known);</li>
                <li>the likely consequences of the breach;</li>
                <li>the measures taken or proposed to address the breach.</li>
              </ul>
              <p className="mt-3">
                You are responsible for assessing whether you are required to notify the Information
                Commissioner&rsquo;s Office (ICO) or affected data subjects, and for making any such
                notifications. We will provide you with reasonable assistance in doing so.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">11. International data transfers</h2>
              <p>
                Some of our sub-processors are located outside the UK (including in the United States). Where
                Personal Data is transferred to a country that does not provide an equivalent level of data
                protection to the UK, we will ensure appropriate safeguards are in place in accordance with Data
                Protection Law. These may include:
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>reliance on UK adequacy regulations where applicable;</li>
                <li>UK International Data Transfer Agreements (IDTAs) or UK Addendums to EU Standard Contractual
                Clauses where required;</li>
                <li>transfers to processors certified under recognised frameworks such as the UK-US Data Bridge.</li>
              </ul>
              <p className="mt-3">
                Details of the safeguards used for each sub-processor are available on request.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">
                12. Audit rights
              </h2>
              <p>
                You may, with reasonable prior written notice (at least 30 days) and no more than once per year,
                request information from ResNeo to verify compliance with this DPA. ResNeo will provide
                relevant documentation and answer reasonable written questions. Physical audits of ResNeo
                infrastructure are conducted through our sub-processors&rsquo; existing audit and certification
                programmes (such as SOC 2 reports from Supabase or Vercel), which we will make available on
                request in lieu of a separate on-site audit.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">13. Changes to this DPA</h2>
              <p>
                We may update this DPA from time to time to reflect changes in Data Protection Law, our
                processing activities, or sub-processors. We will provide at least 14 days&rsquo; notice of
                material changes by email. Continued use of the platform after the effective date of changes
                constitutes acceptance of the updated DPA.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">14. Contact and data protection queries</h2>
              <p>
                For data protection queries, data subject rights requests relating to our processing, or to raise
                a concern about data protection practices, please contact us at:{' '}
                <a href="mailto:hello@resneo.com" className="text-brand-600 hover:underline">
                  hello@resneo.com
                </a>
                .
              </p>
              <p className="mt-3">
                If you have concerns about how Personal Data is handled that we have not resolved to your
                satisfaction, you have the right to lodge a complaint with the Information Commissioner&rsquo;s
                Office (ICO) at{' '}
                <a
                  href="https://ico.org.uk"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-600 hover:underline"
                >
                  ico.org.uk
                </a>
                .
              </p>
            </section>

          </div>
        </div>

        <div className="mt-6 text-center text-xs text-slate-400">
          <Link href="/terms/customer" className="hover:text-brand-600">
            Customer Terms
          </Link>
          {' · '}
          <Link href="/terms" className="hover:text-brand-600">
            Website Terms of Use
          </Link>
          {' · '}
          <Link href="/privacy" className="hover:text-brand-600">
            Privacy Policy
          </Link>
          {' · '}
          <Link href="/" className="hover:text-brand-600">
            Back to ResNeo
          </Link>
        </div>
      </main>
    </div>
  );
}
