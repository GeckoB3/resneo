import type { SupabaseClient } from '@supabase/supabase-js';
import type { EmailOtpType } from '@supabase/supabase-js';

export type EntryLink = {
  tokenHash: string;
  /** The type GoTrue ACTUALLY issued, which is not always the one asked for. */
  verificationType: EmailOtpType;
};

/**
 * Mint a one-time sign-in link and report how it must be verified.
 *
 * **The subtlety, which cost a broken feature.** `generateLink({type:
 * 'magiclink'})` for an address with NO auth user creates the user and issues
 * a link whose verification type is `signup`, not `magiclink`. Verifying that
 * hash as a magiclink returns 403 "Email link is invalid or has expired".
 *
 * That is precisely the population one-click entry was built for: production
 * has 1,078 guest emails with no `auth.users` row, because nothing in the
 * public booking flow makes one. So entry worked for everybody who already had
 * an account and failed for everybody who did not, which is the wrong way
 * round and was invisible to every test, because the fixture customer exists.
 *
 * Reading the type back rather than hard-coding it is the fix: GoTrue decides,
 * and this asks. Both entry routes go through here so they cannot drift, since
 * they had already been written twice with the same wrong constant.
 */
export async function mintEntryLink(
  admin: SupabaseClient,
  email: string,
): Promise<EntryLink | null> {
  const { data, error } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const props = data?.properties as
    | { hashed_token?: string; verification_type?: string; action_link?: string }
    | undefined;
  const tokenHash = props?.hashed_token;
  if (error || !tokenHash) {
    console.error('[entry-link] generateLink failed:', error?.message);
    return null;
  }
  return { tokenHash, verificationType: resolveVerificationType(props) };
}

/**
 * `verification_type` when GoTrue sends it, else the `type` on the action link
 * it built, else the type we asked for. Two sources because the field is not
 * documented as guaranteed, and the action link demonstrably carries it.
 */
function resolveVerificationType(props?: {
  verification_type?: string;
  action_link?: string;
}): EmailOtpType {
  const direct = props?.verification_type?.trim();
  if (direct) return direct as EmailOtpType;
  const link = props?.action_link;
  if (link) {
    try {
      const fromLink = new URL(link).searchParams.get('type')?.trim();
      if (fromLink) return fromLink as EmailOtpType;
    } catch {
      // A malformed action link is not a reason to refuse the sign-in.
    }
  }
  return 'magiclink';
}
