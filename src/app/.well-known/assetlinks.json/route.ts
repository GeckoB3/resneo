import { NextResponse } from 'next/server';

/**
 * `GET /.well-known/assetlinks.json` (C12, P3-4i).
 *
 * Android's half of the same handshake: this is what lets resneo-app open
 * `www.resneo.com` links instead of Chrome. See the sibling
 * `apple-app-site-association/route.ts` for why both are route handlers and why
 * the app repo restores its intent filter only AFTER these verify.
 *
 * Android is the less forgiving of the two. A verification that FAILS leaves
 * the app worse off than one that never ran, because the system stops offering
 * it as a handler at all, and it does not follow redirects to find this file.
 * If the apex is ever added to the app's declaration, it must serve this
 * directly rather than 307ing to www.
 */
export const dynamic = 'force-static';

/**
 * Verbatim from `Docs/universal-links/assetlinks.json` in the app repo.
 *
 * **Two fingerprints, deliberately, and dropping either breaks a real build.**
 * The first is Play's app-signing certificate, which is what installs from the
 * Play Store are signed with. The second is the EAS upload key, which is what
 * an internal-distribution or `eas build` APK is signed with. Listing only the
 * first would leave every pre-release build failing verification, which is
 * exactly the state that looks like "deep links do not work".
 *
 * Public by design: a signing certificate's fingerprint is published by every
 * app that supports app links.
 */
const ASSET_LINKS = [
  {
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: 'com.resneo.app',
      sha256_cert_fingerprints: [
        'F5:5C:F0:06:D9:67:4B:49:CC:67:85:D3:C5:FC:57:C1:C4:5A:DB:8E:A5:8C:FD:5D:EC:15:62:DD:9A:9E:D4:F5',
        '7A:A6:B8:E3:2F:65:35:B5:42:DD:91:38:C1:D6:99:A1:22:37:29:51:BE:BA:BF:B4:57:90:D1:90:48:8B:CE:AF',
      ],
    },
  },
] as const;

export async function GET() {
  return NextResponse.json(ASSET_LINKS, {
    headers: { 'Content-Type': 'application/json' },
  });
}
