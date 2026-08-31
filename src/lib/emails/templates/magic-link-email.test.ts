/**
 * P3-4e: the sign-in email, which was three bare `<p>` tags built inside a
 * route handler (closes half of G20).
 *
 * What matters about this email is not that it is prettier. It is the first
 * thing a customer sees when they try to get into their account, it arrives
 * unsolicited from the recipient's point of view, and it asks them to click a
 * link and be signed in. An unbranded version of that is indistinguishable
 * from a phishing attempt, and the two things that make it distinguishable are
 * the platform's own chrome and a sentence telling somebody who did not ask
 * that ignoring it is the right answer.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { renderMagicLinkEmail } from './magic-link-email';
import { getEmailTemplateGalleryItems } from '@/lib/emails/email-template-gallery-data';

const URL_ = 'https://www.resneo.com/auth/confirm?token_hash=abc&type=magiclink&next=%2Faccount';

function render(expiryHours = 24) {
  return renderMagicLinkEmail({ confirmUrl: URL_, expiryHours });
}

describe('the sign-in email', () => {
  it('carries the link, in both the HTML and the plain text', () => {
    // The text part is not a formality: some clients render it, and a link
    // present in only one half is a dead email for those readers.
    const { html, text } = render();
    expect(html).toContain('token_hash=abc');
    expect(text).toContain(URL_);
  });

  it('uses the shared layout, so it looks like the platform sent it', () => {
    /*
      `renderBaseTemplate` is the target rather than the booking confirmation's
      richer layout, and the plan's correction is why that needed deciding: the
      confirmation uses its own `booking-confirmation-layout`, and a sign-in
      link has no booking date, party size or venue address to put in a detail
      card. Asserted through the chrome the shared layout brings, not by
      spying on the call.
    */
    const { html } = render();
    expect(html).toMatch(/<!DOCTYPE|<html/i);
    expect(html).toContain('ResNeo');
  });

  it('tells somebody who did NOT ask that doing nothing is enough', () => {
    // The single line that separates this from phishing. Without it the only
    // safe-looking action for a stranger is to click and find out.
    const { html, text } = render();
    for (const body of [html, text]) {
      expect(body).toMatch(/did not ask/i);
      expect(body).toMatch(/ignore this email/i);
    }
  });

  it('states the lifetime it was given, rather than a hardcoded one', () => {
    // `otp_expiry` is a per-project dashboard setting, and the plan records
    // that changing it must update every string stating the lifetime. This
    // template renders whatever the caller passes, so there is one place.
    expect(render(24).text).toContain('24 hours');
    expect(render(72).text).toContain('72 hours');
    expect(render(24).html).toContain('24 hours');
  });

  it('says "1 hour", not "1 hours"', () => {
    const { html, text } = render(1);
    expect(text).toContain('1 hour.');
    expect(html).toContain('1 hour');
    expect(text).not.toContain('1 hours');
  });

  it('promises it works once, because it does', () => {
    // A magic link is single-use. Saying so stops a customer forwarding it to
    // themselves on another device and finding it dead.
    expect(render().text).toMatch(/works once/i);
  });

  it('mentions no venue, because signing in is not a venue action', () => {
    // A customer with bookings at four venues would find any one venue's name
    // on their sign-in email misleading.
    const { html } = render();
    expect(html).not.toMatch(/venue/i);
  });
});

describe('the app code (P3-4i)', () => {
  it('carries the code when there is one', () => {
    /*
      A native client cannot follow a browser link, get a cookie and come back
      holding a session. It CAN take this code straight to
      `verifyOtp({ email, token, type: 'email' })`, which means the app needs
      no ResNeo route to sign in. The route used to discard the field.
    */
    const { html, text } = renderMagicLinkEmail({
      confirmUrl: URL_,
      expiryHours: 24,
      emailOtp: '123456',
    });
    expect(html).toContain('123456');
    expect(text).toContain('123456');
  });

  it.each(['123456', '12345678', '1234567890'])(
    'prints a %s-length code verbatim, because the length is not ours to assume',
    (code) => {
      /*
        This test used to be named for a six-digit code, and the name was read
        as a promise. `otp_length` is a per-project HOSTED setting that
        `supabase/config.toml` does not configure; staging issues eight. A
        client that trusted the config file's six shipped an input that
        truncated the code the email had just sent, and the box silently
        refused to hold it.

        The template's contract is that it prints what it is handed, whole. It
        is asserted over several lengths so the next reader cannot mistake one
        example for a specification.
      */
      const { html, text } = renderMagicLinkEmail({
        confirmUrl: URL_,
        expiryHours: 24,
        emailOtp: code,
      });
      expect(html).toContain(code);
      expect(text).toContain(code);
    },
  );

  it('says nothing about a code when there is not one', () => {
    // `generateLink` does not always return one, and a missing code must not
    // leave a dangling sentence in an email whose link works perfectly.
    const { html, text } = renderMagicLinkEmail({ confirmUrl: URL_, expiryHours: 24 });
    expect(html).not.toMatch(/enter this code/i);
    expect(text).not.toMatch(/enter this code/i);
  });

  it('puts the code AFTER the button, not before it', () => {
    // Almost everybody needs the button. A code offered first reads as extra
    // work for the majority to serve the minority.
    const { html } = renderMagicLinkEmail({
      confirmUrl: URL_,
      expiryHours: 24,
      emailOtp: '123456',
    });
    expect(html.indexOf('123456')).toBeGreaterThan(html.indexOf('Sign in to ResNeo'));
  });
});

describe('P3-4e acceptance: it appears in the template gallery', () => {
  it('is one of the gallery items', () => {
    // Being in the gallery is the only way anybody LOOKS at this email. Built
    // inline in a route handler, nobody ever had.
    const item = getEmailTemplateGalleryItems().find((i) => i.id === 'magic-link');
    expect(item, 'the sign-in email is missing from /email-templates').toBeDefined();
    expect(item!.subject).toBe('Sign in to ResNeo');
    expect(item!.html).toContain('ResNeo');
  });

  it('is the SAME subject the route actually sends', () => {
    // A gallery that previews a different email from the one that goes out is
    // worse than no gallery.
    const route = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/auth/send-magic-link/route.ts'),
      'utf8',
    );
    const item = getEmailTemplateGalleryItems().find((i) => i.id === 'magic-link');
    expect(route).toContain(`subject: '${item!.subject}'`);
  });

  it('is not built inline in the route any more', () => {
    // The regression this guards: someone adding a line to the email by
    // editing the handler, which puts it back outside the gallery.
    const route = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/auth/send-magic-link/route.ts'),
      'utf8',
    );
    expect(route).toContain('renderMagicLinkEmail');
    expect(route, 'the email is being assembled in the route again').not.toMatch(
      /const html = `[\s\S]*<p/,
    );
  });
});
