# R27 web response (2026-09-06)

Reply to `C:\Resneo-app\Docs\R27_WEB_HANDOVER.md` (Ask ResNeo now has an app client), from the
web repo on `staging`.

## The ask: done, in two places

You can have it either way you asked for, because both cost the same one-line call to the same
helper and neither can drift from what the POST does:

| | Where | Use it when |
| --- | --- | --- |
| `assistant_enabled: boolean` | on the existing `GET /api/venue` payload | you already load the bootstrap, which you do. No extra request, no flash of a row you then hide |
| `{ "enabled": boolean }` | new `GET /api/venue/assistant` | anything that does not load the bootstrap, or wants to re-check without refetching a venue |

Both run `assistantEnabledFor(staff.venue_id)`, the same call the POST runs before it answers,
so the flag and the behaviour cannot disagree. Both take the Bearer through
`createVenueRouteClient` like every other venue route.

Two deliberate choices in the GET worth knowing:

- **It answers 200 with `enabled: false`, not 404, when the assistant is off.** The POST 404s
  because the feature does not exist for that caller; the GET is a question whose answer is
  "no", and a 404 would make you guess whether you had asked wrongly.
- **`Cache-Control: no-store`.** The flag flips with an environment variable and a redeploy,
  and during the beta with the allowlist, so a cached "off" would outlive the change.

It answers the bare `{ "error": "Unauthorised" }` 401 with no staff row, like the rest.

## The rest of what you raised

**`page` deliberately not sent.** Right call, and no change needed. The field is optional and
the prompt only uses it as a hint about which screen someone is looking at. `/settings` really
would read as the web Settings page and skew an answer. If you ever want to send one, the
route validates it as a pathname only (`^/[^\s?#]*$`, 200 characters), so an app-shaped value
like `/app/more` or `/app/diary` passes today with no web change; it is free text to the model,
so no vocabulary needs agreeing first. Tell me if you would rather I taught the prompt an
explicit app vocabulary instead.

**The beta allowlist counting app venues.** Noted, and it already does: the allowlist is venue
ids, not clients, so an allowlisted venue gets the assistant on both the web and the app at the
same moment. Nothing to add.

**`client: 'app'` rows in the log.** Also already there: the column is on
`assistant_conversations`, the route infers `app` from the Bearer regardless of what the body
says, and your `client: 'app'` is belt and braces rather than the thing that decides. Your
point about what those rows mean is a good one and I have written it into the plan: a question
asked from a phone at the counter is a different question from one typed at a desk, and the
weekly gap review should read them as such.

**Logging off being visible.** Correct, and it is the designed degradation rather than a bug.
The migration is still owed on both environments. Until it runs, `conversationId`,
`userMessageId` and `assistantMessageId` all come back null and the answer is unaffected, which
I confirmed against a live staging venue. Hiding the thumbs and keeping "Send this to support"
is exactly what the web drawer does.

## The two help-centre lines, fixed

Thank you for catching these. Both were written before #182 landed and both are corrected:

- `resneo-app/clients-in-the-app`: **Records** now covers a linked venue's client, and says what
  the link decides. Reading them needs the link to share client details; adding a file needs
  **Edit existing**; removing one needs **Full management**. It also says the files stay the
  other venue's, so they appear on their dashboard rather than yours.
- `resneo-app/diary-on-your-phone`: the notify panel now says it appears for a partner venue's
  booking too when the link allows editing, and that the message goes out in that venue’s name.

One more you did not flag, found while fixing those: `resneo-app/bookings-in-the-app` said a
linked venue means "look-but-do-not-touch", which was true before #182 and is not now. It names
the three access levels instead.

## Files

- `src/app/api/venue/assistant/route.ts` (new `GET`), `route.test.ts` (4 new cases, 15 total)
- `src/app/api/venue/route.ts` (`assistant_enabled` on the bootstrap)
- the three help articles above
- `Docs/MOBILE_API.md`: a dated section for the enabled check

## Status

On the web `staging` working tree: route tests, the full typecheck and lint all pass, and both
endpoints were checked live against a staging venue, agreeing with each other. Nothing here
changes an existing request or response shape, so it is additive for you.

`ASSISTANT_ENABLED=true` is now set on Vercel, so by the time you read this the flag should
come back true on staging and your row can appear. The migration and the 14 days’ notice the
DPA promises customers before a new sub-processor is used are the two things still between the
assistant and venues other than our own.

