import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy - ReserveNI',
  description:
    'How JAR 26 LTD trading as ReserveNI collects, uses, and protects personal data when you use our website, platform and booking features.',
};

const LAST_UPDATED = '01 May 2026';

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-5">
          <Link href="/">
            <Image src="/Logo.png" alt="ReserveNI" width={120} height={36} className="h-8 w-auto" />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <div className="rounded-2xl border border-slate-200 bg-white px-8 py-10 shadow-sm">
          <h1 className="mb-2 text-3xl font-bold text-slate-900">Privacy Policy</h1>
          <p className="mb-8 text-sm text-slate-500">Last updated: {LAST_UPDATED}</p>

          <div className="prose prose-slate max-w-none space-y-8 text-sm leading-relaxed text-slate-700">
            <p>
              This Privacy Policy explains how JAR 26 LTD trading as ReserveNI collects, uses and protects personal
              data when you use our website, contact us, enquire about our services, sign up for ReserveNI, or interact
              with booking pages or platform features operated using ReserveNI.
            </p>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">1. Who we are</h2>
              <p>
                ReserveNI is operated by JAR 26 LTD, a company registered in Northern Ireland under company number
                NI740269.
              </p>
              <p className="mt-3">We trade as ReserveNI.</p>
              <p className="mt-3">
                Our registered office is 100a Main Street, Bangor, Northern Ireland, BT20 4AG.
              </p>
              <p className="mt-3">
                Our trading address is 5 Church Road, Holywood, Northern Ireland, BT18 9BU.
              </p>
              <p className="mt-3">
                You can contact us by email:{' '}
                <a href="mailto:hello@reserveni.com" className="text-brand-600 hover:underline">
                  hello@reserveni.com
                </a>
                .
              </p>
              <p className="mt-3">Our ICO registration number is [to be added once issued].</p>
              <p className="mt-3">
                For privacy or data protection requests, please email{' '}
                <a href="mailto:hello@reserveni.com" className="text-brand-600 hover:underline">
                  hello@reserveni.com
                </a>{' '}
                and clearly mark your message as a privacy request. If we publish a dedicated privacy email address, you
                may also use that address.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">2. Scope of this policy</h2>
              <p>This policy applies to personal data we process in connection with:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>visits to our public website;</li>
                <li>enquiries, contact forms and demo requests;</li>
                <li>sales, onboarding and customer communications;</li>
                <li>ReserveNI business customer accounts;</li>
                <li>support requests;</li>
                <li>platform administration, security and billing;</li>
                <li>
                  guest or client bookings made through ReserveNI-powered booking pages, where applicable.
                </li>
              </ul>
              <p className="mt-3">
                Business customers who use the ReserveNI platform may receive additional contractual data-protection
                terms during onboarding, including a data processing addendum. Those terms govern our processing of
                venue-controlled guest/client data in more detail.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">
                3. When we are controller and when we are processor
              </h2>
              <p>
                For personal data collected through our website, sales enquiries, customer accounts, billing, support,
                security, legal compliance, business administration and our own marketing, JAR 26 LTD trading as
                ReserveNI is usually the controller.
              </p>
              <p className="mt-3">
                For personal data about guests, clients or end users that venues or business customers enter into or
                collect through the ReserveNI platform, the venue or business customer is usually the controller and
                ReserveNI acts as processor on that venue&apos;s behalf.
              </p>
              <p className="mt-3">
                Venue customers are responsible for ensuring they have an appropriate lawful basis, privacy notice and
                any required consents for the personal data they collect and use through ReserveNI.
              </p>
              <p className="mt-3">
                If you are a guest or client of a venue and your request relates to a booking, service, cancellation,
                refund, marketing message or client record controlled by that venue, you may need to contact the venue
                directly. We may assist the venue in responding where required by data-protection law or our customer
                terms.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">4. Personal data we collect</h2>
              <p>Depending on how you use ReserveNI, we may collect and process the following types of personal data:</p>

              <p className="mt-4 font-semibold text-slate-900">Website visitors and enquirers</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>name;</li>
                <li>business name;</li>
                <li>job title or role;</li>
                <li>email address;</li>
                <li>phone number;</li>
                <li>enquiry details;</li>
                <li>marketing preferences;</li>
                <li>website usage information;</li>
                <li>IP address, browser information, device information and technical logs.</li>
              </ul>

              <p className="mt-4 font-semibold text-slate-900">Business customers and platform users</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>account holder name;</li>
                <li>business name and trading details;</li>
                <li>business address;</li>
                <li>email address;</li>
                <li>phone number;</li>
                <li>staff user names and roles;</li>
                <li>login and authentication information;</li>
                <li>subscription plan and billing information;</li>
                <li>payment-provider references;</li>
                <li>platform settings;</li>
                <li>booking-page configuration;</li>
                <li>support messages;</li>
                <li>audit logs, security logs and usage records.</li>
              </ul>

              <p className="mt-4 font-semibold text-slate-900">Guests or clients using ReserveNI-powered booking pages</p>
              <p className="mt-2">Depending on the venue&apos;s configuration, booking pages may collect:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>name;</li>
                <li>email address;</li>
                <li>phone number;</li>
                <li>booking date and time;</li>
                <li>service selected;</li>
                <li>venue selected;</li>
                <li>staff or resource selected;</li>
                <li>booking notes or special requests;</li>
                <li>cancellation or rescheduling information;</li>
                <li>deposit/payment references;</li>
                <li>reminder and communication records.</li>
              </ul>

              <p className="mt-4 font-semibold text-slate-900">Sensitive or special-category data</p>
              <p className="mt-2">
                Some venues may ask for information such as accessibility needs, dietary requirements, health-related
                information, injury information, disability-related information or other sensitive details where
                relevant to a booking or service.
              </p>
              <p className="mt-3">
                Venues should not collect health, disability, accessibility, dietary or other sensitive information
                through ReserveNI unless it is necessary for the booking or service and they have a lawful basis for
                doing so. Where a venue collects this information, the venue is responsible for explaining this to the
                individual and complying with applicable data-protection law.
              </p>
              <p className="mt-3">
                ReserveNI does not require venues to collect special-category data unless a specific platform feature or
                venue configuration makes that necessary.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">5. How we collect personal data</h2>
              <p>We may collect personal data:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>
                  directly from you when you use the website, submit a form, contact us, sign up or use the platform;
                </li>
                <li>from business customers who configure the platform or upload/import information;</li>
                <li>from guests or clients who make bookings through ReserveNI-powered booking pages;</li>
                <li>from payment providers, where payments or deposits are processed;</li>
                <li>automatically through website, platform, security and server logs;</li>
                <li>from third-party service providers used to operate, secure, support and improve ReserveNI.</li>
              </ul>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">6. How we use personal data</h2>
              <p>We use personal data for the following purposes:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>to operate and secure our website;</li>
                <li>to respond to enquiries and demo requests;</li>
                <li>to provide information about ReserveNI;</li>
                <li>to create and manage business customer accounts;</li>
                <li>to provide, maintain and improve the ReserveNI platform;</li>
                <li>to support booking pages and booking workflows configured by venues;</li>
                <li>to send transactional emails, confirmations, reminders, notices and service messages;</li>
                <li>to process subscriptions, billing records and payment-provider references;</li>
                <li>to provide customer support;</li>
                <li>to monitor usage, diagnose issues and improve performance;</li>
                <li>to prevent fraud, misuse, spam, unauthorised access and security incidents;</li>
                <li>to comply with legal, tax, accounting and regulatory obligations;</li>
                <li>to establish, exercise or defend legal claims;</li>
                <li>to send marketing communications where permitted by law.</li>
              </ul>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">7. Lawful bases</h2>
              <p>Where ReserveNI acts as controller, we rely on one or more of the following lawful bases:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>
                  <strong>Contract:</strong> where processing is necessary to provide website functions, respond to
                  service requests, manage customer accounts, provide the platform or administer subscriptions.
                </li>
                <li>
                  <strong>Legitimate interests:</strong> where processing is necessary for running and improving our
                  business, responding to enquiries, securing the website and platform, preventing misuse, supporting
                  customers, keeping records and communicating with business contacts, provided those interests are not
                  overridden by individual rights.
                </li>
                <li>
                  <strong>Consent:</strong> where consent is required, for example for certain marketing communications
                  or non-essential cookies/analytics.
                </li>
                <li>
                  <strong>Legal obligation:</strong> where processing is necessary for tax, accounting, company,
                  regulatory, data-protection or other legal obligations.
                </li>
                <li>
                  <strong>Legal claims:</strong> where processing is necessary to establish, exercise or defend legal
                  claims.
                </li>
              </ul>
              <p className="mt-3">
                Where ReserveNI acts as processor for venue-controlled guest/client data, we process that data on the
                instructions of the relevant venue customer, subject to our customer terms and data processing terms.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">8. Guest bookings and venue-controlled data</h2>
              <p>
                Where you make a booking with a venue through a ReserveNI-powered booking page, the venue is usually
                responsible for deciding why and how your booking data is used.
              </p>
              <p className="mt-3">
                ReserveNI provides the software and technical infrastructure that allows the venue to manage bookings,
                reminders, customer records, deposits and related communications.
              </p>
              <p className="mt-3">
                The venue is responsible for its own services, booking rules, cancellation policies, refunds, customer
                communications, marketing permissions and privacy information.
              </p>
              <p className="mt-3">
                If your request relates to a booking, refund, cancellation, no-show, venue service, venue marketing
                message or venue-held client record, you should usually contact the venue first.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">9. Payments and deposits</h2>
              <p>
                Where payments, deposits or subscription payments are made in connection with ReserveNI, they are
                processed by third-party payment providers such as Stripe.
              </p>
              <p className="mt-3">
                ReserveNI does not hold booking money. Booking deposits and venue payments are
                processed and managed through the venue and/or the relevant payment provider.
              </p>
              <p className="mt-3">
                We may receive payment-related information such as payment status, payment references, customer
                identifiers, subscription references, connected-account identifiers, transaction metadata, invoices,
                billing status and fraud/security signals. We do not receive full card numbers from payment providers.
              </p>
              <p className="mt-3">
                Payment providers process personal data in accordance with their own terms and privacy policies.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">10. Emails, SMS and service messages</h2>
              <p>
                ReserveNI and venues using ReserveNI may send transactional or service messages, such as booking
                confirmations, reminders, cancellation notices, deposit requests, account emails, security messages and
                support communications.
              </p>
              <p className="mt-3">
                These messages are generally necessary to provide the website, platform, booking or customer service
                requested.
              </p>
              <p className="mt-3">
                Marketing emails, promotional SMS messages, newsletters, offers, rebooking campaigns or similar
                marketing communications will only be sent where permitted by law. You can opt out of ReserveNI
                marketing communications at any time by using the unsubscribe option where provided or by contacting
                us.
              </p>
              <p className="mt-3">
                Venues are responsible for ensuring they have the correct permissions to send their own marketing
                communications through or in connection with ReserveNI.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">11. Cookies and similar technologies</h2>
              <p>
                We use cookies and similar technologies where necessary to operate, secure and improve our website and
                platform.
              </p>
              <p className="mt-3">
                If we use only strictly necessary cookies, we will not use those cookies for advertising or
                non-essential tracking.
              </p>
              <p className="mt-3">
                If we introduce analytics, advertising, tracking pixels, heatmaps or other non-essential cookies or
                similar technologies, we will update this policy and, where required, ask for consent before those
                technologies are used.
              </p>
              <p className="mt-3">
                You can usually control cookies through your browser settings. Blocking some cookies may affect how the
                website or platform works.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">12. Who we share personal data with</h2>
              <p>
                We may share personal data with trusted third-party providers who help us operate, secure and support
                ReserveNI. These may include:
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>hosting and infrastructure providers;</li>
                <li>database and authentication providers;</li>
                <li>payment providers such as Stripe;</li>
                <li>email and SMS providers;</li>
                <li>customer support and CRM tools;</li>
                <li>analytics providers, where enabled;</li>
                <li>professional advisers, such as accountants, lawyers and insurers;</li>
                <li>regulators, public authorities, courts or law enforcement where required by law.</li>
              </ul>
              <p className="mt-3">
                Examples of providers we may use include Stripe for payments, Supabase for database/authentication,
                Vercel for hosting, and email/SMS providers for transactional communications. This list should be kept
                accurate and updated to reflect the providers actually used.
              </p>
              <p className="mt-3">We do not sell personal data to advertisers.</p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">13. International transfers</h2>
              <p>Some of our service providers may process personal data outside the United Kingdom.</p>
              <p className="mt-3">
                Where personal data is transferred internationally, we will take steps designed to ensure appropriate
                safeguards are in place, such as adequacy regulations, standard contractual clauses, the UK
                International Data Transfer Agreement/Addendum or other lawful transfer mechanisms where required.
              </p>
              <p className="mt-3">
                Venue-controlled guest/client data may also be subject to the venue&apos;s own privacy information and
                data-processing arrangements.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">14. How long we keep personal data</h2>
              <p>
                We keep personal data only for as long as needed for the purposes described in this policy, including to
                provide services, comply with legal obligations, resolve disputes, maintain security and enforce
                agreements.
              </p>
              <p className="mt-3">As a guide:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>
                  website enquiry and demo request data is usually kept for up to 24 months after the last meaningful
                  contact;
                </li>
                <li>
                  marketing-contact records are kept until you unsubscribe or object, plus a suppression record so we do
                  not contact you again by mistake;
                </li>
                <li>
                  customer account and subscription records are kept for the duration of the customer relationship and
                  then for a period needed for legal, accounting, tax and dispute purposes;
                </li>
                <li>billing, invoice and accounting records are usually kept for up to 6 years;</li>
                <li>support records are usually kept for up to 3 years after the matter is closed;</li>
                <li>
                  technical, audit and security logs are usually kept for a shorter period unless needed to investigate
                  misuse, fraud, security incidents or legal issues;
                </li>
                <li>
                  guest booking and client data controlled by venues is retained in accordance with the relevant
                  venue&apos;s settings, instructions and our customer terms;
                </li>
                <li>
                  backups may retain limited data for a temporary period before being overwritten or deleted in the
                  ordinary backup cycle.
                </li>
              </ul>
              <p className="mt-3">
                We may retain limited information for longer where necessary to comply with law, maintain suppression
                lists, resolve disputes, prevent fraud, enforce terms or establish, exercise or defend legal claims.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">15. Security</h2>
              <p>
                We use technical and organisational measures designed to protect personal data against unauthorised
                access, loss, misuse, alteration or disclosure.
              </p>
              <p className="mt-3">
                These measures may include access controls, authentication, encryption in transit, logging,
                monitoring, backups, staff access controls, vendor due diligence and internal procedures.
              </p>
              <p className="mt-3">
                No website, platform or transmission method is completely secure. Business customers are responsible
                for keeping their own accounts, passwords, devices, staff permissions and venue configurations secure.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">16. Your rights</h2>
              <p>Depending on the circumstances and applicable law, you may have rights to:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>access your personal data;</li>
                <li>correct inaccurate personal data;</li>
                <li>request deletion of your personal data;</li>
                <li>restrict processing;</li>
                <li>object to processing;</li>
                <li>request data portability;</li>
                <li>withdraw consent where processing is based on consent;</li>
                <li>complain to the Information Commissioner&apos;s Office.</li>
              </ul>
              <p className="mt-3">
                To exercise your rights, email{' '}
                <a href="mailto:hello@reserveni.com" className="text-brand-600 hover:underline">
                  hello@reserveni.com
                </a>{' '}
                and clearly mark your message as a privacy request.
              </p>
              <p className="mt-3">
                If your request relates to venue-controlled guest/client data, we may need to refer you to the relevant
                venue or consult the venue before responding.
              </p>
              <p className="mt-3">We may need to verify your identity before acting on a request.</p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">17. Children and minors</h2>
              <p>ReserveNI is not intended for children to create business accounts or manage venue services.</p>
              <p className="mt-3">
                Some venues may use ReserveNI to manage bookings made by adults on behalf of children or young people. In
                those cases, the venue is responsible for ensuring it has appropriate privacy information, permissions
                and safeguards for the booking and service provided.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">18. Automated decision-making</h2>
              <p>
                We do not currently use personal data collected through the public website to make decisions based solely
                on automated processing that produce legal or similarly significant effects on individuals.
              </p>
              <p className="mt-3">
                If this changes, we will update this policy and provide any information required by law.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">19. Complaints</h2>
              <p>
                If you have concerns about how we handle personal data, please contact us first so we can try to resolve
                the issue.
              </p>
              <p className="mt-3">
                You also have the right to complain to the Information Commissioner&apos;s Office, the UK data protection
                regulator. Further information is available at{' '}
                <a
                  href="https://www.ico.org.uk"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-600 hover:underline"
                >
                  www.ico.org.uk
                </a>
                .
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">20. Changes to this policy</h2>
              <p>
                We may update this Privacy Policy from time to time. The latest version will be published on this page
                with the updated date shown above.
              </p>
            </section>
          </div>
        </div>

        <div className="mt-6 text-center text-xs text-slate-400">
          <Link href="/terms" className="hover:text-brand-600">
            Website Terms of Use
          </Link>
          {' · '}
          <Link href="/" className="hover:text-brand-600">
            Back to ReserveNI
          </Link>
        </div>
      </main>
    </div>
  );
}
