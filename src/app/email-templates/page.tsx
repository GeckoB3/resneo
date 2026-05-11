import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getEmailTemplateGalleryItems } from '@/lib/emails/email-template-gallery-data';

export const metadata: Metadata = {
  title: 'Email template gallery',
  robots: { index: false, follow: false },
};

export default function EmailTemplatesPage() {
  const allowed =
    process.env.NODE_ENV !== 'production' ||
    process.env.ALLOW_EMAIL_TEMPLATE_GALLERY === 'true';
  if (!allowed) {
    notFound();
  }

  const items = getEmailTemplateGalleryItems();

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-8">
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            Email template gallery
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Live HTML previews using demo venue and guest data. Safe area layouts render inside isolated
            frames. Policy-driven emails show both restaurant and appointments lanes where copy differs.
          </p>
          {process.env.NODE_ENV === 'production' ? (
            <p className="mt-3 text-xs text-amber-800">
              Gallery enabled via <code className="rounded bg-amber-100 px-1 py-0.5">ALLOW_EMAIL_TEMPLATE_GALLERY</code>{' '}
              — disable when no longer needed.
            </p>
          ) : null}
        </div>
      </header>

      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-10 lg:flex-row lg:gap-12">
        <nav
          className="lg:w-56 lg:flex-shrink-0"
          aria-label="Templates"
        >
          <div className="sticky top-6 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Jump to
            </p>
            <ul className="max-h-[70vh] space-y-1 overflow-y-auto text-sm">
              {items.map((item) => (
                <li key={item.id}>
                  <a
                    href={`#${item.id}`}
                    className="block rounded px-2 py-1 text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                  >
                    <span className="line-clamp-2">{item.title}</span>
                    {item.subtitle ? (
                      <span className="block text-xs text-slate-500">{item.subtitle}</span>
                    ) : null}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </nav>

        <div className="min-w-0 flex-1 space-y-16">
          {items.map((item) => (
            <section
              key={item.id}
              id={item.id}
              className="scroll-mt-8"
            >
              <div className="mb-4 border-b border-slate-200 pb-4">
                <h2 className="text-lg font-semibold text-slate-900">{item.title}</h2>
                {item.subtitle ? (
                  <p className="mt-1 text-sm text-slate-500">{item.subtitle}</p>
                ) : null}
                <p className="mt-2 font-mono text-xs text-slate-600">
                  <span className="text-slate-400">Subject:</span> {item.subject}
                </p>
              </div>
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <iframe
                  title={`Preview: ${item.title}`}
                  srcDoc={item.html}
                  sandbox=""
                  className="min-h-[640px] w-full border-0 bg-slate-100"
                />
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
