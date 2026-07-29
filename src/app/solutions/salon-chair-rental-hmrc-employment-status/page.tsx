import type { Metadata } from "next";
import Link from "next/link";
import { SocialLinks } from "@/components/marketing/SocialLinks";
import {
  ArrowRightIcon,
  LinkIcon,
  PlusIcon,
  ShieldCheckIcon,
  TickIcon,
} from "@/components/marketing/marketing-icons";
import { LINKED_ACCOUNTS_SEPARATE_BOOKS_NOTE } from "@/lib/linked-accounts-marketing-copy";

const PAGE_PATH = "/solutions/salon-chair-rental-hmrc-employment-status";
const SIGNUP = "/#pricing";

/**
 * Freshness signals. Search engines and AI answer engines both weight a visible,
 * machine-readable "last updated" date, so keep these two in step: bump
 * LAST_UPDATED_ISO and LAST_UPDATED_LABEL together whenever the article changes.
 */
const PUBLISHED_ISO = "2026-07-29";
const LAST_UPDATED_ISO = "2026-07-29";
const LAST_UPDATED_LABEL = "29 July 2026";

/**
 * Primary sources for the factual claims in this article. Each one is cited inline in the
 * body, listed again in the Sources section at the foot of the page, and mirrored into the
 * Article schema's `citation` field, so search and AI answer engines can see the piece is
 * grounded in HMRC and Supreme Court material rather than opinion.
 *
 * These are deliberately followed links (no rel="nofollow"): citing authoritative sources
 * openly is the point. Re-check the URLs if the article is ever substantially revised.
 *
 * `supports` says which claim the source backs, so a future edit can tell at a glance when a
 * source no longer matches the copy it is standing behind.
 */
const SOURCES = {
  employmentStatusManual: {
    href: "https://www.gov.uk/hmrc-internal-manuals/employment-status-manual/esm0500",
    name: "Employment Status Manual: guide to determining status (ESM0500)",
    publisher: "HMRC",
    supports:
      "The factors HMRC weighs when deciding status: control, personal service and the right of substitution, financial risk, exclusivity, and the overall picture.",
  },
  uberJudgment: {
    href: "https://www.supremecourt.uk/cases/uksc-2019-0029",
    name: "Uber BV and others v Aslam and others [2021] UKSC 5",
    publisher: "UK Supreme Court",
    supports:
      "The February 2021 ruling that Uber drivers were workers rather than self-employed contractors, decided on the reality of the working relationship rather than the contract wording.",
  },
  penaltiesFactsheet: {
    href: "https://www.gov.uk/government/publications/compliance-checks-penalties-for-inaccuracies-in-returns-or-documents-ccfs7a",
    name: "Compliance checks: penalties for inaccuracies in returns or documents (CC/FS7A)",
    publisher: "HMRC",
    supports:
      "The penalty bands quoted in this article, and the reductions available when you tell HMRC about an error before it asks.",
  },
  cest: {
    href: "https://www.gov.uk/guidance/check-employment-status-for-tax",
    name: "Check employment status for tax (CEST)",
    publisher: "HMRC",
    supports:
      "HMRC's free tool for getting its view of a worker's employment status, based on the answers you give it.",
  },
} as const;

export const metadata: Metadata = {
  title: "Salon Chair Rental & HMRC Employment Status | ResNeo",
  description:
    "Rent chairs to self-employed stylists? HMRC judges the arrangement by how it works day to day, not by your contract. What HMRC checks, what reclassification costs, and how your booking system can help or hurt.",
  keywords: [
    "salon chair rental HMRC",
    "chair rent employment status",
    "is a chair renter self-employed",
    "HMRC reclassify hairdresser as employee",
    "rent a chair salon rules UK",
    "self-employed stylist employment status",
    "chair rental agreement salon UK",
    "salon PAYE backdated",
  ],
  alternates: { canonical: PAGE_PATH },
  openGraph: {
    title: "Is your salon accidentally employing your chair renters?",
    description:
      "HMRC looks at how a chair rental arrangement actually works, not what the contract says. Here is what it checks, what getting it wrong costs, and why your booking system is part of the picture.",
    url: PAGE_PATH,
    type: "article",
    publishedTime: PUBLISHED_ISO,
    modifiedTime: LAST_UPDATED_ISO,
  },
  twitter: {
    card: "summary_large_image",
    title: "Is your salon accidentally employing your chair renters?",
    description:
      "What HMRC checks in a chair rental arrangement, what reclassification costs, and how your booking system fits in.",
  },
};

/* ────────────────────────────────────────────────────────────────────────
   Content data
   ──────────────────────────────────────────────────────────────────────── */

/**
 * The short, self-contained answer that sits at the top of the article.
 * Written to be quotable on its own by search snippets and AI answer engines,
 * so it must never depend on the paragraphs around it.
 */
const QUICK_ANSWER =
  "Yes, HMRC can treat a self-employed chair renter as an employee if the day to day reality of the arrangement looks like employment, whatever the written contract says. It weighs things like who sets the prices and hours, who collects the client's money, and whether the stylist can send someone else to cover their chair. If an arrangement is reclassified, the salon is normally the one liable for backdated PAYE and National Insurance, plus penalties and interest.";

/** The working-practice tests HMRC and tribunals actually apply, in plain language. */
const checks: { question: string; detail: string }[] = [
  {
    question: "Can the stylist send someone else to cover their chair?",
    detail:
      "If a stylist is off sick or on holiday and cannot send a substitute in their place, the arrangement depends on their personal service. That points towards employment rather than a genuine business relationship.",
  },
  {
    question: "Who sets the prices and the hours?",
    detail:
      "If the salon dictates opening hours, shift patterns, or what a cut and colour costs, that is control. Control is one of the strongest markers of employment there is.",
  },
  {
    question: "Who actually collects the money?",
    detail:
      "A salon that takes every client payment through its own till and then pays the stylist a cut looks very different, in HMRC's eyes, to a stylist who takes their own payments and pays a fixed rent for the chair.",
  },
  {
    question: "Is the stylist required to look and operate like staff?",
    detail:
      "Salon branded uniforms, salon-only product lines, and strict salon rules all narrow the gap between a renter and an employee. The more a stylist looks like staff, the more they may be treated as staff.",
  },
  {
    question: "Can the stylist work elsewhere, or take clients outside the salon?",
    detail:
      "Exclusivity cuts against genuine independence. A real business can normally take work from more than one place, and can build a client list that belongs to them.",
  },
];

/** What stacks up if an arrangement is reclassified. */
const costs: { title: string; detail: string }[] = [
  {
    title: "Backdated PAYE and National Insurance",
    detail:
      "Both employer's and employee's contributions, for as long as the arrangement has existed. That can reach back several years, across every chair affected.",
  },
  {
    title: "Penalties on top of the tax owed",
    detail:
      "Scaled to how the error is judged: up to 30% of the tax owed for careless mistakes, up to 70% where it is judged deliberate, and up to 100% where it is judged deliberate and concealed.",
  },
  {
    title: "Interest on everything owed",
    detail:
      "Charged from the date each payment should have been made, not from the date HMRC raises the question.",
  },
];

/** What Link & Break gives each chair, framed as separation rather than compliance. */
const linkBreakPoints = [
  "Each stylist gets their own diary, their own client list, their own prices, and their own availability",
  "Genuinely separate accounts, not separate logins on one shared salon system",
  "Payments go straight to each person's own account, never pooled into a salon till",
  "Publicly, the diaries link together so the salon still presents as one smart booking page",
  "If a stylist leaves, their diary and their clients leave with them, in one click from either side",
];

/**
 * FAQ written in the phrasing people actually use when they search or ask an
 * assistant, rather than in keyword strings. Mirrored into FAQPage schema below.
 */
const faqs: { q: string; a: string }[] = [
  {
    q: "Is a chair renter self-employed or an employee?",
    a: "It depends entirely on how the arrangement works in practice. A genuine chair renter runs their own business: they set their own prices and hours, take their own payments, keep their own clients, and pay the salon a fixed rent for the space. Where the salon controls the diary, the pricing, and the till, the stylist may be an employee in HMRC's eyes even if the contract calls them self-employed.",
  },
  {
    q: "Can HMRC reclassify a self-employed hairdresser as an employee?",
    a: "Yes. HMRC assesses employment status on the real working relationship rather than the label in the paperwork, so it can decide that an arrangement described as chair rental is in substance employment. Reclassification is backdated to when the arrangement began, not applied from the date of the decision.",
  },
  {
    q: "What happens if HMRC reclassifies my stylists as employees?",
    a: "The salon is normally treated as the employer and becomes liable for backdated PAYE and National Insurance, covering both employer's and employee's contributions for the whole period. Penalties are added on top, up to 30% of the tax owed for careless errors and up to 100% where the error is judged deliberate and concealed, along with interest running from when each payment was originally due.",
  },
  {
    q: "Does a written chair rental contract protect my salon?",
    a: "A clear contract matters, but on its own it is not enough. HMRC and employment tribunals both look past the wording to what actually happens day to day, so a contract that describes independence while the salon sets hours, prices, and takes all the payments offers limited protection. The contract and the working practices need to match.",
  },
  {
    q: "Why does the Uber Supreme Court ruling matter to salons?",
    a: "In February 2021 the UK Supreme Court ruled in Uber BV v Aslam that Uber drivers were workers rather than genuinely self-employed contractors, largely because of how much control Uber had over their day to day work. The case was about employment rights rather than tax, but it reinforced a principle that applies to both: the reality of the relationship outweighs how the contract describes it. Employment status across the gig economy, hairdressing included, has drawn closer scrutiny since.",
  },
  {
    q: "Can a chair renter take their own client payments?",
    a: "Yes, and in a genuine rental arrangement that is normally how it works. The stylist takes payment from their own client into their own account and pays the salon an agreed rent for the chair. A salon that collects everything centrally and then pays out a percentage is running something that looks much more like employment.",
  },
  {
    q: "Can shared booking software make my salon look like the employer?",
    a: "It can contribute to the picture. If every stylist shares one login, one diary, and one till, with the salon controlling who is booked in when and collecting all the payments, the system suggests the salon is running the stylists' businesses for them. That does not create the legal risk by itself, but it makes the risk harder to argue against if HMRC ever asks questions.",
  },
  {
    q: "How does ResNeo's Link & Break feature help?",
    a: "Each stylist runs their own ResNeo account with their own diary, clients, prices, availability, and payouts. Those accounts then link so that the salon still shows one combined booking page to clients, and either side can break the link in a single click. Linking shares access to a calendar, it never merges anyone's books or moves ownership of anyone's clients.",
  },
  {
    q: "What happens to a stylist's clients if they leave the salon?",
    a: "With genuinely separate accounts, nothing moves. Breaking the link ends shared access and each side keeps the clients, bookings, and takings it always owned, so a stylist who moves on takes their own diary and client list with them.",
  },
  {
    q: "How can I check whether my own arrangement would hold up?",
    a: "HMRC publishes a free tool called Check Employment Status for Tax (CEST) that walks through the main tests, and it is a reasonable starting point. Because it only reflects the answers you give it, the more useful step for most salons is a conversation with a qualified UK employment or tax adviser who can look at your actual contracts and working practices together.",
  },
];

/* ────────────────────────────────────────────────────────────────────────
   Structured data (JSON-LD) for SEO and AI answer engines
   ──────────────────────────────────────────────────────────────────────── */

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Article",
      headline: "Is your salon accidentally employing your chair renters?",
      description:
        "How HMRC assesses chair rental arrangements in UK salons, what reclassification actually costs, and why your booking system is part of the evidence.",
      datePublished: PUBLISHED_ISO,
      dateModified: LAST_UPDATED_ISO,
      inLanguage: "en-GB",
      author: { "@type": "Organization", name: "ResNeo" },
      publisher: { "@type": "Organization", name: "ResNeo" },
      mainEntityOfPage: { "@type": "WebPage", "@id": PAGE_PATH },
      about: [
        { "@type": "Thing", name: "Employment status for tax" },
        { "@type": "Thing", name: "Salon chair rental" },
      ],
      citation: Object.values(SOURCES).map((s) => ({
        "@type": "CreativeWork",
        name: s.name,
        url: s.href,
        publisher: { "@type": "Organization", name: s.publisher },
      })),
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: "/" },
        { "@type": "ListItem", position: 2, name: "Solutions", item: "/solutions" },
        {
          "@type": "ListItem",
          position: 3,
          name: "Salon chair rental and HMRC employment status",
          item: PAGE_PATH,
        },
      ],
    },
    {
      "@type": "FAQPage",
      mainEntity: faqs.map((f) => ({
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

export default function ChairRentalEmploymentStatusPage() {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Nav />
      <Hero />
      <QuickAnswer />
      <ArticleBody />
      <LinkBreakSection />
      <FaqSection />
      <SourcesSection />
      <Disclaimer />
      <ClosingCta />
      <Footer />
    </div>
  );
}

/* ── Shared bits ──────────────────────────────────────────────────────── */

/** Inline citation link to an external source, opened in a new tab. */
function SourceLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-semibold text-brand-600 underline decoration-brand-200 underline-offset-2 transition-colors hover:text-brand-700 hover:decoration-brand-400"
    >
      {children}
    </a>
  );
}

/* ── Nav ──────────────────────────────────────────────────────────────── */

function Nav() {
  return (
    <nav className="sticky top-0 z-50 border-b border-slate-100 bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex-shrink-0">
          <img src="/Logo.png" alt="ResNeo" className="h-9 w-auto" />
        </Link>
        <div className="flex items-center gap-2 sm:gap-4">
          <Link
            href="/solutions"
            className="hidden rounded-xl px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900 sm:inline-flex"
          >
            Solutions
          </Link>
          <Link
            href="/salon-booking-software"
            className="hidden rounded-xl px-4 py-2 text-sm font-medium text-slate-600 transition-colors hover:text-slate-900 sm:inline-flex"
          >
            Salons &amp; barbers
          </Link>
          <a
            href={SIGNUP}
            className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-700"
          >
            Start free trial
          </a>
        </div>
      </div>
    </nav>
  );
}

/* ── Hero ─────────────────────────────────────────────────────────────── */

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-br from-brand-50 via-white to-accent-50/40" />
      <div
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #0f172a 1px, transparent 1px), linear-gradient(to bottom, #0f172a 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />
      <div className="relative mx-auto max-w-3xl px-6 py-16 sm:py-20">
        <nav aria-label="Breadcrumb" className="text-sm text-slate-500">
          <ol className="flex flex-wrap items-center gap-x-2">
            <li>
              <Link href="/" className="transition-colors hover:text-slate-900">
                Home
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li>
              <Link href="/solutions" className="transition-colors hover:text-slate-900">
                Solutions
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li className="text-slate-700">Chair rental &amp; HMRC</li>
          </ol>
        </nav>

        <span className="mt-6 inline-flex items-center gap-2 rounded-full border border-brand-200 bg-white/80 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand-700 backdrop-blur">
          <span className="h-1.5 w-1.5 rounded-full bg-accent" />
          Guide for salon owners
        </span>

        <h1 className="mt-5 text-4xl font-extrabold leading-[1.1] tracking-tight text-slate-900 sm:text-5xl">
          Is your salon accidentally employing your chair renters?
        </h1>

        <p className="mt-6 text-lg leading-relaxed text-slate-600">
          If you rent chairs or rooms to self-employed stylists, barbers, or beauty therapists, HMRC
          may see your salon differently than you do. Getting it wrong can be expensive.
        </p>

        <p className="mt-6 text-sm text-slate-500">
          Last updated{" "}
          <time dateTime={LAST_UPDATED_ISO} className="font-semibold text-slate-700">
            {LAST_UPDATED_LABEL}
          </time>{" "}
          · 6 minute read · UK
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
        <div className="rounded-2xl border border-brand-100 bg-brand-50/60 p-6 sm:p-8">
          <h2 className="text-xs font-semibold uppercase tracking-widest text-accent-700">
            The short answer
          </h2>
          <p className="mt-3 text-base font-semibold leading-relaxed text-slate-800 sm:text-lg">
            Can HMRC reclassify a self-employed hairdresser as an employee?
          </p>
          <p className="mt-3 text-base leading-relaxed text-slate-700">{QUICK_ANSWER}</p>
        </div>
      </div>
    </section>
  );
}

/* ── Article body ─────────────────────────────────────────────────────── */

function ArticleBody() {
  return (
    <article className="bg-white py-12 sm:py-16">
      <div className="mx-auto max-w-3xl px-6">
        {/* The risk in plain terms */}
        <h2 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          The risk in plain terms
        </h2>
        <p className="mt-5 text-base leading-relaxed text-slate-600">
          Most independent salons in the UK run a mix of employed staff and self-employed chair
          renters. That is completely legal, but only if the self-employed arrangement is genuine.
          HMRC does not simply read your contracts. It looks at how the arrangement actually works
          day to day, and if it looks too much like employment, it can reclassify your chair renters
          as employees, backdated.
        </p>
        <p className="mt-4 text-base leading-relaxed text-slate-600">
          This is not a fringe concern. The current wave of scrutiny traces back to the Supreme
          Court&rsquo;s February 2021 ruling in{" "}
          <SourceLink href={SOURCES.uberJudgment.href}>Uber BV v Aslam [2021] UKSC 5</SourceLink>,
          which found that Uber drivers were workers rather than genuinely self-employed
          contractors, largely because of how much control Uber exercised over their day to day
          work. That case was about employment rights
          rather than tax, but it hardened a principle that runs through both: the reality of the
          working relationship outweighs the label on the contract. Employment status across the gig
          economy, hairdressing included, has drawn closer attention since.
        </p>

        {/* What HMRC actually checks */}
        <h2 className="mt-14 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          What HMRC actually checks
        </h2>
        <p className="mt-5 text-base leading-relaxed text-slate-600">
          Going by{" "}
          <SourceLink href={SOURCES.employmentStatusManual.href}>
            HMRC&rsquo;s own guidance on determining employment status
          </SourceLink>{" "}
          and the way tribunals have applied it, the questions that matter are about real working
          practices, not paperwork. HMRC weighs control, personal service and the right to send a
          substitute, financial risk, and whether someone works exclusively for one place, then
          steps back and looks at the overall picture.
        </p>
        <ol className="mt-8 space-y-4">
          {checks.map((c, i) => (
            <li
              key={c.question}
              className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm transition-colors hover:border-brand-200"
            >
              <div className="flex items-start gap-4">
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-brand-50 text-sm font-bold text-brand-700 ring-1 ring-brand-100">
                  {i + 1}
                </span>
                <div>
                  <h3 className="text-base font-bold text-slate-900">{c.question}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{c.detail}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-6 text-base leading-relaxed text-slate-600">
          None of these factors is decisive on its own. Tribunals weigh the overall picture, so the
          more of them that apply to your salon, the greater the risk.
        </p>

        {/* The real cost of getting it wrong */}
        <h2 className="mt-14 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          The real cost of getting it wrong
        </h2>
        <p className="mt-5 text-base leading-relaxed text-slate-600">
          HMRC does not typically issue a flat fine. If a chair rental arrangement is reclassified as
          employment, the consequences stack up instead.
        </p>
        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {costs.map((c) => (
            <div key={c.title} className="rounded-2xl border border-rose-100 bg-rose-50/50 p-5">
              <h3 className="text-sm font-bold text-slate-900">{c.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{c.detail}</p>
            </div>
          ))}
        </div>
        <p className="mt-6 text-base leading-relaxed text-slate-600">
          Those penalty bands are set out in{" "}
          <SourceLink href={SOURCES.penaltiesFactsheet.href}>
            HMRC&rsquo;s compliance check factsheet CC/FS7A
          </SourceLink>
          , which also explains how a penalty can be reduced if you tell HMRC about an error
          yourself before it asks.
        </p>
        <p className="mt-4 text-base leading-relaxed text-slate-600">
          For a salon with several chair renters over several years, this adds up to a genuinely
          serious bill. In some reported cases it has been enough to threaten the business itself.
        </p>

        {/* Software */}
        <h2 className="mt-14 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          How salon software fits into this, for better or worse
        </h2>
        <p className="mt-5 text-base leading-relaxed text-slate-600">
          Here is the part that does not always get mentioned: your booking software can be part of
          the evidence.
        </p>
        <p className="mt-4 text-base leading-relaxed text-slate-600">
          If every stylist in your salon shares one login, one diary, and one till, with the salon
          effectively controlling who is booked in when and collecting all the payments centrally,
          that is a system that looks like the salon is running the stylists&rsquo; businesses for
          them, rather than the other way around. It does not cause the legal risk. It can make the
          risk harder to argue against if HMRC ever asks questions.
        </p>
      </div>
    </article>
  );
}

/* ── Link & Break ─────────────────────────────────────────────────────── */

function LinkBreakSection() {
  return (
    <section className="relative overflow-hidden bg-slate-900 py-16 text-white sm:py-20">
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            "radial-gradient(circle at 22% 30%, rgba(0,59,111,0.7) 0%, transparent 50%), radial-gradient(circle at 84% 72%, rgba(0,194,199,0.28) 0%, transparent 50%)",
        }}
      />
      <div className="relative mx-auto max-w-3xl px-6">
        <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-white/80 backdrop-blur">
          <LinkIcon className="h-3.5 w-3.5" /> Link &amp; break
        </span>
        <h2 className="mt-6 text-3xl font-bold tracking-tight text-white sm:text-4xl">
          A booking system that reflects real independence
        </h2>
        <p className="mt-5 text-lg leading-relaxed text-white/80">
          Closing that gap is exactly what ResNeo&rsquo;s Link &amp; Break feature was built for.
          Each stylist gets their own diary, their own client list, their own pricing, and their own
          availability: genuinely separate accounts, not just separate logins on a shared system.
          Publicly, those diaries link together so your salon still presents as one smart, unified
          booking page.
        </p>
        <ul className="mt-8 space-y-3">
          {linkBreakPoints.map((point) => (
            <li key={point} className="flex items-start gap-3 text-sm text-white/85">
              <span className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-accent/20 text-accent-200">
                <TickIcon className="h-3 w-3" />
              </span>
              {point}
            </li>
          ))}
        </ul>

        <div className="mt-9 rounded-2xl border border-white/10 bg-white p-6 text-slate-900 shadow-2xl shadow-slate-900/40 sm:p-8">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white shadow-md shadow-brand-600/25">
              <ShieldCheckIcon />
            </span>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-accent-700">
                Built for independents
              </p>
              <h3 className="text-lg font-bold text-slate-900">Clean, separate books for everyone</h3>
            </div>
          </div>
          <p className="mt-4 text-sm leading-relaxed text-slate-600">
            {LINKED_ACCOUNTS_SEPARATE_BOOKS_NOTE}
          </p>
        </div>

        <p className="mt-8 text-base leading-relaxed text-white/75">
          It does not replace proper contracts or genuine working practices. It does mean your
          booking system reflects real independence, instead of quietly working against you.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <a
            href={SIGNUP}
            className="inline-flex h-12 items-center justify-center rounded-xl bg-white px-7 text-base font-semibold text-slate-900 shadow-lg transition-all hover:-translate-y-0.5 hover:bg-brand-50"
          >
            Start your free 14-day trial
            <ArrowRightIcon />
          </a>
          <Link
            href="/salon-booking-software#linked-accounts"
            className="inline-flex h-12 items-center justify-center rounded-xl border border-white/25 bg-transparent px-6 text-base font-semibold text-white backdrop-blur transition-colors hover:bg-white/10"
          >
            See how Link &amp; Break works
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ── FAQ ──────────────────────────────────────────────────────────────── */

function FaqSection() {
  return (
    <section id="faq" className="scroll-mt-16 bg-slate-50 py-16 sm:py-20">
      <div className="mx-auto max-w-3xl px-6">
        <span className="text-xs font-semibold uppercase tracking-widest text-accent-700">
          Common questions
        </span>
        <h2 className="mt-3 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Chair rental and employment status, answered.
        </h2>

        <div className="mt-10 space-y-3">
          {faqs.map((f) => (
            <details
              key={f.q}
              className="group rounded-2xl border border-slate-200 bg-white p-6 open:shadow-md"
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
    <section id="sources" className="scroll-mt-16 bg-white pb-4 pt-16 sm:pt-20">
      <div className="mx-auto max-w-3xl px-6">
        <span className="text-xs font-semibold uppercase tracking-widest text-accent-700">Sources</span>
        <h2 className="mt-3 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          Where this article&rsquo;s facts come from
        </h2>
        <p className="mt-4 text-base leading-relaxed text-slate-600">
          Everything above is drawn from HMRC&rsquo;s published guidance and the official record of
          the case law. Checked on{" "}
          <time dateTime={LAST_UPDATED_ISO}>{LAST_UPDATED_LABEL}</time>.
        </p>

        <ol className="mt-8 space-y-4">
          {Object.values(SOURCES).map((s, i) => (
            <li
              key={s.href}
              className="rounded-2xl border border-slate-200 bg-slate-50/60 p-5 transition-colors hover:border-brand-200"
            >
              <div className="flex items-start gap-4">
                <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-white text-xs font-bold text-brand-700 ring-1 ring-brand-100">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    {s.publisher}
                  </p>
                  <p className="mt-1 text-sm font-semibold leading-snug">
                    <SourceLink href={s.href}>{s.name}</SourceLink>
                  </p>
                  <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.supports}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ── Disclaimer ───────────────────────────────────────────────────────── */

function Disclaimer() {
  return (
    <section className="bg-white py-12">
      <div className="mx-auto max-w-3xl px-6">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6">
          <h2 className="text-sm font-bold text-slate-900">A note on advice</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            This article explains general HMRC principles and publicly reported context. It is not
            legal or tax advice, and every salon&rsquo;s arrangements are different. If you are
            unsure how your own setup would hold up, it is worth a conversation with a qualified UK
            employment or tax adviser who can look at your specific contracts and working practices.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            To get a rough read first, HMRC&rsquo;s free{" "}
            <SourceLink href={SOURCES.cest.href}>
              Check Employment Status for Tax (CEST) tool
            </SourceLink>{" "}
            walks through the main questions. It only reflects the answers you give it, so treat the
            result as a starting point rather than a verdict.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ── Closing CTA ──────────────────────────────────────────────────────── */

function ClosingCta() {
  return (
    <section className="bg-white pb-20 sm:pb-24">
      <div className="mx-auto max-w-3xl px-6 text-center">
        <h2 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          Want to see how Link &amp; Break works for your salon?
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-slate-600">
          Tell us how your chairs are set up and we will walk you through it, or start your free
          trial and try it with a single chair first.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <a
            href={SIGNUP}
            className="inline-flex h-12 items-center justify-center rounded-xl bg-brand-600 px-7 text-base font-semibold text-white shadow-lg shadow-brand-600/25 transition-all hover:-translate-y-0.5 hover:bg-brand-700"
          >
            Start your free 14-day trial
          </a>
          <Link
            href="/#contact"
            className="inline-flex h-12 items-center justify-center rounded-xl border border-slate-200 bg-white px-6 text-base font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300"
          >
            Book a demo
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ── Footer ───────────────────────────────────────────────────────────── */

function Footer() {
  return (
    <footer className="border-t border-slate-100 bg-slate-50 py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-4 px-6 text-sm text-slate-500 sm:flex-row sm:justify-between">
        <p className="max-w-xl text-center leading-snug sm:text-left">
          &copy; 2026 ResNeo · JAR 26 LTD (NI740269) · 100a Main Street, Bangor, BT20 4AG, UK
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 sm:justify-end">
          <Link href="/" className="transition-colors hover:text-slate-900">
            Home
          </Link>
          <Link href="/solutions" className="transition-colors hover:text-slate-900">
            Solutions
          </Link>
          <Link href="/salon-booking-software" className="transition-colors hover:text-slate-900">
            Salons &amp; barbers
          </Link>
          <Link href="/about" className="transition-colors hover:text-slate-900">
            About
          </Link>
          <a href={SIGNUP} className="transition-colors hover:text-slate-900">
            Sign up
          </a>
          <Link href="/login" className="transition-colors hover:text-slate-900">
            Login
          </Link>
          <Link href="/terms" className="transition-colors hover:text-slate-900">
            Website Terms of Use
          </Link>
          <Link href="/privacy" className="transition-colors hover:text-slate-900">
            Privacy Policy
          </Link>
          <SocialLinks />
        </div>
      </div>
    </footer>
  );
}
