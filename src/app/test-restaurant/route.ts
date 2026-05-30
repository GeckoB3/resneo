import { EMBED_IFRAME_DEFAULT_HEIGHT_PX } from '@/lib/embed/widget-frame';

export const dynamic = 'force-static';

export function GET() {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>The Linen Quarter - Belfast</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --ink: #1a1a18;
      --cream: #f5f0e8;
      --warmgrey: #b5a99a;
      --accent: #8b6914;
      --white: #fffdf9;
      --divider: #ddd5c8;
      --reserveni: #4E6B78;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'DM Sans', sans-serif;
      background: var(--cream);
      color: var(--ink);
      line-height: 1.6;
    }

    /* NAV */
    nav {
      position: fixed; top: 0; left: 0; right: 0; z-index: 100;
      display: flex; justify-content: space-between; align-items: center;
      padding: 1.25rem 3rem;
      background: rgba(245,240,232,0.92);
      backdrop-filter: blur(12px);
      border-bottom: 1px solid var(--divider);
    }
    nav .logo {
      font-family: 'Cormorant Garamond', serif;
      font-size: 1.5rem; font-weight: 600; letter-spacing: 0.04em;
      color: var(--ink);
    }
    nav .nav-links { display: flex; gap: 2rem; }
    nav .nav-links a {
      font-size: 0.82rem; font-weight: 500; letter-spacing: 0.08em;
      text-transform: uppercase; text-decoration: none;
      color: var(--ink); opacity: 0.65; transition: opacity 0.2s;
    }
    nav .nav-links a:hover { opacity: 1; }
    nav .nav-links a.cta {
      background: var(--ink); color: var(--cream);
      padding: 0.5rem 1.25rem; border-radius: 2px; opacity: 1;
    }
    nav .nav-links a.cta:hover { background: #333; }

    /* HERO */
    .hero {
      min-height: 100vh;
      display: flex; flex-direction: column; justify-content: center; align-items: center;
      text-align: center; padding: 6rem 2rem 4rem;
      background:
        linear-gradient(180deg, rgba(245,240,232,0) 60%, var(--cream) 100%),
        linear-gradient(135deg, #3a3226 0%, #1a1a18 100%);
      color: var(--cream);
      position: relative; overflow: hidden;
    }
    .hero::before {
      content: '';
      position: absolute; inset: 0;
      background: url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.03'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E");
    }
    .hero-tag {
      font-size: 0.75rem; font-weight: 600; letter-spacing: 0.25em;
      text-transform: uppercase; color: var(--accent); margin-bottom: 1.5rem;
      position: relative;
    }
    .hero h1 {
      font-family: 'Cormorant Garamond', serif;
      font-size: clamp(3rem, 7vw, 6rem); font-weight: 400;
      line-height: 1.05; margin-bottom: 1.5rem; position: relative;
    }
    .hero h1 em { font-style: italic; color: var(--accent); }
    .hero p {
      max-width: 520px; font-size: 1.05rem; opacity: 0.7;
      margin-bottom: 2.5rem; position: relative;
    }
    .hero .scroll-hint {
      position: absolute; bottom: 2.5rem;
      font-size: 0.7rem; letter-spacing: 0.15em; text-transform: uppercase;
      opacity: 0.4; animation: bob 2s ease-in-out infinite;
    }
    @keyframes bob {
      0%,100% { transform: translateY(0); }
      50% { transform: translateY(6px); }
    }

    /* SECTIONS */
    section { padding: 5rem 3rem; max-width: 1100px; margin: 0 auto; }

    .section-label {
      font-size: 0.7rem; font-weight: 600; letter-spacing: 0.2em;
      text-transform: uppercase; color: var(--warmgrey); margin-bottom: 0.75rem;
    }
    .section-title {
      font-family: 'Cormorant Garamond', serif;
      font-size: clamp(2rem, 4vw, 3rem); font-weight: 400;
      margin-bottom: 1.5rem; line-height: 1.15;
    }

    /* ABOUT */
    .about-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 4rem;
      align-items: center; margin-top: 2rem;
    }
    .about-img {
      aspect-ratio: 4/5; border-radius: 4px; overflow: hidden;
    }
    .about-img img {
      width: 100%; height: 100%; object-fit: cover; display: block;
    }
    .about-text p { margin-bottom: 1rem; opacity: 0.75; font-size: 0.95rem; }

    /* MENU HIGHLIGHTS */
    .menu-section { text-align: center; border-top: 1px solid var(--divider); }
    .menu-grid {
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 2.5rem;
      margin-top: 3rem;
    }
    .menu-card {
      text-align: left; padding: 2rem;
      border: 1px solid var(--divider); border-radius: 4px;
      background: var(--white);
      transition: transform 0.25s, box-shadow 0.25s;
    }
    .menu-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 12px 40px rgba(0,0,0,0.06);
    }
    .menu-card h3 {
      font-family: 'Cormorant Garamond', serif;
      font-size: 1.35rem; margin-bottom: 0.5rem;
    }
    .menu-card .price {
      font-size: 0.8rem; color: var(--accent); font-weight: 600;
      letter-spacing: 0.05em; margin-bottom: 0.75rem;
    }
    .menu-card p { font-size: 0.85rem; opacity: 0.65; }

    /* BOOKING / IFRAME SECTION */
    .booking-section {
      border-top: 1px solid var(--divider);
      text-align: center;
    }
    .booking-section .section-title { margin-bottom: 0.75rem; }
    .booking-section .subtitle {
      font-size: 0.95rem; opacity: 0.6; margin-bottom: 2.5rem;
      max-width: 480px; margin-left: auto; margin-right: auto;
    }

    .iframe-container {
      width: 100%; max-width: 700px; margin: 0 auto;
      min-height: 700px;
      border-radius: 8px;
      background: var(--white);
      position: relative;
      overflow: hidden;
    }

    .iframe-container iframe {
      width: 100%; height: 100%; min-height: 700px;
      border: none; border-radius: 6px;
    }

    /* FOOTER */
    footer {
      margin-top: 2rem; padding: 3rem;
      border-top: 1px solid var(--divider);
      display: flex; justify-content: space-between; align-items: flex-start;
      max-width: 1100px; margin-left: auto; margin-right: auto;
      font-size: 0.82rem; opacity: 0.6;
    }
    footer .foot-brand {
      font-family: 'Cormorant Garamond', serif;
      font-size: 1.15rem; font-weight: 600; margin-bottom: 0.4rem; opacity: 1;
    }
    footer a { color: var(--ink); }

    .powered-by {
      text-align: center; padding: 1.5rem;
      font-size: 0.72rem; opacity: 0.35; letter-spacing: 0.05em;
    }
    .powered-by a { color: var(--reserveni); text-decoration: none; font-weight: 600; }

    /* RESPONSIVE */
    @media (max-width: 768px) {
      nav { padding: 1rem 1.5rem; }
      nav .nav-links { gap: 1rem; }
      section { padding: 3.5rem 1.5rem; }
      .about-grid { grid-template-columns: 1fr; gap: 2rem; }
      .menu-grid { grid-template-columns: 1fr; }
      footer { flex-direction: column; gap: 1.5rem; }
    }
  </style>
</head>
<body>

  <!-- NAV -->
  <nav>
    <div class="logo">The Linen Quarter</div>
    <div class="nav-links">
      <a href="#about">About</a>
      <a href="#menu">Menu</a>
      <a href="#booking" class="cta">Book a Table</a>
    </div>
  </nav>

  <!-- HERO -->
  <div class="hero">
    <div class="hero-tag">Belfast \u00b7 Cathedral Quarter</div>
    <h1>Seasonal cooking,<br><em>honestly done.</em></h1>
    <p>Modern Irish plates rooted in Northern Ireland\u2019s farms, shores, and seasons. Open Wednesday \u2013 Sunday.</p>
    <div class="scroll-hint">\u2193 Scroll</div>
  </div>

  <!-- ABOUT -->
  <section id="about">
    <div class="about-grid">
      <div>
        <div class="section-label">Our Story</div>
        <div class="section-title">A table in<br>the heart of Belfast</div>
        <div class="about-text">
          <p>The Linen Quarter is a neighbourhood restaurant celebrating the ingredients and producers of Northern Ireland. Our menu changes with the season \u2014 guided by what\u2019s best at market that week.</p>
          <p>We keep things simple: honest cooking, natural wines, warm service, and a room that feels like it belongs to you for the evening.</p>
        </div>
      </div>
      <div class="about-img">
        <img src="/images/restaurant-demo.png" alt="Fine dining plate at The Linen Quarter" />
      </div>
    </div>
  </section>

  <!-- MENU -->
  <section id="menu" class="menu-section">
    <div class="section-label">What\u2019s On</div>
    <div class="section-title">Menu highlights</div>
    <div class="menu-grid">
      <div class="menu-card">
        <h3>Strangford Oysters</h3>
        <div class="price">\u00a314</div>
        <p>Half dozen, mignonette, brown soda</p>
      </div>
      <div class="menu-card">
        <h3>Glenarm Short Rib</h3>
        <div class="price">\u00a326</div>
        <p>12-hour braise, celeriac, bone marrow jus</p>
      </div>
      <div class="menu-card">
        <h3>Comber Potato Fondant</h3>
        <div class="price">\u00a38</div>
        <p>Aged butter, sea salt, chive oil</p>
      </div>
    </div>
  </section>

  <!-- BOOKING -->
  <section id="booking" class="booking-section">
    <div class="section-label">Reservations</div>
    <div class="section-title">Reserve your table</div>
    <p class="subtitle">Book online below, or call us on 028 9024 XXXX for groups of 8 or more.</p>

    <div class="iframe-container">
      <iframe src="https://www.reserveni.com/embed/test-restaurant" width="100%" height="${EMBED_IFRAME_DEFAULT_HEIGHT_PX}" style="border:none;overflow:hidden;" scrolling="no" id="reserveni-widget"></iframe>
      <script src="https://www.reserveni.com/embed/resize.js"></script>
    </div>
  </section>

  <!-- FOOTER -->
  <footer>
    <div>
      <div class="foot-brand">The Linen Quarter</div>
      <div>14 Waring Street, Belfast BT1 2DX</div>
      <div>Open Wed \u2013 Sun, 5:30 pm \u2013 late</div>
    </div>
    <div style="text-align:right">
      <div><a href="#">Instagram</a></div>
      <div style="margin-top:0.25rem"><a href="mailto:hello@thelinenquarter.com">hello@thelinenquarter.com</a></div>
    </div>
  </footer>

  <div class="powered-by">
    Reservations powered by <a href="https://www.reserveni.com">Resneo</a>
  </div>

</body>
</html>`;

  return new Response(html, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
