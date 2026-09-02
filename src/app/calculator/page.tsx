import type { Metadata } from 'next';
import Link from 'next/link';
import { MarketingNav } from '@/components/marketing/MarketingNav';
import { MarketingFooter } from '@/components/marketing/MarketingFooter';
import { PricingCalculator } from './PricingCalculator';
import {
  APPOINTMENTS_LIGHT_PRICE,
  APPOINTMENTS_PLUS_PRICE,
  APPOINTMENTS_PRO_PRICE,
  SMS_OVERAGE_GBP_PER_MESSAGE,
} from '@/lib/pricing-constants';
import {
  PRICING_ASSUMPTIONS,
  PRICING_CHECKED_ON,
  PRICING_SOURCES,
} from '@/lib/pricing/competitor-pricing';

export const metadata: Metadata = {
  title: 'Booking Software Price Calculator | ResNeo vs Booksy, Fresha, Phorest & Vagaro',
  description:
    'Work out what your salon or clinic really pays each month on ResNeo, Booksy, Fresha, Vagaro and more, with commission and add-ons included. Every figure is sourced.',
  alternates: { canonical: '/calculator' },
  openGraph: {
    title: 'What does booking software really cost?',
    description:
      'An interactive calculator comparing ResNeo’s flat monthly fee against the subscriptions, marketplace commissions and add-on charges of Booksy, Fresha, Phorest, Vagaro and Treatwell.',
    type: 'website',
  },
};

/** How each platform's bill is actually built. Prose, not maths: the maths is in the calculator. */
const CHARGING_MODELS: {
  name: string;
  subscription: string;
  commission: string;
  extras: string;
}[] = [
  {
    name: 'ResNeo',
    subscription: `Flat £${APPOINTMENTS_LIGHT_PRICE}, £${APPOINTMENTS_PLUS_PRICE} or £${APPOINTMENTS_PRO_PRICE} a month, whatever your booking volume`,
    commission: 'None, ever',
    extras: `Every feature is on every plan. Texts beyond your monthly allowance are ${Math.round(SMS_OVERAGE_GBP_PER_MESSAGE * 100)}p each`,
  },
  {
    name: 'Booksy',
    subscription: '£40 a month, plus £5 for each team member after the first',
    commission: '30% of a new client’s first visit through Boost, minimum £5',
    extras: 'All features included, and reminder texts are free. Marketing blasts are 5p after the first 500',
  },
  {
    name: 'Fresha',
    subscription: '£14.95 for a single person, or £9.95 per team member',
    commission: '20% of a new marketplace client’s first booking, minimum £4',
    extras: 'Insights, Client Loyalty and the AI concierge are each priced separately. 20 free texts, then 6p',
  },
  {
    name: 'Vagaro',
    subscription: '£20 for one calendar, rising £10 per extra calendar to an £80 cap at seven',
    commission: '20% of a new Marketplace client’s first appointment, charged once',
    extras:
      '1,000 email marketing messages included, but UK text messaging is a paid plan. The branded app, website builder and forms are extra',
  },
  {
    name: 'Phorest',
    subscription: 'Quote only, not published',
    commission: 'None advertised',
    extras:
      'Texts are 9.5p, 8.2p or 7p depending on tier, with 500 free a month on the top tiers. An online booking fee exists, but Phorest describes it as one the client pays to secure the slot',
  },
  {
    name: 'Treatwell',
    subscription: 'Both published plans start free, with commission instead of a monthly fee',
    commission: '35% of a new marketplace client’s first booking, 0% on repeats',
    extras: 'A further 2.5% processing fee applies when a client prepays online',
  },
];

export default function CalculatorPage() {
  return (
    <div className="home-warm min-h-screen bg-[#FDFBF7] text-slate-900">
      <MarketingNav currentHref="/calculator" ctaHref="/#pricing" />

      {/* ---------------------------------------------------------- hero */}
      <section className="border-b border-[#EEE9E0] bg-gradient-to-b from-brand-50/70 to-white py-14 sm:py-20">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-accent-700">
            Price calculator
          </p>
          <h1 className="mt-3 text-4xl font-black tracking-tight text-brand-600 sm:text-5xl">
            What does your booking software actually cost?
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-slate-600">
            The sticker price is rarely the bill. Most platforms add a fee for every team member, a
            commission on new clients from their marketplace, and a separate charge for marketing
            tools. Put your own numbers in and see the difference a flat monthly fee makes.
          </p>
        </div>
      </section>

      {/* ---------------------------------------------------- calculator */}
      <section className="py-12 sm:py-16">
        <PricingCalculator />
      </section>

      {/* ------------------------------------------------ charging models */}
      <section className="border-y border-[#EEE9E0] bg-[#FDFBF7] py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-3xl font-black tracking-tight text-brand-600">
            How each platform builds your bill
          </h2>
          <p className="mt-3 max-w-3xl text-base leading-relaxed text-slate-600">
            Three charges make up almost every booking software invoice: what you pay to have the
            software, what you pay when the platform introduces a client, and what you pay to switch
            on the features you assumed were included.
          </p>

          <div className="mt-8 overflow-x-auto rounded-2xl border border-[#EEE9E0] bg-white shadow-sm">
            <table className="w-full min-w-[52rem] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[#EEE9E0] bg-[#FDFBF7]">
                  <th scope="col" className="px-5 py-4 font-bold text-slate-900">
                    Platform
                  </th>
                  <th scope="col" className="px-5 py-4 font-bold text-slate-900">
                    Subscription
                  </th>
                  <th scope="col" className="px-5 py-4 font-bold text-slate-900">
                    Marketplace commission
                  </th>
                  <th scope="col" className="px-5 py-4 font-bold text-slate-900">
                    Extras that are charged separately
                  </th>
                </tr>
              </thead>
              <tbody>
                {CHARGING_MODELS.map((row) => {
                  const isResneo = row.name === 'ResNeo';
                  return (
                    <tr
                      key={row.name}
                      className={`border-b border-[#EEE9E0] last:border-0 ${isResneo ? 'bg-brand-50/60' : ''}`}
                    >
                      <th
                        scope="row"
                        className={`px-5 py-4 align-top font-bold ${isResneo ? 'text-brand-700' : 'text-slate-900'}`}
                      >
                        {row.name}
                      </th>
                      <td className="px-5 py-4 align-top leading-relaxed text-slate-700">
                        {row.subscription}
                      </td>
                      <td
                        className={`px-5 py-4 align-top leading-relaxed ${
                          row.commission === 'None, ever' ?
                            'font-semibold text-accent-700'
                          : 'text-slate-700'
                        }`}
                      >
                        {row.commission}
                      </td>
                      <td className="px-5 py-4 align-top leading-relaxed text-slate-700">
                        {row.extras}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-4 text-sm text-slate-500">
            Card processing fees are not in this table. Every platform has them, ResNeo included, and
            they are paid to a payment processor rather than to the booking software. Check them
            separately: they vary by platform, card type and country.
          </p>
        </div>
      </section>

      {/* ------------------------------------------------ where it bites */}
      <section className="py-16 sm:py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-3xl font-black tracking-tight text-brand-600">
            Why commission adds up faster than you expect
          </h2>
          <div className="mt-8 grid gap-6 md:grid-cols-3">
            <Point
              title="You pay it whoever did the introducing"
              body="The fee lands on anyone booking with you for the first time through the directory. Someone who saw your window, took a friend's recommendation, or found your Instagram, then happened to tap the app, counts the same as a stranger the platform genuinely found for you."
            />
            <Point
              title="It rises with your prices and your growth"
              body="A flat fee is the same in a quiet January and a flat-out December. A percentage takes more from every new client the busier you get, and putting your prices up puts the fee up with them."
            />
            <Point
              title="The minimum fee hits cheap services hardest"
              body="A £4 or £5 floor on a £15 fringe trim or a £20 kids' cut is a quarter of the ticket. On low-value work the minimum, not the percentage, is what you actually pay."
            />
          </div>

          <div className="mt-10 rounded-[24px] border border-brand-100 bg-brand-50/50 p-6 sm:p-8">
            <h3 className="text-xl font-bold text-brand-800">The ResNeo position, plainly</h3>
            <p className="mt-3 max-w-4xl text-base leading-relaxed text-slate-700">
              We charge one flat fee a month and take nothing from your bookings. We also do not run
              a marketplace, so we will not introduce you to strangers. If your clients already know
              your name and you mostly need the diary, the reminders, the deposits and the client
              records to work properly, you should not be paying a percentage of every new face who
              walks through the door. If what you actually want is a directory to find you new
              clients, one of the platforms above may be worth its commission, and we would rather
              you knew that before you signed up with us.
            </p>
            <Link
              href="/#pricing"
              className="mt-6 inline-flex min-h-12 items-center justify-center rounded-full bg-brand-600 px-6 text-sm font-extrabold text-white shadow-lg shadow-brand-600/20 transition-colors hover:bg-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
            >
              See ResNeo pricing
            </Link>
          </div>
        </div>
      </section>

      {/* -------------------------------------------- sources + disclaimer */}
      <section id="sources" className="scroll-mt-20 border-t border-[#EEE9E0] bg-[#FDFBF7] py-16 sm:py-20">
        <div className="mx-auto max-w-4xl px-6">
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">
            Where these figures come from
          </h2>

          <div className="mt-6 rounded-[24px] border border-amber-200 bg-amber-50/80 p-6">
            <h3 className="text-sm font-bold uppercase tracking-wide text-amber-900">
              Important: please read
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-amber-900/90">
              All competitor prices shown on this page were correct at the time of publishing (
              {PRICING_CHECKED_ON}) according to publicly available information published by each
              provider. Prices, commission rates and add-on charges change without notice, vary by
              country, and are often negotiated individually, so the figures here may no longer be
              current. Phorest and Treatwell do not publish their software prices at all: those
              totals rest on a figure you enter yourself and are clearly labelled as your estimate.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-amber-900/90">
              This calculator is a guide to help you compare charging models, not a quotation, and it
              cannot account for promotional rates, contract terms, migration costs or the features
              each platform includes. Always check the current prices with each provider before you
              make a decision. All figures are shown ex-VAT and exclude card processing fees. ResNeo
              is not affiliated with, endorsed by, or connected to any of the companies named here,
              and all trade marks belong to their respective owners.
            </p>
          </div>

          <h3 className="mt-8 text-base font-bold text-slate-900">
            The assumptions behind the maths
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Every comparison rests on judgement calls. Here are ours, in full. Where a call could
            reasonably go either way, we have made it in the other platform’s favour.
          </p>
          <ul className="mt-4 space-y-2.5">
            {PRICING_ASSUMPTIONS.map((assumption) => (
              <li
                key={assumption}
                className="flex gap-3 rounded-xl border border-[#EEE9E0] bg-white px-4 py-3 text-sm leading-relaxed text-slate-700"
              >
                <span aria-hidden="true" className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent-500" />
                <span>{assumption}</span>
              </li>
            ))}
          </ul>

          <h3 className="mt-8 text-base font-bold text-slate-900">Sources</h3>
          <ul className="mt-3 space-y-3">
            {PRICING_SOURCES.map((source) => (
              <li
                key={`${source.provider}-${source.url}`}
                className="rounded-xl border border-[#EEE9E0] bg-white px-4 py-3 text-sm"
              >
                <span className="font-semibold text-slate-900">{source.provider}</span>
                <span className="mt-0.5 block text-slate-600">{source.what}</span>
                <a
                  href={source.url}
                  target={source.url.startsWith('http') ? '_blank' : undefined}
                  rel={source.url.startsWith('http') ? 'noopener noreferrer nofollow' : undefined}
                  className="mt-1 inline-block break-all font-medium text-brand-600 hover:underline"
                >
                  {source.url}
                </a>
              </li>
            ))}
          </ul>

          <p className="mt-6 text-sm leading-relaxed text-slate-600">
            Spotted something out of date? Tell us at{' '}
            <a
              href="mailto:hello@resneo.com"
              className="font-semibold text-brand-600 hover:underline"
            >
              hello@resneo.com
            </a>{' '}
            and we will check it and correct the page. We would rather be accurate than flattering.
          </p>
        </div>
      </section>

      <MarketingFooter />
    </div>
  );
}

function Point({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-[24px] border border-[#EEE9E0] bg-white p-6 shadow-sm">
      <h3 className="text-base font-bold text-slate-900">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">{body}</p>
    </div>
  );
}
