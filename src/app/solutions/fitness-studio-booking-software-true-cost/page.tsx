import type { Metadata } from "next";
import Link from "next/link";
import { MarketingNav } from "@/components/marketing/MarketingNav";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";
import { ArrowRightIcon, PlusIcon, ShieldPoundIcon } from "@/components/marketing/marketing-icons";
import { PUBLIC_SITE_ORIGIN as SITE_ORIGIN } from "@/lib/public-base-url";
import {
  APPOINTMENTS_LIGHT_PRICE,
  APPOINTMENTS_PLUS_PRICE,
  APPOINTMENTS_PRO_PRICE,
} from "@/lib/pricing-constants";
import { SIGNUP_TRIAL_SHORT_LABEL } from "@/lib/signup-trial-copy";
import { STANDARD_PAYMENT_PROVIDER_FEES_NOTICE } from "@/lib/payment-provider-fees-notice";

const PAGE_PATH = "/solutions/fitness-studio-booking-software-true-cost";
const SIGNUP = "/#pricing";

/** Keep these in step whenever the figures are re-checked. */
const PUBLISHED_ISO = "2026-08-05";
const LAST_UPDATED_ISO = "2026-08-05";
const LAST_UPDATED_LABEL = "5 August 2026";

/**
 * This article deliberately names no competitor.
 *
 * It describes a charging *structure* found across class-based fitness and
 * wellness platforms rather than singling anyone out, so every figure is given
 * as a reported range for the category. That is also why there is no per-source
 * citation list: the numbers come from third-party SaaS pricing trackers rather
 * than from the platforms themselves, which mostly publish an entry price and
 * handle everything above it through sales. The Sources section says exactly
 * that, and the ranges must stay hedged to match what can actually be stood up.
 *
 * If a future edit wants to name a platform or quote a precise rate, it needs a
 * primary source for that platform, not a competitor's blog.
 */

export const metadata: Metadata = {
  title: "What Is a Subscription Plus Commission Booking Platform Costing You? | ResNeo",
  description:
    "Some class and wellness platforms charge a subscription per location, then take a cut of bookings from their own app. How the two layers work, and what to check on your bill.",
  keywords: [
    "fitness studio booking software cost",
    "class booking software commission",
    "studio management software pricing",
    "gym booking software fees",
    "marketplace commission booking platform",
    "flat fee class booking software",
    "yoga studio software cost",
    "per location booking software pricing",
  ],
  alternates: { canonical: PAGE_PATH },
  openGraph: {
    title: "What is a subscription plus commission booking platform actually costing you?",
    description:
      "A monthly subscription per location, then a cut of the bookings their app brings you. How the two-layer model works, and what studios should check on their own bill.",
    url: PAGE_PATH,
    type: "article",
    publishedTime: PUBLISHED_ISO,
    modifiedTime: LAST_UPDATED_ISO,
  },
  twitter: {
    card: "summary_large_image",
    title: "What is a subscription plus commission booking platform actually costing you?",
    description:
      "Subscription per location, plus a marketplace commission. How to work out what you are really paying.",
  },
};

/* ────────────────────────────────────────────────────────────────────────
   Content
   ──────────────────────────────────────────────────────────────────────── */

const QUICK_ANSWER =
  "Some class-based fitness and wellness booking platforms charge a monthly subscription, often starting around $99 to $159 for an entry tier and rising to $499 to $699 or more for larger plans, priced per location. They then add a commission of roughly 20%, plus payment processing, on bookings made through their own consumer marketplace app. That means a studio can end up paying a high subscription and a cut of its own bookings, at the same time.";

/** The layers a studio bill is built from. */
const LAYERS: { label: string; body: string; tone: "flat" | "variable" }[] = [
  {
    label: "The subscription",
    tone: "flat",
    body: "The number on the pricing page, and the one you agreed to. On platforms structured this way it is charged per location, and it does not move with how busy you are.",
  },
  {
    label: "The marketplace commission",
    tone: "variable",
    body: "A cut of bookings that arrive through the platform's own consumer app rather than your own website. This is the layer that is hardest to see in advance, and the one that grows as the marketplace does more for you.",
  },
  {
    label: "Payment processing",
    tone: "variable",
    body: "Charged on top of both, and paid to a payment processor rather than to the software company. Every platform has it, ResNeo included, but it is worth knowing your rate when you are adding the layers up.",
  },
];

/** The reported shape of the subscription layer, kept as ranges on purpose. */
const TIER_BANDS: { label: string; range: string; note: string }[] = [
  {
    label: "Entry tier",
    range: "$99 to $159",
    note: "Per location, per month. Usually the price you see advertised.",
  },
  {
    label: "Larger plans",
    range: "$499 to $699+",
    note: "Per location, per month. Often quoted by a salesperson rather than published.",
  },
];

/** Straight from the draft: the three questions worth taking to your invoice. */
const CHECKS: { question: string; detail: string }[] = [
  {
    question:
      "What proportion of your bookings last month came through a marketplace app rather than your own site?",
    detail:
      "This is the number that drives the second layer. If it is not obvious from your reporting, ask your account manager for a breakdown of marketplace-attributed bookings.",
  },
  {
    question:
      "Is your subscription tier priced for one location, and do you have or plan to have more than one?",
    detail:
      "Per-location pricing is the difference between a second site costing a little more and a second site doubling your software bill.",
  },
  {
    question:
      "Has your effective monthly cost gone up as your business has grown, even without changing plans?",
    detail:
      "Add subscription, commission and processing for the last three months, then divide by three. On a flat fee that number does not move. On this model it does.",
  },
];

const FAQS: { q: string; a: string }[] = [
  {
    q: "What is a subscription plus commission booking platform?",
    a: "It is any booking platform that charges you a monthly fee to use the software and then also takes a percentage of bookings that come through its own consumer marketplace app. You are paying for the tool and paying again for the bookings it routes to you.",
  },
  {
    q: "Is the commission charged on every booking?",
    a: "It depends on the platform, which is part of the problem. On some it applies only to a new client's first booking through the marketplace. On others a percentage applies to marketplace transactions more generally. Bookings taken through your own website usually sit outside it either way, so the share of your bookings arriving through the app is the number that matters.",
  },
  {
    q: "Can I avoid the marketplace commission?",
    a: "Usually yes, by driving clients to your own booking page instead. The trade-off is that you would then be paying a subscription that includes a discovery channel you have chosen not to use, and that channel is part of what the subscription is buying.",
  },
  {
    q: "Why is it hard to find these commission rates online?",
    a: "Because most platforms structured this way do not publish them. Entry prices tend to be on the website while higher tiers and the commission are handled through a sales conversation. That is why the figures in this article are given as reported ranges, and why the only number you should fully trust is the one on your own invoice.",
  },
  {
    q: "Does ResNeo work this way?",
    a: "No. ResNeo charges one flat monthly fee and takes 0% commission on every booking, wherever it came from. We also do not run a consumer marketplace, so there is no discovery channel bundled into the price. If a marketplace is the main thing you want, a platform that has one may suit you better.",
  },
];

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      headline: "What is a subscription plus commission booking platform actually costing you?",
      description:
        "How some class and wellness booking platforms layer a per-location subscription and a marketplace commission, and what a studio should check on its own bill.",
      datePublished: PUBLISHED_ISO,
      dateModified: LAST_UPDATED_ISO,
      inLanguage: "en-GB",
      author: { "@type": "Organization", name: "ResNeo" },
      publisher: { "@type": "Organization", name: "ResNeo" },
      mainEntityOfPage: { "@type": "WebPage", "@id": `${SITE_ORIGIN}${PAGE_PATH}` },
      about: [
        { "@type": "Thing", name: "Fitness studio management software pricing" },
        { "@type": "Thing", name: "Booking marketplace commission" },
      ],
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_ORIGIN}/` },
        { "@type": "ListItem", position: 2, name: "Solutions", item: `${SITE_ORIGIN}/solutions` },
        {
          "@type": "ListItem",
          position: 3,
          name: "Subscription plus commission booking platforms",
          item: `${SITE_ORIGIN}${PAGE_PATH}`,
        },
      ],
    },
    {
      "@type": "FAQPage",
      mainEntity: FAQS.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ],
};

/* ────────────────────────────────────────────────────────────────────────
   Page
   ──────────────────────────────────────────────────────────────────────── */

export default function StudioSoftwareTrueCostPage() {
  return (
    <div className="home-warm min-h-screen bg-[#FDFBF7] text-slate-900">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <MarketingNav sectionHref="/solutions" />
      <Hero />
      <QuickAnswer />
      <ArticleBody />
      <FlatFeeSection />
      <FaqSection />
      <SourcesSection />
      <ClosingCta />
      <MarketingFooter />
    </div>
  );
}

/* ── Hero ─────────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-brand-50 via-white to-accent-50/40" />
      <div className="relative mx-auto max-w-3xl px-6 py-16 sm:py-20">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-500">
          <ol className="flex flex-wrap items-center gap-x-2">
            <li>
              <Link
                href="/"
                className="inline-flex min-h-11 items-center rounded transition-colors hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                Home
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li>
              <Link
                href="/solutions"
                className="inline-flex min-h-11 items-center rounded transition-colors hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                Solutions
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li className="text-slate-700">Studio software costs</li>
          </ol>
        </nav>

        <span className="mt-6 inline-flex items-center gap-2 rounded-full border border-accent-100 bg-white px-3 py-1 text-xs font-extrabold uppercase tracking-wider text-accent-700">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          Guide for studios, gyms and clinics
        </span>

        <h1 className="mt-5 text-4xl font-black leading-[1.1] tracking-tight text-brand-600 sm:text-5xl">
          What is a subscription plus commission booking platform actually costing you?
        </h1>

        <p className="mt-6 text-lg leading-relaxed text-slate-600">
          You chose a plan and you know the monthly price. The part that is harder to see is the
          second layer, charged on the bookings the platform&rsquo;s own app brings you.
        </p>

        <p className="mt-6 text-sm text-slate-500">
          Last updated{" "}
          <time dateTime={LAST_UPDATED_ISO} className="font-semibold text-slate-700">
            {LAST_UPDATED_LABEL}
          </time>{" "}
          · 5 minute read
        </p>
      </div>
    </section>
  );
}

/* ── Quick answer ─────────────────────────────────────────────────────── */

function QuickAnswer() {
  return (
    <section className="bg-white pb-4">
      <div className="mx-auto max-w-3xl px-6">
        <div className="rounded-[24px] border border-brand-100 bg-brand-50/60 p-6 sm:p-8">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-accent-700">
            Short answer
          </h2>
          <p className="mt-3 text-base leading-relaxed text-slate-700">{QUICK_ANSWER}</p>
        </div>
      </div>
    </section>
  );
}

/* ── Body ─────────────────────────────────────────────────────────────── */

function ArticleBody() {
  return (
    <article className="bg-white py-12 sm:py-16">
      <div className="mx-auto max-w-3xl px-6">
        {/* Two-layer cost */}
        <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          The two-layer cost most studios do not see coming
        </h2>
        <p className="mt-5 text-base leading-relaxed text-slate-600">
          Most gyms and studios sign up for platforms like this because of the subscription price on
          the page. What is less visible upfront is the second layer: if a client books through the
          platform&rsquo;s own app rather than your website, that booking can carry a commission on
          top of what you are already paying monthly.
        </p>
        <p className="mt-4 text-base leading-relaxed text-slate-600">
          That is a materially different structure to a flat-fee platform. It is not a case of
          picking the cheaper plan and being done. The cost scales with how many of your bookings
          come through the marketplace, which is often exactly the channel studios are encouraged to
          lean on for new-client discovery.
        </p>

        <div className="mt-8 space-y-4">
          {LAYERS.map((layer) => (
            <div
              key={layer.label}
              className={`rounded-[24px] border p-6 ${
                layer.tone === "flat" ?
                  "border-slate-200 bg-slate-50/70"
                : "border-amber-200/80 bg-amber-50/60"
              }`}
            >
              <div className="flex items-center gap-3">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wider ${
                    layer.tone === "flat" ?
                      "bg-slate-200/80 text-slate-700"
                    : "bg-amber-200/70 text-amber-900"
                  }`}
                >
                  {layer.tone === "flat" ? "Fixed" : "Varies"}
                </span>
                <h3 className="text-base font-bold text-slate-900">{layer.label}</h3>
              </div>
              <p className="mt-3 text-base leading-relaxed text-slate-600">{layer.body}</p>
            </div>
          ))}
        </div>

        {/* In practice */}
        <h2 className="mt-14 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          What this actually looks like in practice
        </h2>
        <p className="mt-5 text-base leading-relaxed text-slate-600">
          A studio on a mid-tier plan like this, doing a moderate volume of marketplace-sourced
          bookings a month, can end up paying noticeably more once subscription, commission and
          processing are combined. Often significantly above the advertised subscription price alone,
          once a full month&rsquo;s marketplace activity is added in.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {TIER_BANDS.map((band) => (
            <div
              key={band.label}
              className="rounded-[24px] border border-[#EEE9E0] bg-white p-6 shadow-sm"
            >
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
                {band.label}
              </p>
              <p className="mt-2 text-3xl font-black tracking-tight text-brand-600">
                {band.range}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{band.note}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-sm leading-relaxed text-slate-500">
          Reported ranges for platforms structured this way, before any commission is added. Figures
          are in US dollars, which is how these platforms typically publish.
        </p>

        <p className="mt-6 text-base leading-relaxed text-slate-600">
          Platforms structured this way are also often priced per location. A second site means a
          second full subscription, not a shared or discounted add-on.
        </p>

        {/* Avoiding it */}
        <h2 className="mt-14 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Is there a way to avoid the marketplace commission?
        </h2>
        <p className="mt-5 text-base leading-relaxed text-slate-600">
          Usually yes. Bookings made directly through your own website or app, rather than the
          platform&rsquo;s consumer marketplace, do not carry the same commission layer.
        </p>
        <p className="mt-4 text-base leading-relaxed text-slate-600">
          The trade-off is that avoiding the fee means not using the discovery channel the
          marketplace provides, which is part of what studios are paying the subscription for in the
          first place. If that channel is genuinely introducing you to people who would never
          otherwise have found you, the commission is a customer acquisition cost, and it may be a
          fair one. The question worth answering is what share of those bookings would have come to
          you anyway.
        </p>

        {/* Checks */}
        <h2 className="mt-14 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          What to check on your own booking platform bill
        </h2>
        <ol className="mt-8 space-y-4">
          {CHECKS.map((c, i) => (
            <li
              key={c.question}
              className="rounded-[24px] border border-[#EEE9E0] bg-white p-6 shadow-sm transition-colors hover:border-brand-200"
            >
              <div className="flex items-start gap-4">
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-brand-50 text-sm font-bold text-brand-700 ring-1 ring-brand-100">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-slate-900">{c.question}</h3>
                  <p className="mt-2 text-base leading-relaxed text-slate-600">{c.detail}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </article>
  );
}

/* ── Flat fee ─────────────────────────────────────────────────────────── */

function FlatFeeSection() {
  return (
    <section className="bg-slate-900 py-16 sm:py-20">
      <div className="mx-auto max-w-3xl px-6">
        <span className="text-xs font-semibold uppercase tracking-widest text-accent-400">
          The other way to do it
        </span>
        <h2 className="mt-3 text-2xl font-bold tracking-tight text-white sm:text-3xl">
          A flat-fee alternative
        </h2>
        <p className="mt-5 text-base leading-relaxed text-white/75">
          ResNeo charges one flat monthly fee, with 0% commission on every booking, regardless of
          where it came from, and with no separate marketplace layer to factor in. Group and
          multi-session bookings are included as standard, not an upsell.
        </p>

        <div className="mt-9 rounded-[24px] border border-white/10 bg-white p-6 text-slate-900 shadow-2xl shadow-slate-900/40 sm:p-8">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-brand-600 text-white shadow-md shadow-brand-600/25">
              <ShieldPoundIcon className="h-6 w-6" />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-accent-700">
                What you pay
              </p>
              <h3 className="text-lg font-bold text-slate-900">
                £{APPOINTMENTS_LIGHT_PRICE}, £{APPOINTMENTS_PLUS_PRICE} or £{APPOINTMENTS_PRO_PRICE} a
                month
              </h3>
            </div>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-slate-600">
            The same figure in a quiet January and a flat-out September, whether your clients come
            from Instagram, a friend&rsquo;s recommendation, or the poster in your window. Prices are
            on our website rather than behind a sales call.{" "}
            {STANDARD_PAYMENT_PROVIDER_FEES_NOTICE}
          </p>
        </div>

        <p className="mt-8 text-base leading-relaxed text-white/75">
          The trade-off in reverse is worth saying out loud: we do not run a consumer marketplace, so
          we will not introduce you to anybody. If discovery is the main thing you are buying, a
          platform that has one may genuinely suit you better.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/calculator"
            className="inline-flex h-12 items-center justify-center rounded-full bg-accent-500 px-7 text-base font-extrabold text-brand-900 shadow-lg transition-all hover:-translate-y-0.5 hover:bg-accent-400"
          >
            Compare the cost with your numbers
            <ArrowRightIcon />
          </Link>
          <a
            href={SIGNUP}
            className="inline-flex h-12 items-center justify-center rounded-full border border-white/25 bg-transparent px-6 text-base font-extrabold text-white backdrop-blur transition-colors hover:bg-white/10"
          >
            See ResNeo pricing
          </a>
        </div>
      </div>
    </section>
  );
}

/* ── FAQ ──────────────────────────────────────────────────────────────── */

function FaqSection() {
  return (
    <section id="faq" className="scroll-mt-16 bg-[#FDFBF7] py-16 sm:py-20">
      <div className="mx-auto max-w-3xl px-6">
        <span className="text-xs font-semibold uppercase tracking-widest text-accent-700">
          Common questions
        </span>
        <h2 className="mt-3 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Subscription plus commission, answered.
        </h2>

        <div className="mt-10 space-y-3">
          {FAQS.map((f) => (
            <details
              key={f.q}
              className="group rounded-[24px] border border-[#EEE9E0] bg-white p-6 open:shadow-md"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-semibold text-slate-900">
                {f.q}
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500 transition-transform group-open:rotate-45 group-open:bg-brand-100 group-open:text-brand-700">
                  <PlusIcon />
                </span>
              </summary>
              <p className="mt-4 text-sm leading-relaxed text-slate-600">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Sources ──────────────────────────────────────────────────────────── */

function SourcesSection() {
  return (
    <section id="sources" className="scroll-mt-16 bg-white pt-16 sm:pt-20">
      <div className="mx-auto max-w-3xl px-6">
        <div className="rounded-[24px] border border-amber-200 bg-amber-50/80 p-6 sm:p-8">
          <h2 className="text-sm font-bold uppercase tracking-wide text-amber-900">Sources</h2>
          <p className="mt-3 text-sm leading-relaxed text-amber-900/90">
            Publicly reported 2026 pricing tiers and marketplace commission structures for
            class-based fitness and wellness booking platforms, compiled from multiple independent
            SaaS pricing trackers. Exact commission percentages and full tier pricing are not always
            published directly by the platforms themselves. The figures here reflect third-party
            reporting and should be verified against your own current invoice for an exact
            comparison. Some of those third parties sell competing software.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-amber-900/90">
            Figures are quoted in US dollars, which is how platforms of this kind typically publish,
            and are shown as ranges rather than exact prices because that is how they are reported.
            Prices change without notice, vary by country and are often negotiated individually.
            Nothing here is a quotation. ResNeo is not affiliated with, endorsed by, or connected to
            any other booking platform, and all trade marks belong to their respective owners.
          </p>
          <p className="mt-3 text-sm font-semibold text-amber-900">
            Last checked{" "}
            <time dateTime={LAST_UPDATED_ISO}>{LAST_UPDATED_LABEL}</time>.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ── Closing CTA ──────────────────────────────────────────────────────── */

function ClosingCta() {
  return (
    <section className="bg-white py-16 sm:py-20">
      <div className="mx-auto max-w-3xl px-6 text-center">
        <h2 className="text-3xl font-black tracking-tight text-brand-600 sm:text-4xl">
          Curious what you would actually save?
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-slate-600">
          Put your own numbers into our price calculator, or tell us how your studio runs and we
          will walk you through it.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/calculator"
            className="inline-flex h-12 items-center justify-center rounded-full bg-brand-600 px-7 text-base font-extrabold text-white shadow-lg shadow-brand-600/25 transition-all hover:-translate-y-0.5 hover:bg-brand-700"
          >
            Try ResNeo&rsquo;s calculator
          </Link>
          <Link
            href="/#contact"
            className="inline-flex h-12 items-center justify-center rounded-full border border-[#EEE9E0] bg-white px-6 text-base font-extrabold text-brand-600 shadow-sm transition-colors hover:border-accent-200"
          >
            Get in touch
          </Link>
        </div>
        <p className="mt-6 text-sm text-slate-500">
          Every paid plan includes a {SIGNUP_TRIAL_SHORT_LABEL}.
        </p>
      </div>
    </section>
  );
}
