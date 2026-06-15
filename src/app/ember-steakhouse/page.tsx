import Script from 'next/script';
import { EMBED_IFRAME_DEFAULT_HEIGHT_PX } from '@/lib/embed/widget-frame';
import { normalizePublicBaseUrl } from '@/lib/public-base-url';

/** Ember Steakhouse marketing site: same origin for iframe + resize.js as the dashboard widget snippet. */
const emberPublicOrigin = normalizePublicBaseUrl(process.env.NEXT_PUBLIC_BASE_URL);
const emberEmbedSrc = `${emberPublicOrigin}/embed/ember-steakhouse`;
const emberResizeScriptSrc = `${emberPublicOrigin}/embed/resize.js`;

const heroImage = '/images/Ember-steakhouse%20(6).jpg';
const diningRoomImage = '/images/Ember-steakhouse%20(2).jpg';
const steakImage = '/images/Ember-steakhouse%20(8).jpg';
const barImage = '/images/Ember-steakhouse%20(4).jpg';
const privateDiningImage = '/images/Ember-steakhouse%20(5).jpg';
const dessertImage = '/images/Ember-steakhouse%20(7).jpg';

const menuHighlights = [
  {
    title: 'Charcoal-fired steaks',
    description: 'Dry-aged Irish beef, hand cut in-house and finished over oak and charcoal.',
  },
  {
    title: 'Seasonal coastal plates',
    description: 'Scallops, langoustines, smoked butter and bright coastal herbs from local suppliers.',
  },
  {
    title: 'Cellar-led dining',
    description: 'Old world reds, small grower Champagne and a whiskey list built for slow evenings.',
  },
];

const details = [
  'Open Monday to Saturday',
  '12 Noon \u2013 10pm',
  'Online booking via ResNeo',
];

export default function EmberSteakhousePage() {
  return (
    <main className="min-h-screen bg-[#120d0a] text-stone-50">
      <section className="relative min-h-[92vh] overflow-hidden">
        <img
          src={heroImage}
          alt="Ember Steakhouse dining room"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#120d0a] via-[#120d0a]/75 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#120d0a] via-transparent to-[#120d0a]/25" />

        <nav className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-6 py-6">
          <a href="#top" className="text-sm font-semibold uppercase tracking-[0.38em] text-amber-200">
            Ember
          </a>
          <div className="hidden items-center gap-8 text-sm text-stone-200 md:flex">
            <a href="#story" className="hover:text-amber-200">Story</a>
            <a href="#menu" className="hover:text-amber-200">Menu</a>
            <a href="#gallery" className="hover:text-amber-200">Gallery</a>
            <a href="#book" className="rounded-full border border-amber-200/50 px-5 py-2 text-amber-100 hover:bg-amber-200 hover:text-[#120d0a]">
              Book a table
            </a>
          </div>
        </nav>

        <div id="top" className="relative z-10 mx-auto flex max-w-7xl px-6 pb-20 pt-24 sm:pt-32 lg:pt-44">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.32em] text-amber-300">
              Belfast &mdash; Fire-led steakhouse
            </p>
            <h1 className="mt-6 text-5xl font-black tracking-tight text-white sm:text-7xl lg:text-8xl">
              Ember Steakhouse
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-stone-200 sm:text-xl">
              Open fire, aged Irish beef and the best of Northern Ireland&apos;s larder. A neighbourhood steakhouse
              where the quality of every cut, pour and plate is taken seriously.
            </p>
            <div className="mt-10 flex flex-col gap-4 sm:flex-row">
              <a
                href="#book"
                className="inline-flex items-center justify-center rounded-full bg-amber-300 px-8 py-4 text-sm font-bold uppercase tracking-[0.18em] text-[#120d0a] shadow-2xl shadow-amber-950/40 hover:bg-amber-200"
              >
                Reserve now
              </a>
              <a
                href="#menu"
                className="inline-flex items-center justify-center rounded-full border border-stone-400/40 px-8 py-4 text-sm font-bold uppercase tracking-[0.18em] text-stone-100 hover:border-amber-200 hover:text-amber-100"
              >
                Explore menu
              </a>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-amber-100/10 bg-[#1a120d] px-6 py-5">
        <div className="mx-auto flex max-w-7xl flex-wrap justify-center gap-x-8 gap-y-3 text-xs font-semibold uppercase tracking-[0.18em] text-amber-100/80">
          {details.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      </section>

      <section id="story" className="mx-auto grid max-w-7xl gap-10 px-6 py-24 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-amber-300">The room</p>
          <h2 className="mt-4 text-4xl font-bold tracking-tight text-white sm:text-5xl">
            Smoke, leather, brass and the glow of the grill.
          </h2>
          <p className="mt-6 text-base leading-8 text-stone-300">
            Ember Steakhouse is a polished neighbourhood destination: a room for milestone dinners,
            long lunches, and the kind of evening that deserves a second bottle.
          </p>
          <p className="mt-4 text-base leading-8 text-stone-300">
            Every booking is powered by ResNeo, giving guests instant availability, clear confirmations and a
            smooth experience before they step through the door.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <img src={diningRoomImage} alt="Warm restaurant interior" className="h-80 w-full rounded-[2rem] object-cover sm:mt-12" />
          <img src={barImage} alt="Restaurant bar" className="h-80 w-full rounded-[2rem] object-cover" />
        </div>
      </section>

      <section id="menu" className="bg-stone-100 px-6 py-24 text-[#120d0a]">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:items-end">
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.28em] text-amber-700">Food and drink</p>
              <h2 className="mt-4 text-4xl font-black tracking-tight sm:text-5xl">
                Built for fire, seasonality and serious appetite.
              </h2>
            </div>
            <p className="text-lg leading-8 text-stone-700">
              The menu balances luxurious steakhouse classics with bright, local ingredients. Think bone marrow
              crumb, sea salt chips, charred hispi, peppercorn sauce and sticky toffee souffle.
            </p>
          </div>

          <div className="mt-14 grid gap-5 md:grid-cols-3">
            {menuHighlights.map((item) => (
              <article key={item.title} className="rounded-[2rem] border border-stone-200 bg-white p-7 shadow-xl shadow-stone-900/5">
                <h3 className="text-xl font-bold">{item.title}</h3>
                <p className="mt-4 leading-7 text-stone-600">{item.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="gallery" className="mx-auto max-w-7xl px-6 py-24">
        <div className="grid gap-4 md:grid-cols-4 md:grid-rows-[220px_220px]">
          <img src={steakImage} alt="Steak dish" className="h-full w-full rounded-[2rem] object-cover md:col-span-2 md:row-span-2" />
          <img src={privateDiningImage} alt="Private dining" className="h-full w-full rounded-[2rem] object-cover md:col-span-2" />
          <img src={dessertImage} alt="Dessert" className="h-full w-full rounded-[2rem] object-cover" />
          <img src="/images/Ember-steakhouse%20(3).jpg" alt="Restaurant table setting" className="h-full w-full rounded-[2rem] object-cover" />
        </div>
      </section>

      <section id="book" className="bg-[#f7efe2] px-6 py-24 text-[#120d0a]">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.75fr_1.25fr] lg:items-start">
          <div className="lg:sticky lg:top-8">
            <p className="text-sm font-bold uppercase tracking-[0.28em] text-amber-800">Reserve a table</p>
            <h2 className="mt-4 text-4xl font-black tracking-tight sm:text-5xl">
              Book Ember Steakhouse online.
            </h2>
            <p className="mt-5 text-lg leading-8 text-stone-700">
              Choose your date, time and party size to reserve your table.
            </p>
            <div className="mt-8 rounded-3xl bg-[#120d0a] p-6 text-stone-100">
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-300">Opening hours</p>
              <dl className="mt-4 space-y-2 text-sm text-stone-300">
                <div className="flex justify-between gap-4"><dt>Monday &ndash; Saturday</dt><dd>12 Noon &ndash; 10pm</dd></div>
                <div className="flex justify-between gap-4"><dt>Sunday</dt><dd>Closed</dd></div>
              </dl>
            </div>
          </div>

          <div className="overflow-hidden rounded-[2rem] border border-amber-900/10 bg-white shadow-2xl shadow-amber-950/10">
            <iframe
              src={emberEmbedSrc}
              width="100%"
              height={EMBED_IFRAME_DEFAULT_HEIGHT_PX}
              style={{ border: 'none', overflow: 'hidden' }}
              scrolling="no"
              id="reserveni-widget"
              title="ResNeo booking widget for Ember Steakhouse"
            />
          </div>
        </div>
      </section>

      <footer className="border-t border-amber-100/10 bg-[#120d0a] px-6 py-10">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 text-sm text-stone-400 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-semibold uppercase tracking-[0.28em] text-amber-200">Ember Steakhouse</p>
          <p>Online bookings powered by ResNeo.</p>
        </div>
      </footer>

      <Script src={emberResizeScriptSrc} strategy="afterInteractive" />
    </main>
  );
}
