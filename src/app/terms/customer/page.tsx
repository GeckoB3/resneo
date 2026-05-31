import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Customer Terms - Resneo',
  description:
    'Customer subscription terms governing your use of the Resneo platform as a business customer, operated by JAR 26 LTD trading as Resneo.',
};

const LAST_UPDATED = '18 May 2026';

export default function CustomerTermsPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-5">
          <Link href="/">
            <Image src="/Logo.png" alt="Resneo" width={120} height={36} className="h-8 w-auto" />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <div className="rounded-2xl border border-slate-200 bg-white px-8 py-10 shadow-sm">
          <h1 className="mb-2 text-3xl font-bold text-slate-900">Customer Terms</h1>
          <p className="mb-2 text-sm text-slate-500">Last updated: {LAST_UPDATED}</p>
          <p className="mb-8 text-sm text-slate-500">
            These terms apply to business customers who subscribe to and use the Resneo platform.
          </p>

          <div className="space-y-8 text-sm leading-relaxed text-slate-700">

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">1. Who these terms apply to</h2>
              <p>
                These Customer Terms (&ldquo;Terms&rdquo;) apply to you (&ldquo;Customer&rdquo;, &ldquo;you&rdquo;,
                &ldquo;your&rdquo;) when you sign up for, subscribe to, or use the Resneo platform as a
                business customer. They form a binding contract between you and JAR 26 LTD trading as Resneo
                (&ldquo;Resneo&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;, &ldquo;our&rdquo;).
              </p>
              <p className="mt-3">
                By completing sign-up, ticking the acceptance checkbox, or accessing the Resneo platform, you
                confirm that you have read, understood, and agreed to these Terms, and that you have the authority to
                enter into this agreement on behalf of the business you are registering.
              </p>
              <p className="mt-3">
                These Terms apply alongside the{' '}
                <Link href="/terms" className="text-brand-600 hover:underline">
                  Website Terms of Use
                </Link>
                ,{' '}
                <Link href="/privacy" className="text-brand-600 hover:underline">
                  Privacy Policy
                </Link>
                , and the{' '}
                <Link href="/terms/data-processing" className="text-brand-600 hover:underline">
                  Data Processing Agreement
                </Link>
                . Where there is a conflict between these Customer Terms and the Website Terms of Use, these
                Customer Terms take priority for your use of the paid Resneo platform.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">2. Who we are</h2>
              <p>
                Resneo is operated by JAR 26 LTD, a company registered in Northern Ireland under company number
                NI740269, trading as Resneo.
              </p>
              <p className="mt-3">Our registered office is 100a Main Street, Bangor, Northern Ireland, BT20 4AG.</p>
              <p className="mt-3">Our trading address is 5 Church Road, Holywood, Northern Ireland, BT18 9BU.</p>
              <p className="mt-3">
                You can contact us by email:{' '}
                <a href="mailto:hello@resneo.com" className="text-brand-600 hover:underline">
                  hello@resneo.com
                </a>
                .
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">3. Your subscription</h2>
              <p>
                Your subscription gives you access to the Resneo platform features included in the plan you
                selected at sign-up (&ldquo;Plan&rdquo;). Your Plan, pricing, and included features are confirmed
                in the order summary shown before checkout and in the confirmation provided by us or our payment
                processor following successful payment.
              </p>
              <p className="mt-3">
                Your subscription is for a single venue only unless we have agreed otherwise in writing.
              </p>
              <p className="mt-3">
                We may add, modify, or remove features from the platform over time. We will endeavour to give
                reasonable notice of significant changes to features that form a material part of your Plan.
              </p>
              <p className="mt-3">
                We may offer promotional or founding-partner pricing for a defined period. After any promotional
                period ends, your subscription will automatically continue at the standard rate then applicable to
                your Plan unless you cancel beforehand.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">4. Payment and billing</h2>
              <p>
                Subscription fees are payable monthly in advance, charged to the payment method you provide at
                checkout. Billing is managed through Stripe. By subscribing, you authorise recurring monthly charges
                until your subscription is cancelled.
              </p>
              <p className="mt-3">
                All prices are shown in pounds sterling (GBP) and are exclusive of VAT (or other applicable taxes)
                unless expressly stated. Where VAT or other taxes apply, they will be added at the applicable rate.
              </p>
              <p className="mt-3">
                We may change subscription pricing. We will give you at least 30 days&rsquo; written notice of any
                price increase, and you may cancel before the new pricing takes effect if you do not wish to
                continue.
              </p>
              <p className="mt-3">
                Where your Plan includes SMS messages, any usage in excess of your included allowance will be
                charged at the metered rate applicable to your Plan. SMS overage charges are billed through your
                subscription via Stripe. You are responsible for managing your SMS usage within your included
                allowance or budgeting for overage.
              </p>
              <p className="mt-3">
                If a payment fails, we may suspend access to the platform until payment is brought up to date. We
                will make reasonable attempts to notify you of a payment failure before suspending access.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">5. Cancellation and termination</h2>
              <p>
                You may cancel your subscription at any time. Unless we agree otherwise in writing, cancellation
                requires 30 days&rsquo; written notice (email to{' '}
                <a href="mailto:hello@resneo.com" className="text-brand-600 hover:underline">
                  hello@resneo.com
                </a>{' '}
                is sufficient). Your access will remain active until the end of your notice period. We do not
                provide pro-rata refunds for unused days in a billing period unless required by law.
              </p>
              <p className="mt-3">
                We may terminate or suspend your subscription immediately if you materially breach these Terms and,
                where the breach is capable of remedy, you fail to remedy it within 14 days of written notice from
                us.
              </p>
              <p className="mt-3">
                We may terminate your subscription on 30 days&rsquo; notice for any other reason. In such cases,
                we will provide a pro-rata refund of any prepaid subscription fees for the unused portion of the
                notice period.
              </p>
              <p className="mt-3">
                On termination, your access to the platform will cease. We will retain your data for a period of 30
                days after termination to allow you to request an export. After this period, we may delete your
                account data in accordance with our data retention practices and the{' '}
                <Link href="/terms/data-processing" className="text-brand-600 hover:underline">
                  Data Processing Agreement
                </Link>
                .
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">6. Acceptable use</h2>
              <p>You must use the Resneo platform only for lawful purposes. You must not:</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>use the platform for any unlawful, fraudulent, or deceptive purpose;</li>
                <li>
                  upload, submit, or transmit content that is abusive, defamatory, discriminatory, obscene,
                  infringing, or otherwise unlawful;
                </li>
                <li>
                  attempt to gain unauthorised access to any part of the platform, other customer accounts, or our
                  systems or infrastructure;
                </li>
                <li>
                  reverse engineer, decompile, copy, or create derivative works based on any part of the platform or
                  its underlying software;
                </li>
                <li>use the platform to send unsolicited commercial communications to guests or third parties;</li>
                <li>
                  interfere with, overload, or disrupt the platform or its infrastructure, or use automated tools to
                  scrape or extract data at scale;
                </li>
                <li>
                  use the platform to process personal data in a manner that violates applicable data protection law.
                </li>
              </ul>
              <p className="mt-3">
                You are responsible for the actions of your staff and any other users you authorise to access the
                platform under your account. You must keep your account credentials secure and notify us promptly if
                you suspect unauthorised access to your account.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">7. Your data</h2>
              <p>
                You retain ownership of all data you upload to or generate through the Resneo platform,
                including guest records, booking data, and business information (&ldquo;Customer Data&rdquo;). We
                do not claim any ownership rights over Customer Data.
              </p>
              <p className="mt-3">
                You grant us a limited licence to store, process, and use Customer Data solely to provide and
                operate the platform, improve the platform, and fulfil our obligations under these Terms and the
                Data Processing Agreement.
              </p>
              <p className="mt-3">
                You are responsible for ensuring that you have the right to upload and use Customer Data within the
                platform, including that you have collected and are processing any personal data within Customer
                Data in compliance with applicable data protection law.
              </p>
              <p className="mt-3">
                Our obligations as a data processor when handling personal data within Customer Data are set out in
                the{' '}
                <Link href="/terms/data-processing" className="text-brand-600 hover:underline">
                  Data Processing Agreement
                </Link>
                , which forms part of these Terms.
              </p>
              <h3 className="mb-2 mt-6 text-base font-semibold text-slate-900">Linked Accounts</h3>
              <p>
                Resneo may offer an optional &ldquo;Linked Accounts&rdquo; feature for eligible appointment-based
                venues. This lets two or more independent venues that each hold their own Resneo subscription
                grant each other controlled visibility into calendars and (where agreed) limited booking actions.
                Linking does not merge your data: each venue remains the owner of its own guest records and bookings.
              </p>
              <p className="mt-3">
                If you use Linked Accounts, you act as an independent data controller for your own client data. A
                link is a controller-to-controller arrangement between you and the other venue. You must have a
                lawful basis to share the access you grant, keep your own privacy policy accurate, and only accept
                links you trust. You can reduce access you grant or end a link at any time; the other venue may do
                the same.
              </p>
              <p className="mt-3">
                Cross-venue actions taken under a link may be recorded in an audit log visible to both venues. If a
                linked venue ends its subscription or is removed from the platform, cross-venue access ends
                automatically. Resneo is not responsible for how a linked venue uses access you grant.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">8. Intellectual property</h2>
              <p>
                The Resneo platform, software, branding, trade names, logos, designs, documentation, and all
                associated intellectual property rights are owned by or licensed to JAR 26 LTD. These Terms do not
                grant you any rights in or to our intellectual property other than the limited right to access and
                use the platform in accordance with these Terms during the term of your subscription.
              </p>
              <p className="mt-3">
                We may use your business name, logo, and general description of your use case (e.g. restaurant
                booking) for marketing and promotional purposes, including on our website and in case studies. You
                may withdraw this permission at any time by notifying us in writing.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">9. Confidentiality</h2>
              <p>
                Each party may have access to confidential information belonging to the other. Each party agrees to
                keep the other&rsquo;s confidential information confidential and not to use it except to exercise
                rights or fulfil obligations under these Terms, or to disclose it except as required by law or
                regulatory authority.
              </p>
              <p className="mt-3">
                Customer Data is treated as your confidential information. We will not sell, share, or disclose
                Customer Data to third parties except as set out in the Data Processing Agreement or as required by
                law.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">10. Availability and support</h2>
              <p>
                We aim to keep the platform available but do not guarantee uninterrupted, error-free operation. We
                may carry out planned maintenance or emergency work at any time. Where practicable, we will provide
                advance notice of planned downtime.
              </p>
              <p className="mt-3">
                Support is provided by email at{' '}
                <a href="mailto:hello@resneo.com" className="text-brand-600 hover:underline">
                  hello@resneo.com
                </a>
                . Response times and priority support availability depend on your Plan.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">11. Limitation of liability</h2>
              <p>
                Nothing in these Terms excludes or limits liability where it would be unlawful to do so, including
                liability for death or personal injury caused by negligence, fraud, or fraudulent
                misrepresentation.
              </p>
              <p className="mt-3">
                Subject to the above, our total aggregate liability to you arising out of or in connection with
                these Terms (whether in contract, tort, including negligence, or otherwise) in any 12-month period
                is limited to the total subscription fees paid by you to us in that 12-month period.
              </p>
              <p className="mt-3">
                We are not liable for: loss of profits; loss of revenue; loss of business; loss of anticipated
                savings; loss of goodwill; loss of data or corruption of data; or any indirect, special, or
                consequential loss, even if we had been advised of the possibility of such loss.
              </p>
              <p className="mt-3">
                We are not liable for the services, data, or content of third-party providers integrated with the
                platform (including Stripe, Supabase, SendGrid, Twilio, or Vercel).
              </p>
              <p className="mt-3">
                We are not liable for actions taken by your guests, including no-shows, chargebacks, or payment
                disputes. Those matters are between you and your guests (and, where relevant, your payment
                processor).
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">12. Warranties and disclaimers</h2>
              <p>
                We warrant that we will provide the platform with reasonable skill and care and that it will perform
                materially in accordance with its documentation during the term of your subscription.
              </p>
              <p className="mt-3">
                Except as set out above, the platform is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;.
                We make no warranty that the platform will be uninterrupted, error-free, or free from security
                vulnerabilities, or that it will meet any particular business outcome or requirement.
              </p>
              <p className="mt-3">
                We are not responsible for the accuracy or completeness of any reports, analytics, or automated
                communications generated by the platform. You are responsible for reviewing and validating outputs
                before relying on them.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">13. Changes to these Terms</h2>
              <p>
                We may update these Customer Terms from time to time. We will give you at least 30 days&rsquo;
                written notice (by email to the address on your account) of any material changes. Continued use of
                the platform after the effective date of changes constitutes acceptance of the updated Terms. If you
                do not accept the changes, you may cancel your subscription before they take effect.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">14. Governing law and disputes</h2>
              <p>These Customer Terms are governed by the law of Northern Ireland.</p>
              <p className="mt-3">
                The courts of Northern Ireland will have exclusive jurisdiction over any dispute arising out of or
                in connection with these Terms or your use of the Resneo platform.
              </p>
              <p className="mt-3">
                Before commencing formal proceedings, the parties agree to attempt to resolve disputes informally
                by notifying the other party in writing and allowing 30 days for a good-faith resolution.
              </p>
            </section>

            <section>
              <h2 className="mb-3 text-lg font-semibold text-slate-900">15. General</h2>
              <p>
                <strong>Entire agreement.</strong> These Customer Terms, together with the Website Terms of Use,
                Privacy Policy, and Data Processing Agreement, form the entire agreement between you and Resneo
                in relation to your use of the platform, and supersede any prior representations, agreements, or
                discussions.
              </p>
              <p className="mt-3">
                <strong>Severability.</strong> If any provision of these Terms is found to be unlawful or
                unenforceable, it will be severed from the rest of the Terms, which will continue in full force and
                effect.
              </p>
              <p className="mt-3">
                <strong>No waiver.</strong> Failure to exercise or delay in exercising any right under these Terms
                does not constitute a waiver of that right.
              </p>
              <p className="mt-3">
                <strong>Assignment.</strong> You may not assign or transfer your rights or obligations under these
                Terms without our prior written consent. We may assign our rights and obligations to a successor
                business without your consent, provided that your rights under these Terms are not materially
                affected.
              </p>
              <p className="mt-3">
                <strong>Contact.</strong> Questions about these Terms should be directed to{' '}
                <a href="mailto:hello@resneo.com" className="text-brand-600 hover:underline">
                  hello@resneo.com
                </a>
                .
              </p>
            </section>

          </div>
        </div>

        <div className="mt-6 text-center text-xs text-slate-400">
          <Link href="/terms/data-processing" className="hover:text-brand-600">
            Data Processing Agreement
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
            Back to Resneo
          </Link>
        </div>
      </main>
    </div>
  );
}
