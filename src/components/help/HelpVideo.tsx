import { HELP_VIDEOS } from '@/lib/help/help-videos';

/**
 * Embedded walkthrough video, referenced from an article body with a
 * `:::help-video <id>` marker. Framed to match the hand-built figures so the two
 * block types read as one family.
 *
 * Served from youtube-nocookie.com: the player then sets no tracking cookies
 * until the reader actually presses play, which keeps a passive article view
 * clear of the consent banner's remit. `loading="lazy"` keeps the player off the
 * wire entirely until the reader scrolls to it.
 */
export function HelpVideo({ id }: { id: string }) {
  const def = HELP_VIDEOS[id];
  if (!def) {
    return (
      <div className="my-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        Missing help video: <code className="rounded bg-amber-100 px-1">{id}</code>
      </div>
    );
  }

  const src = `https://www.youtube-nocookie.com/embed/${def.youtubeId}?rel=0`;

  return (
    <figure className="help-video my-8 overflow-hidden rounded-2xl border border-slate-200/90 bg-gradient-to-b from-white to-slate-50/80 shadow-sm shadow-slate-900/5">
      <figcaption className="border-b border-slate-100 bg-slate-50/90 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-800">{def.title}</p>
        {def.caption ? <p className="mt-1 text-sm text-slate-600">{def.caption}</p> : null}
      </figcaption>
      <div className="p-4 sm:p-5">
        <div className="aspect-video w-full overflow-hidden rounded-xl bg-slate-900">
          <iframe
            src={src}
            title={def.title}
            loading="lazy"
            className="h-full w-full border-0"
            allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            allowFullScreen
          />
        </div>
        <p className="mt-3 text-sm text-slate-500">
          If the video does not load,{' '}
          <a
            href={`https://youtu.be/${def.youtubeId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-brand-700 hover:underline"
          >
            watch it on YouTube
          </a>
          .
        </p>
      </div>
    </figure>
  );
}
