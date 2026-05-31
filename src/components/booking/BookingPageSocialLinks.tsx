import type { BookingPageSocialLinks } from '@/lib/booking/booking-page-theme';

const SOCIAL_PLATFORMS: Array<{ key: keyof BookingPageSocialLinks; label: string; path: string }> = [
  {
    key: 'instagram',
    label: 'Instagram',
    path: 'M12 2.2c3.2 0 3.6 0 4.9.07 1.17.05 1.8.25 2.23.41.56.22.96.48 1.38.9.42.42.68.82.9 1.38.16.42.36 1.06.41 2.23.06 1.27.07 1.65.07 4.86s0 3.6-.07 4.86c-.05 1.17-.25 1.8-.41 2.23-.22.56-.48.96-.9 1.38-.42.42-.82.68-1.38.9-.42.16-1.06.36-2.23.41-1.27.06-1.65.07-4.9.07s-3.6 0-4.86-.07c-1.17-.05-1.8-.25-2.23-.41a3.7 3.7 0 0 1-1.38-.9 3.7 3.7 0 0 1-.9-1.38c-.16-.42-.36-1.06-.41-2.23C2.2 15.6 2.2 15.2 2.2 12s0-3.6.07-4.86c.05-1.17.25-1.8.41-2.23.22-.56.48-.96.9-1.38.42-.42.82-.68 1.38-.9.42-.16 1.06-.36 2.23-.41C8.4 2.2 8.8 2.2 12 2.2Zm0 1.8c-3.15 0-3.5 0-4.74.07-.9.04-1.38.19-1.7.31-.43.17-.74.37-1.06.69-.32.32-.52.63-.69 1.06-.12.32-.27.8-.31 1.7C3.43 8.95 3.42 9.3 3.42 12s0 3.05.07 4.27c.04.9.19 1.38.31 1.7.17.43.37.74.69 1.06.32.32.63.52 1.06.69.32.12.8.27 1.7.31 1.24.06 1.59.07 4.74.07s3.5 0 4.74-.07c.9-.04 1.38-.19 1.7-.31.43-.17.74-.37 1.06-.69.32-.32.52-.63.69-1.06.12-.32.27-.8.31-1.7.06-1.22.07-1.57.07-4.27s0-3.05-.07-4.27c-.04-.9-.19-1.38-.31-1.7a2.86 2.86 0 0 0-.69-1.06 2.86 2.86 0 0 0-1.06-.69c-.32-.12-.8-.27-1.7-.31C15.5 4 15.15 4 12 4Zm0 3.06A4.94 4.94 0 1 1 12 17a4.94 4.94 0 0 1 0-9.88Zm0 1.8a3.14 3.14 0 1 0 0 6.28 3.14 3.14 0 0 0 0-6.28Zm5.14-.7a1.15 1.15 0 1 1-2.3 0 1.15 1.15 0 0 1 2.3 0Z',
  },
  {
    key: 'facebook',
    label: 'Facebook',
    path: 'M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5 3.66 9.15 8.44 9.94v-7.03H7.9v-2.9h2.54V9.85c0-2.52 1.49-3.91 3.78-3.91 1.1 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.78-1.63 1.57v1.89h2.78l-.44 2.9h-2.34V22c4.78-.79 8.43-4.94 8.43-9.94Z',
  },
  {
    key: 'tiktok',
    label: 'TikTok',
    path: 'M16.5 2h-3v13.2a2.4 2.4 0 1 1-2.4-2.4c.2 0 .4 0 .6.07V9.8a5.7 5.7 0 0 0-.6-.03 5.6 5.6 0 1 0 5.6 5.6V8.9a7 7 0 0 0 4 1.27V7.1a4 4 0 0 1-4-4Z',
  },
  {
    key: 'x',
    label: 'X',
    path: 'M17.53 3h2.97l-6.49 7.42L21.75 21h-5.97l-4.68-6.12L5.74 21H2.77l6.94-7.93L2.5 3h6.12l4.23 5.6L17.53 3Zm-1.04 16.2h1.64L7.6 4.72H5.84L16.49 19.2Z',
  },
];

interface BookingPageSocialLinksProps {
  links: BookingPageSocialLinks;
  className?: string;
}

export function BookingPageSocialLinks({ links, className = '' }: BookingPageSocialLinksProps) {
  const items = SOCIAL_PLATFORMS.filter((p) => links[p.key]?.trim());
  if (items.length === 0) return null;

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {items.map((p) => (
        <a
          key={p.key}
          href={links[p.key]!.trim()}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={p.label}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-100 text-slate-600 transition-colors hover:bg-brand-50 hover:text-brand-700"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d={p.path} />
          </svg>
        </a>
      ))}
    </div>
  );
}
