import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Website Terms of Use - ResNeo',
  description:
    'Rules for using the ResNeo public website and general pages at www.resneo.com, operated by JAR 26 LTD trading as ResNeo.',
};

const LAST_UPDATED = '01 May 2026';

export default function TermsPage() {
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
          <h1 className="mb-2 text-3xl font-bold text-slate-900">Website Terms of Use</h1>
          <p className="mb-8 text-sm text-slate-500">Last updated: {LAST_UPDATED}</p>

          <div className="space-y-8 text-sm leading-relaxed text-slate-700">
            <section>
              <p>
                These Website Terms of Use explain the rules for using the ResNeo website and general public pages,
                including www.resneo.com and any related public pages we operate.
              </p>
              <p className="mt-3">
                By using this website, you agree to these terms. If you do not agree to them, you should not use the
                website.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">1. Who we are</h2>
              <p>
                This website is operated by JAR 26 LTD, a company registered in Northern Ireland under company number
                NI740269, trading as ResNeo.
              </p>
              <p className="mt-3">
                Our registered office is 100a Main Street, Bangor, Northern Ireland, BT20 4AG.
              </p>
              <p className="mt-3">
                Our trading address is 5 Church Road, Holywood, Northern Ireland, BT18 9BU.
              </p>
              <p className="mt-3">
                You can contact us by email:{' '}
                <a href="mailto:hello@resneo.com" className="text-brand-600 hover:underline">
                  hello@resneo.com
                </a>
                .
              </p>
              <p className="mt-3">
                For legal notices, privacy requests, customer support, or formal correspondence, please use the contact
                details or contact form made available on our website. We may also provide a dedicated email address
                for specific legal, privacy, billing or support matters.
              </p>
              <p className="mt-3">Our ICO registration number is ZC137345.</p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">2. What ResNeo does</h2>
              <p>
                ResNeo provides booking and business-management software for venues and service-based businesses. Our
                platform may include booking pages, booking widgets, staff/resource management, client records,
                reminders, deposit collection functionality, reporting and related tools.
              </p>
              <p className="mt-3">
                The public website provides general information about ResNeo, our features, pricing, and how
                prospective business customers can contact us or sign up.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">
                3. These Website Terms of Use are not the full customer contract
              </h2>
              <p>These Website Terms of Use apply to visitors using the public website.</p>
              <p className="mt-3">
                If you sign up for, subscribe to, or onboard onto the ResNeo platform as a business customer, your
                use of the platform may also be governed by separate customer terms, an order form, subscription terms,
                payment terms, data processing terms and any onboarding documents agreed with you.
              </p>
              <p className="mt-3">
                If there is any conflict between these Website Terms of Use and the specific customer terms agreed with
                you during sign-up or onboarding, the customer terms will take priority for your use of the paid
                ResNeo platform.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">4. Pricing and feature information</h2>
              <p>
                We try to keep the information on our website accurate and up to date. However, features, pricing,
                plans, allowances, SMS usage, integrations, availability and promotional offers may change from time
                to time.
              </p>
              <p className="mt-3">
                Unless expressly stated otherwise, website pricing information is provided for general guidance and does
                not create a binding offer until accepted through our sign-up, onboarding or order process.
              </p>
              <p className="mt-3">
                Where subscription cancellation is described as available, cancellation is subject to the cancellation
                terms shown at sign-up or in your customer terms. Unless we agree otherwise in writing, you may cancel
                by giving 30 days{'\u2019'} notice, and your subscription will remain active until the end of the notice
                period.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">5. Guest bookings made through ResNeo</h2>
              <p>
                ResNeo provides booking technology to venues and businesses. Where a guest, client or customer makes a
                booking with a venue using a ResNeo booking page, widget, link or related booking tool, the booking
                or service contract is between the guest and the relevant venue, not ResNeo.
              </p>
              <p className="mt-3">
                The venue is responsible for its own services, staff, premises, prices, availability, booking rules,
                cancellation terms, refund rules, no-show policies, service quality, health and safety obligations,
                consumer-law compliance and customer complaints.
              </p>
              <p className="mt-3">
                ResNeo is not responsible for the performance of services provided by venues, the accuracy of venue
                information, venue availability, venue cancellation decisions, venue refund decisions, or any failure by
                a venue to provide a booked service.
              </p>
              <p className="mt-3">
                Guests should check the venue&apos;s own terms, cancellation policy, refund policy and contact details
                before making a booking.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">6. Deposits and payments</h2>
              <p>
                Where deposits, booking payments or related payments are made through a ResNeo booking page or
                platform feature, those payments are processed and managed through the relevant venue and/or a
                third-party payment provider such as Stripe.
              </p>
              <p className="mt-3">
                ResNeo does not hold booking money. We do not operate as a bank, escrow
                provider, payment institution or client-money account for booking payments.
              </p>
              <p className="mt-3">
                Refunds, cancellations, no-shows, chargebacks, payment disputes and deposit treatment are subject to the
                relevant venue&apos;s policies and the rules, processes and timings of the applicable payment
                provider.
              </p>
              <p className="mt-3">
                ResNeo does not hold booking money and is not responsible for refunding booking payments, deposit
                payments or venue service payments. Guests should contact the venue directly for booking-payment
                disputes, service complaints or refund requests.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">7. Acceptable use of the website</h2>
              <p>You must not misuse the website. In particular, you must not:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>use the website unlawfully or fraudulently;</li>
                <li>interfere with, damage or disrupt the website or its security;</li>
                <li>attempt to gain unauthorised access to the website, platform, servers, accounts, systems or data;</li>
                <li>introduce viruses, malware, scripts or harmful code;</li>
                <li>scrape, harvest, copy or extract website content or data except as permitted by law;</li>
                <li>use automated bots, crawlers or similar tools in a way that may impair the website;</li>
                <li>submit false, misleading, abusive, defamatory, discriminatory, infringing or unlawful material;</li>
                <li>use the website to send spam or unsolicited marketing;</li>
                <li>attempt to reverse engineer or copy any software, platform feature, design or functionality.</li>
              </ul>
              <p className="mt-3">
                We may restrict, suspend or block access to the website where we reasonably believe there has been
                misuse, security risk, unlawful activity or breach of these terms.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">8. Intellectual property</h2>
              <p>
                The website, platform, software, branding, trade names, logos, designs, text, graphics, layout,
                databases and other materials are owned by or licensed to JAR 26 LTD trading as ResNeo, unless
                otherwise stated.
              </p>
              <p className="mt-3">
                You may view and use the public website for your own internal business evaluation and ordinary browsing
                purposes. You must not copy, reproduce, distribute, modify, sell, exploit, reverse engineer or create
                derivative works from our website, software, branding or materials without our prior written
                permission, except where permitted by law.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">9. Third-party links and services</h2>
              <p>
                The website may refer or link to third-party websites, payment providers, integrations, platforms or
                services. These third-party services are not controlled by ResNeo.
              </p>
              <p className="mt-3">
                We are not responsible for the content, availability, accuracy, security, privacy practices, terms,
                performance or failures of third-party websites or services.
              </p>
              <p className="mt-3">
                If you use a third-party service, your use may be subject to that third party&apos;s own terms and
                policies.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">10. Website availability</h2>
              <p>
                We may update, change, suspend or withdraw all or part of the website at any time. We do not guarantee
                that the website will always be available, uninterrupted, secure or error-free.
              </p>
              <p className="mt-3">
                We may carry out maintenance, updates or security work without notice where reasonably necessary.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">11. No professional advice</h2>
              <p>
                The information on the website is provided for general information only. It is not legal, financial, tax,
                regulatory, technical or professional advice. You should take appropriate advice before relying on
                website information for a specific business, legal or compliance decision.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">12. Liability</h2>
              <p>
                Nothing in these terms excludes or limits liability where it would be unlawful to do so, including
                liability for death or personal injury caused by negligence, fraud, fraudulent misrepresentation, or
                any liability that cannot be excluded under applicable law.
              </p>
              <p className="mt-3">To the fullest extent permitted by law, we are not liable for loss or damage arising from:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>reliance on general website information;</li>
                <li>inability to access or use the website;</li>
                <li>third-party websites, platforms, payment providers or services;</li>
                <li>
                  venue services, venue information, guest bookings, deposits, refunds or customer complaints
                  relating to a venue;
                </li>
                <li>viruses, malware or harmful material introduced by third parties;</li>
                <li>loss of profits, revenue, business, goodwill, opportunity, data or anticipated savings;</li>
                <li>indirect or consequential loss.</li>
              </ul>
              <p className="mt-3">If you are a consumer, nothing in these terms affects your statutory rights.</p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">13. Changes to these terms</h2>
              <p>
                We may update these Website Terms of Use from time to time. The latest version will be published on
                this page with the updated date shown above.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">14. Governing law</h2>
              <p>These Website Terms of Use are governed by the laws of Northern Ireland.</p>
              <p className="mt-3">
                If you are a business, the courts of Northern Ireland will have exclusive jurisdiction over disputes
                relating to these terms or the website.
              </p>
              <p className="mt-3">
                If you are a consumer, you may have additional rights to bring proceedings in the courts of the part of
                the United Kingdom where you live.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">15. Contact</h2>
              <p>
                Questions about these Website Terms of Use should be sent by email:{' '}
                <a href="mailto:hello@resneo.com" className="text-brand-600 hover:underline">
                  hello@resneo.com
                </a>
              </p>
            </section>
          </div>
        </div>

        <div className="mt-6 text-center text-xs text-slate-400">
          <Link href="/terms/customer" className="hover:text-brand-600">
            Customer Terms
          </Link>
          {' · '}
          <Link href="/terms/data-processing" className="hover:text-brand-600">
            Data Processing Agreement
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
