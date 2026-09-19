import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { verifyBroadcastUnsubscribeSignature } from '@/lib/platform/broadcast-unsubscribe';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Email preferences | ResNeo',
  robots: { index: false, follow: false },
};

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? '';
}

/**
 * Where the unsubscribe link in a Contact Users email lands. It asks before it changes anything,
 * because mail scanners open every link in an email; the button posts to /api/updates/unsubscribe,
 * which comes back here with the outcome.
 */
export default async function UpdatesUnsubscribePage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const r = first(sp.r);
  const sig = first(sp.sig);
  const done = first(sp.done);
  const isTest = first(sp.test) === '1';
  const valid = !isTest && first(sp.invalid) !== '1' && verifyBroadcastUnsubscribeSignature(r, sig);
  const action = `/api/updates/unsubscribe?r=${encodeURIComponent(r)}&sig=${encodeURIComponent(sig)}`;

  let heading: string;
  let body: React.ReactNode;

  if (isTest) {
    heading = 'This is a test link';
    body = (
      <p>
        You opened the unsubscribe link from a test email. In a real email, this is where an account holder would
        stop receiving ResNeo product news. Nothing has changed.
      </p>
    );
  } else if (!valid) {
    heading = 'This link has not worked';
    body = (
      <p>
        The link may be incomplete. To stop receiving ResNeo product news, reply to any of our emails, or write to{' '}
        <a className="font-semibold text-[#0E7C84]" href="mailto:hello@resneo.com">
          hello@resneo.com
        </a>
        , and we will sort it for you.
      </p>
    );
  } else if (done === 'unsubscribed') {
    heading = "You're unsubscribed";
    body = (
      <>
        <p>We won&apos;t send you ResNeo product news or feature announcements any more.</p>
        <p className="mt-3">
          You&apos;ll still get emails you need to run your account, such as billing receipts, and any important notice
          about your ResNeo service.
        </p>
        <form method="post" action={action} className="mt-6">
          <input type="hidden" name="action" value="resubscribe" />
          <button type="submit" className="text-sm font-semibold text-[#0E7C84] underline underline-offset-2">
            Changed your mind? Subscribe again
          </button>
        </form>
      </>
    );
  } else if (done === 'resubscribed') {
    heading = "You're subscribed again";
    body = <p>Welcome back. We&apos;ll keep you posted when there&apos;s something new in ResNeo.</p>;
  } else if (done === 'error') {
    heading = 'Something went wrong';
    body = (
      <>
        <p>We couldn&apos;t update your preference just now. Please try again in a minute.</p>
        <form method="post" action={action} className="mt-6">
          <button
            type="submit"
            className="rounded-full bg-[#003B6F] px-6 py-3 text-sm font-semibold text-white hover:bg-[#002b52]"
          >
            Try again
          </button>
        </form>
      </>
    );
  } else {
    heading = 'Stop ResNeo product news?';
    body = (
      <>
        <p>
          We email account holders now and then about new features and news from ResNeo. If you&apos;d rather not hear
          from us about those, you can stop them here.
        </p>
        <p className="mt-3">
          You&apos;ll still get emails you need to run your account, and any important notice about your ResNeo service.
        </p>
        <form method="post" action={action} className="mt-6">
          <button
            type="submit"
            className="rounded-full bg-[#003B6F] px-6 py-3 text-sm font-semibold text-white hover:bg-[#002b52]"
          >
            Unsubscribe from product news
          </button>
        </form>
      </>
    );
  }

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[#F4F0E9] px-4 py-12">
      <div className="w-full max-w-md rounded-3xl bg-white px-8 py-10 text-center shadow-[0_10px_34px_rgba(2,38,74,0.07)]">
        <Image src="/Logo.png" alt="ResNeo" width={150} height={35} className="mx-auto h-auto w-[150px]" priority />
        <h1 className="mt-8 text-2xl font-bold tracking-tight text-[#003B6F]">{heading}</h1>
        <div className="mx-auto mt-4 h-1 w-10 rounded-full bg-[#00C2C7]" />
        <div className="mt-6 text-[15px] leading-relaxed text-[#4A5663]">{body}</div>
        <p className="mt-10 text-xs text-[#A39A8C]">
          <Link href="/" className="hover:underline">
            www.resneo.com
          </Link>
        </p>
      </div>
    </main>
  );
}
