/**
 * Contact Users email: what the platform team sends to venue account holders from
 * /super/contact-users (new features, important news about ResNeo).
 *
 * One renderer serves both sides: the composer's live preview runs it in the browser and the send
 * route runs it on the server, so what the superuser previews is exactly what is sent. That is why
 * this module imports nothing from Node (the unsubscribe link is signed elsewhere and passed in).
 *
 * The look follows the customer welcome email (src/lib/emails/welcome-email.ts): cream page, white
 * rounded card, logo, navy headline with a teal rule, warm body copy, and the company footer.
 *
 * The body is markdown, rendered to inline-styled, table-safe HTML by a private `Marked` instance:
 *  - `# heading` / `## heading` and `### small heading`
 *  - **bold**, *italic*, ~~strike~~, links (http, https, mailto; site paths become absolute)
 *  - bulleted and numbered lists, `---` dividers, images (https only)
 *  - `> quote` becomes a highlighted callout panel
 *  - `[[button: Label | https://...]]` on its own line becomes a navy pill button
 *  - raw HTML is shown as text, never interpreted
 *
 * `{first_name}` and `{venue_name}` in the subject, headline, intro or body are filled per person.
 */

import { Marked, type Tokens, type Token, type TokenizerAndRendererExtension } from 'marked';

// ---------------------------------------------------------------------------
// Content model
// ---------------------------------------------------------------------------

export interface BroadcastContent {
  /** Small label above the headline, e.g. "New feature". Empty hides it. */
  eyebrow: string;
  headline: string;
  /** One or two sentences under the headline. Also used as the inbox preview text. */
  intro: string;
  /** Markdown. */
  body: string;
  /** Opens the body with "Hi {first_name}," when true. */
  greeting: boolean;
  /** Names under "Best regards,". Empty leaves just "The ResNeo team". */
  signOff: string;
}

export const BROADCAST_LIMITS = {
  subject: 150,
  eyebrow: 40,
  headline: 150,
  intro: 400,
  body: 20000,
  signOff: 120,
} as const;

export const BROADCAST_EYEBROW_PRESETS = [
  'New feature',
  'Product update',
  'Important notice',
  'Tips and tricks',
  'News from ResNeo',
] as const;

export const DEFAULT_BROADCAST_SIGN_OFF = 'Ryan, John and Andrew';

export function emptyBroadcastContent(): BroadcastContent {
  return {
    eyebrow: 'New feature',
    headline: '',
    intro: '',
    body: '',
    greeting: true,
    signOff: DEFAULT_BROADCAST_SIGN_OFF,
  };
}

/** Coerces stored or posted JSON into a well-formed content object, trimmed to the limits. */
export function normaliseBroadcastContent(raw: unknown): BroadcastContent {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
  return {
    eyebrow: str(r.eyebrow, BROADCAST_LIMITS.eyebrow),
    headline: str(r.headline, BROADCAST_LIMITS.headline),
    intro: str(r.intro, BROADCAST_LIMITS.intro),
    body: str(r.body, BROADCAST_LIMITS.body),
    greeting: r.greeting !== false,
    signOff: str(r.signOff, BROADCAST_LIMITS.signOff),
  };
}

/** Problems that must be fixed before a send (a draft may be saved with any of them). */
export function broadcastSendProblems(subject: string, content: BroadcastContent): string[] {
  const problems: string[] = [];
  if (!subject.trim()) problems.push('Add a subject line.');
  if (!content.headline.trim()) problems.push('Add a headline.');
  if (!content.body.trim()) problems.push('Write the message.');
  return problems;
}

// ---------------------------------------------------------------------------
// Personalisation
// ---------------------------------------------------------------------------

export interface BroadcastRecipientContext {
  firstName: string | null;
  /** Every venue this address holds an account for (one email per person, not per venue). */
  venueNames: string[];
}

/** "Salon A", "Salon A and Salon B", "Salon A, Salon B and 2 other venues". */
export function describeVenueNames(names: string[]): string {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (clean.length === 0) return 'your business';
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} and ${clean[1]}`;
  if (clean.length === 3) return `${clean[0]}, ${clean[1]} and ${clean[2]}`;
  const rest = clean.length - 2;
  return `${clean[0]}, ${clean[1]} and ${rest} other venues`;
}

/** First word of a staff display name, or null when there is nothing usable. */
export function firstNameFrom(fullName: string | null | undefined): string | null {
  const first = (fullName ?? '').trim().split(/\s+/)[0] ?? '';
  if (!first || first.includes('@')) return null;
  return first.slice(0, 40);
}

const MERGE_TAG = /\{\s*(first_name|venue_name)\s*\}/gi;

function mergeValues(ctx: BroadcastRecipientContext): Record<string, string> {
  return {
    first_name: ctx.firstName?.trim() || 'there',
    venue_name: describeVenueNames(ctx.venueNames),
  };
}

/** Fills merge tags with plain text (subject line, plain-text email). */
export function fillMergeTagsPlain(input: string, ctx: BroadcastRecipientContext): string {
  const values = mergeValues(ctx);
  return input.replace(MERGE_TAG, (_, key: string) => values[key.toLowerCase()] ?? '');
}

/** Backslash-escapes markdown punctuation so a venue called "*Glow*" stays literal. */
function escapeMarkdown(value: string): string {
  return value.replace(/([\\`*_{}[\]()#+\-.!|<>~])/g, '\\$1');
}

function fillMergeTagsMarkdown(input: string, ctx: BroadcastRecipientContext): string {
  const values = mergeValues(ctx);
  return input.replace(MERGE_TAG, (_, key: string) => escapeMarkdown(values[key.toLowerCase()] ?? ''));
}

// ---------------------------------------------------------------------------
// Brand
// ---------------------------------------------------------------------------

const C = {
  page: '#F4F0E9',
  card: '#FFFFFF',
  navy: '#003B6F',
  teal: '#00C2C7',
  ink: '#15324C',
  body: '#4A5663',
  muted: '#717D89',
  link: '#0E7C84',
  eyebrowBg: '#E7FAFA',
  eyebrowText: '#097075',
  calloutBg: '#E7FAFA',
  calloutText: '#28474F',
  panelBg: '#F2F6FA',
  rule: '#EFE7DB',
  footer: '#A39A8C',
  footerFaint: '#B8B0A3',
  codeBg: '#F4F0E9',
} as const;

const FONT = `'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;
const SUPPORT_EMAIL = 'support@resneo.com';
const SITE_URL = 'https://www.resneo.com';
const COMPANY_LINE = `&copy; ${new Date().getFullYear()} ResNeo &middot; JAR 26 LTD (NI740269) &middot; 100a Main Street, Bangor, BT20 4AG, UK`;
const COMPANY_LINE_TEXT = `(c) ${new Date().getFullYear()} ResNeo, JAR 26 LTD (NI740269), 100a Main Street, Bangor, BT20 4AG, UK`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Only http(s) and mailto links survive; a site path ("/help") becomes absolute so it works from
 * an inbox. Anything else (javascript:, data:, relative junk) returns null and renders as text.
 */
export function safeBroadcastHref(href: string, baseUrl: string): string | null {
  const h = href.trim();
  if (!h) return null;
  if (/^mailto:[^\s<>"]+$/i.test(h)) return h;
  if (h.startsWith('/') && !h.startsWith('//')) return `${baseUrl.replace(/\/$/, '')}${h}`;
  try {
    const u = new URL(h);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
  } catch {
    // not a URL
  }
  return null;
}

function safeImageSrc(href: string, baseUrl: string): string | null {
  const safe = safeBroadcastHref(href, baseUrl);
  if (!safe || safe.startsWith('mailto:')) return null;
  return safe.startsWith('https://') || safe.startsWith('http://localhost') ? safe : null;
}

// ---------------------------------------------------------------------------
// Markdown to email HTML
// ---------------------------------------------------------------------------

interface ButtonToken {
  type: 'broadcastButton';
  raw: string;
  label: string;
  href: string;
}

const BUTTON_LINE = /^\[\[\s*button\s*:\s*([^|\]\n]+?)\s*\|\s*([^\]\n]+?)\s*\]\](?:[ \t]*(?:\n+|$))/i;

function buttonHtml(label: string, href: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px"><tr>
<td style="background-color:${C.navy};border-radius:40px;text-align:center"><a href="${escapeHtml(href)}" target="_blank" style="display:inline-block;padding:14px 32px;font-family:${FONT};color:#ffffff;font-size:15px;font-weight:600;line-height:1.2;text-decoration:none;border-radius:40px">${escapeHtml(label)}</a></td>
</tr></table>`;
}

function createEmailMarked(baseUrl: string): Marked {
  let listDepth = 0;
  let inCallout = 0;

  const buttonExtension: TokenizerAndRendererExtension = {
    name: 'broadcastButton',
    level: 'block',
    start(src: string) {
      const i = src.search(/\[\[\s*button\s*:/i);
      return i < 0 ? undefined : i;
    },
    tokenizer(src: string) {
      const m = BUTTON_LINE.exec(src);
      if (!m) return undefined;
      return { type: 'broadcastButton', raw: m[0], label: m[1], href: m[2] } satisfies ButtonToken;
    },
    renderer(token) {
      const t = token as unknown as ButtonToken;
      const href = safeBroadcastHref(t.href, baseUrl);
      if (!href) return `<p style="margin:0 0 18px;font-family:${FONT};font-size:16px;line-height:1.75;color:${C.body}">${escapeHtml(t.label)}</p>`;
      return buttonHtml(t.label, href);
    },
  };

  const md = new Marked({ gfm: true, breaks: true });
  md.use({
    extensions: [buttonExtension],
    renderer: {
      html({ text }) {
        // Raw HTML is shown literally; the composer is markdown only.
        return escapeHtml(text);
      },
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        if (depth <= 2) {
          return `<h2 style="margin:30px 0 12px;font-family:${FONT};font-size:21px;line-height:1.3;font-weight:700;letter-spacing:-0.01em;color:${C.navy}">${inner}</h2>`;
        }
        return `<h3 style="margin:24px 0 8px;font-family:${FONT};font-size:17px;line-height:1.4;font-weight:600;color:${C.ink}">${inner}</h3>`;
      },
      paragraph({ tokens }) {
        const inner = this.parser.parseInline(tokens);
        if (listDepth > 0) return `<p style="margin:0 0 6px">${inner}</p>`;
        const colour = inCallout > 0 ? C.calloutText : C.body;
        const margin = inCallout > 0 ? '0 0 10px' : '0 0 18px';
        return `<p style="margin:${margin};font-family:${FONT};font-size:16px;line-height:1.75;color:${colour}">${inner}</p>`;
      },
      strong({ tokens }) {
        return `<strong style="font-weight:700;color:${inCallout > 0 ? C.calloutText : C.ink}">${this.parser.parseInline(tokens)}</strong>`;
      },
      em({ tokens }) {
        return `<em style="font-style:italic">${this.parser.parseInline(tokens)}</em>`;
      },
      del({ tokens }) {
        return `<span style="text-decoration:line-through">${this.parser.parseInline(tokens)}</span>`;
      },
      codespan({ text }) {
        return `<span style="font-family:SFMono-Regular,Menlo,Consolas,monospace;font-size:14px;background-color:${C.codeBg};border-radius:6px;padding:2px 6px;color:${C.ink}">${text}</span>`;
      },
      code({ text }) {
        return `<div style="margin:0 0 18px;padding:14px 16px;background-color:${C.codeBg};border-radius:12px;font-family:SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;line-height:1.6;color:${C.ink};white-space:pre-wrap">${escapeHtml(text)}</div>`;
      },
      link({ href, tokens }) {
        const inner = this.parser.parseInline(tokens);
        const safe = safeBroadcastHref(href, baseUrl);
        if (!safe) return inner;
        return `<a href="${escapeHtml(safe)}" target="_blank" style="color:${C.link};font-weight:600;text-decoration:underline;text-underline-offset:2px">${inner}</a>`;
      },
      image({ href, text }) {
        const src = safeImageSrc(href, baseUrl);
        if (!src) return escapeHtml(text);
        return `<img src="${escapeHtml(src)}" alt="${escapeHtml(text)}" width="532" style="display:block;width:100%;max-width:532px;height:auto;border:0;border-radius:16px;margin:6px 0 20px" />`;
      },
      hr() {
        return `<div style="height:1px;line-height:1px;font-size:0;background-color:${C.rule};margin:28px 0">&nbsp;</div>`;
      },
      blockquote({ tokens }) {
        inCallout += 1;
        const inner = this.parser.parse(tokens);
        inCallout -= 1;
        return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 22px"><tr>
<td style="background-color:${C.calloutBg};border-left:4px solid ${C.teal};border-radius:14px;padding:18px 22px 8px">${inner}</td>
</tr></table>`;
      },
      list(token) {
        const tag = token.ordered ? 'ol' : 'ul';
        const start = token.ordered && token.start !== 1 && token.start !== '' ? ` start="${Number(token.start)}"` : '';
        listDepth += 1;
        const items = token.items.map((item: Tokens.ListItem) => this.listitem(item)).join('');
        listDepth -= 1;
        const colour = inCallout > 0 ? C.calloutText : C.body;
        return `<${tag}${start} style="margin:0 0 18px;padding:0 0 0 24px;font-family:${FONT};font-size:16px;line-height:1.7;color:${colour}">${items}</${tag}>`;
      },
      listitem(item) {
        return `<li style="margin:0 0 6px;padding-left:4px">${this.parser.parse(item.tokens)}</li>`;
      },
      checkbox({ checked }) {
        return checked ? '&#9745; ' : '&#9744; ';
      },
      table(token) {
        const cell = (c: Tokens.TableCell, header: boolean) =>
          `<td style="padding:10px 12px;border-bottom:1px solid ${C.rule};font-family:${FONT};font-size:14px;line-height:1.5;color:${header ? C.ink : C.body};${header ? 'font-weight:600;' : ''}text-align:${c.align ?? 'left'}">${this.parser.parseInline(c.tokens)}</td>`;
        const head = `<tr>${token.header.map((c: Tokens.TableCell) => cell(c, true)).join('')}</tr>`;
        const rows = token.rows.map((r: Tokens.TableCell[]) => `<tr>${r.map((c) => cell(c, false)).join('')}</tr>`).join('');
        return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;border-collapse:collapse">${head}${rows}</table>`;
      },
    },
  });
  return md;
}

/** The body markdown as email-safe HTML (merge tags already filled). */
export function renderBroadcastBodyHtml(markdown: string, baseUrl: string): string {
  return createEmailMarked(baseUrl).parse(markdown, { async: false }) as string;
}

// ---------------------------------------------------------------------------
// Markdown to plain text (the text/plain part)
// ---------------------------------------------------------------------------

function inlineText(tokens: Token[] | undefined, baseUrl: string): string {
  if (!tokens) return '';
  return tokens
    .map((t) => {
      switch (t.type) {
        case 'link': {
          const label = inlineText(t.tokens, baseUrl);
          const href = safeBroadcastHref(t.href, baseUrl);
          if (!href) return label;
          const bare = href.replace(/^mailto:/i, '');
          return label.trim() === bare || label.trim() === href ? href : `${label} (${bare})`;
        }
        case 'image':
          return t.text ? `[${t.text}]` : '';
        case 'br':
          return '\n';
        case 'codespan':
          return t.text
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'");
        case 'strong':
        case 'em':
        case 'del':
          return inlineText(t.tokens, baseUrl);
        case 'escape':
          return t.text;
        case 'text':
        case 'html':
          return 'tokens' in t && t.tokens ? inlineText(t.tokens, baseUrl) : t.text;
        default:
          return 'text' in t && typeof t.text === 'string' ? t.text : '';
      }
    })
    .join('');
}

function blockText(tokens: Token[], baseUrl: string, indent = ''): string[] {
  const out: string[] = [];
  for (const t of tokens) {
    switch (t.type) {
      case 'space':
        break;
      case 'heading':
        out.push(`${indent}${inlineText(t.tokens, baseUrl).toUpperCase()}`, '');
        break;
      case 'paragraph':
        out.push(`${indent}${inlineText(t.tokens, baseUrl)}`, '');
        break;
      case 'text':
        out.push(`${indent}${'tokens' in t && t.tokens ? inlineText(t.tokens, baseUrl) : t.text}`);
        break;
      case 'list': {
        const start = typeof t.start === 'number' ? t.start : 1;
        t.items.forEach((item: Tokens.ListItem, i: number) => {
          const marker = t.ordered ? `${start + i}. ` : '- ';
          const lines = blockText(item.tokens, baseUrl, '').filter((l) => l !== '');
          lines.forEach((line, li) => out.push(`${indent}${li === 0 ? marker : '   '}${line}`));
        });
        out.push('');
        break;
      }
      case 'blockquote':
        out.push(...blockText(t.tokens ?? [], baseUrl, `${indent}| `));
        break;
      case 'hr':
        out.push(`${indent}----------`, '');
        break;
      case 'code':
        out.push(...t.text.split('\n').map((l: string) => `${indent}    ${l}`), '');
        break;
      case 'table': {
        const row = (cells: Tokens.TableCell[]) => cells.map((c) => inlineText(c.tokens, baseUrl)).join(' | ');
        out.push(`${indent}${row(t.header)}`, ...t.rows.map((r: Tokens.TableCell[]) => `${indent}${row(r)}`), '');
        break;
      }
      case 'broadcastButton': {
        const b = t as unknown as ButtonToken;
        const href = safeBroadcastHref(b.href, baseUrl);
        out.push(`${indent}${b.label}${href ? `: ${href}` : ''}`, '');
        break;
      }
      case 'html':
        out.push(`${indent}${t.text}`);
        break;
      default:
        if ('text' in t && typeof t.text === 'string') out.push(`${indent}${t.text}`, '');
    }
  }
  return out;
}

export function renderBroadcastBodyText(markdown: string, baseUrl: string): string {
  const tokens = createEmailMarked(baseUrl).lexer(markdown);
  return blockText(tokens, baseUrl)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------------------
// Whole email
// ---------------------------------------------------------------------------

export interface RenderBroadcastOptions {
  baseUrl: string;
  subject: string;
  content: BroadcastContent;
  recipient: BroadcastRecipientContext;
  /** Important account notices go to everyone and carry no unsubscribe link. */
  important: boolean;
  /** Signed unsubscribe page URL; null in previews and for important notices. */
  unsubscribeUrl: string | null;
}

export interface RenderedBroadcast {
  subject: string;
  html: string;
  text: string;
  /** The hidden inbox preview line. */
  preheader: string;
}

function textToHtmlLines(s: string): string {
  return escapeHtml(s).replace(/\r?\n/g, '<br/>');
}

export function renderBroadcastEmail(opts: RenderBroadcastOptions): RenderedBroadcast {
  const base = opts.baseUrl.replace(/\/$/, '');
  const { content, recipient } = opts;
  const logoUrl = `${base}/Logo.png`;
  const helpUrl = `${base}/help`;

  const subject = fillMergeTagsPlain(opts.subject, recipient).replace(/\s+/g, ' ').trim();
  const eyebrow = content.eyebrow.trim();
  const headline = fillMergeTagsPlain(content.headline, recipient).trim();
  const intro = fillMergeTagsPlain(content.intro, recipient).trim();
  const bodyMarkdown = fillMergeTagsMarkdown(content.body, recipient);
  const bodyHtml = renderBroadcastBodyHtml(bodyMarkdown, base);
  const bodyText = renderBroadcastBodyText(bodyMarkdown, base);
  const greetingName = recipient.firstName?.trim() || 'there';
  const signOff = content.signOff.trim();
  const venues = describeVenueNames(recipient.venueNames);

  const preheader = (intro || bodyText.split('\n').find((l) => l.trim()) || headline).slice(0, 180);

  const whyHtml = opts.important
    ? `You're receiving this important notice because you hold a ResNeo account for ${escapeHtml(venues)}. We send notices like this to every account holder.`
    : `You're receiving this because you hold a ResNeo account for ${escapeHtml(venues)}.${
        opts.unsubscribeUrl
          ? ` Don't want product news from us? <a href="${escapeHtml(opts.unsubscribeUrl)}" target="_blank" style="color:${C.footer};text-decoration:underline">Unsubscribe</a>.`
          : ''
      }`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light">
<title>${escapeHtml(subject)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
@media only screen and (max-width:480px){
  .bc-pad{padding-left:24px !important;padding-right:24px !important;}
  .bc-panel{padding-left:14px !important;padding-right:14px !important;}
  .bc-h1{font-size:24px !important;}
}
</style>
</head>
<body style="margin:0;padding:0;background-color:${C.page};font-family:${FONT}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all">${escapeHtml(preheader)}${'&#8204;&nbsp;'.repeat(40)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${C.page}">
<tr><td align="center" style="padding:36px 16px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;background-color:${C.card};border-radius:24px;overflow:hidden;box-shadow:0 10px 34px rgba(2,38,74,0.07)">

<tr><td align="center" style="padding:40px 40px 0">
<img src="${escapeHtml(logoUrl)}" alt="ResNeo" width="150" height="35" style="display:block;width:150px;height:auto;border:0;margin:0 auto" />
</td></tr>

<tr><td align="center" class="bc-pad" style="padding:28px 44px 0">
${
  eyebrow
    ? `<div style="display:inline-block;margin:0 0 14px;padding:6px 14px;background-color:${C.eyebrowBg};border-radius:40px;font-family:${FONT};font-size:11px;line-height:1.2;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${C.eyebrowText}">${escapeHtml(eyebrow)}</div>\n`
    : ''
}<h1 class="bc-h1" style="margin:0;font-family:${FONT};font-size:28px;line-height:1.25;font-weight:700;letter-spacing:-0.01em;color:${C.navy}">${escapeHtml(headline)}</h1>
<div style="width:42px;height:4px;background-color:${C.teal};border-radius:40px;margin:18px auto 0"></div>
</td></tr>
${
  intro
    ? `\n<tr><td align="center" class="bc-pad" style="padding:16px 52px 0">
<p style="margin:0;font-family:${FONT};font-size:16px;line-height:1.6;color:${C.muted}">${textToHtmlLines(intro)}</p>
</td></tr>\n`
    : ''
}
<tr><td class="bc-pad" style="padding:30px 44px 4px;font-family:${FONT};font-size:16px;line-height:1.75;color:${C.body}">
${content.greeting ? `<p style="margin:0 0 18px;font-family:${FONT};font-size:16px;line-height:1.75;color:${C.body}">Hi ${escapeHtml(greetingName)},</p>\n` : ''}${bodyHtml}
</td></tr>

<tr><td class="bc-pad" style="padding:8px 44px 4px;font-family:${FONT};font-size:16px;line-height:1.75;color:${C.body}">
<p style="margin:0 0 4px">Best regards,</p>
${signOff ? `<p style="margin:0;font-weight:600;color:${C.ink}">${escapeHtml(signOff)}</p>\n` : ''}<p style="margin:0 0 12px;${signOff ? '' : 'font-weight:600;'}color:${C.ink}">The ResNeo team</p>
<a href="${SITE_URL}" target="_blank" style="font-size:15px;color:${C.link};font-weight:600;text-decoration:none">www.resneo.com</a>
</td></tr>

<tr><td class="bc-panel" style="padding:24px 30px 4px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${C.panelBg};border-radius:18px">
<tr><td style="padding:20px 24px;font-family:${FONT}">
<div style="font-size:15px;font-weight:600;color:${C.ink};margin:0 0 4px">Questions about this?</div>
<p style="margin:0;font-size:14px;line-height:1.65;color:${C.body}">Just reply to this email, write to <a href="mailto:${SUPPORT_EMAIL}" style="color:${C.link};font-weight:600;text-decoration:none">${SUPPORT_EMAIL}</a>, or browse the <a href="${escapeHtml(helpUrl)}" target="_blank" style="color:${C.link};font-weight:600;text-decoration:none">help centre</a>. We usually reply within 24 hours.</p>
</td></tr>
</table>
</td></tr>

<tr><td class="bc-pad" style="padding:26px 44px 40px">
<div style="border-top:1px solid ${C.rule};padding-top:18px;font-family:${FONT};font-size:12px;line-height:1.7;color:${C.footer}">
<p style="margin:0 0 6px">${whyHtml}</p>
<p style="margin:0;color:${C.footerFaint}">${COMPANY_LINE}</p>
</div>
</td></tr>

</table>
</td></tr></table>
</body></html>`;

  const text = [
    eyebrow ? eyebrow.toUpperCase() : null,
    headline,
    intro ? `\n${intro}` : null,
    '',
    content.greeting ? `Hi ${greetingName},\n` : null,
    bodyText,
    '',
    'Best regards,',
    signOff || null,
    'The ResNeo team',
    SITE_URL,
    '',
    `Questions about this? Just reply to this email, write to ${SUPPORT_EMAIL}, or browse the help centre: ${helpUrl}`,
    '',
    opts.important
      ? `You're receiving this important notice because you hold a ResNeo account for ${venues}. We send notices like this to every account holder.`
      : `You're receiving this because you hold a ResNeo account for ${venues}.${
          opts.unsubscribeUrl ? ` Don't want product news from us? Unsubscribe: ${opts.unsubscribeUrl}` : ''
        }`,
    COMPANY_LINE_TEXT,
  ]
    .filter((l): l is string => l !== null)
    .join('\n');

  return { subject, html, text, preheader };
}
