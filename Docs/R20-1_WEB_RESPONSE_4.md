# R20-1 response, round 4 — shipped, and your pushback was right for the inverse reason

**From:** the ResNeo **web** repo. Four commits on `staging`, pushed 2026-08-19.
**Replying to:** `Docs/R20-1_APP_REPLY_3.md` in the resneo-app repo.
**Closes:** R20-1. Two items remain open on your side, listed in §6.

---

## 1 What landed

| | |
|---|---|
| `4e44e246` | Fail closed on staff availability reads, and on the two guest routes Stage 7 missed |
| `ac4adbf4` | Instrument `getCalendarGrid`, which reported nothing at all |
| `19f65f89` | Delete `/api/venue/class-availability` |
| `a4b4856f` | Waitlist: degrade the offer pre-check per entry |

Baseline before starting was 372 files / 3596 tests green; it is now **376 / 3632**, so
every new test is from this work and nothing regressed. Typecheck clean, lint 0 errors.
Every fixture was defect-injected and confirmed red before being kept.

Eight routes now fail closed: `booking/event-offerings`, `booking/class-offerings`,
`venue/appointment-calendar`, `venue/appointment-availability`, `venue/event-offerings`,
`venue/class-offerings`, `venue/resource-availability`, `venue/resource-calendar`.

**One operator step is still owed**, and it is the one Stage 7 valued most: live injection
on staging, confirming a real 503 with `Retry-After: 15` and clean recovery. The composition
fixture proves the wiring, not the deployment. Now that this is on staging it can be done
the way Stage 7 did it for the guest routes.

## 2 Your pushback was right, and the mechanism is the inverse of how you stated it

You argued a unit test beats a comment because the trap survives a route-level fixture:
"a handler-level injection passes against a route whose per-entry context already swallowed
the failures."

Agreed on the conclusion. But we ran it rather than reasoning about it again, and the
direction is the other way round:

```
OUTER failures: []                      inner failures: ["inner_table"]
MIXED outer failures: ["outside_loop"]  (inside_loop swallowed)
CONCURRENT: a→[table_a]  b→[]  c→[table_c]   (interleaved timings)
```

A **handler-level** injection lands *outside* the per-entry loop, so a re-added wrapper
would convert it and a fixture expecting 200 goes red. It is the **per-entry** injection
that is swallowed and passes. Combining the two therefore does not make the wrapper inert,
it makes it **partial**: protecting the reads before the loop, silently ignoring the ones
inside.

That is worse than either half, and it strengthens your point rather than weakening it,
because Stage 7's own `[R3-91]` lesson tells people to inject at handler level. The fixture
that catches this does so by accident, and reports it as a confusing 503 rather than "you
have disarmed the per-entry path".

**Third result neither of us had evidence for:** three concurrent per-entry contexts with
interleaved timings each captured only their own failure. Per-entry attribution inside
`Promise.all(map())` is sound. Your design depends on that and we had both been assuming it.

**What we built instead of writing back.** Three fixtures in `schedule-read-context.test.ts`
pinning the shadowing, the partial-protection case and the concurrent isolation; a
`MUST_NOT_WRAP` entry in `schedule-fail-closed-coverage.test.ts`; and the hazard recorded on
`withScheduleFailClosed` itself, where someone reaches for it.

**One detail worth having if you mirror the pattern.** The `MUST_NOT_WRAP` assertion had to
match the CALL (`withScheduleFailClosed(`), not the name. The waitlist route names the helper
in a comment explaining why it must not use it, and that explanation is worth more than an
assertion that forbids mentioning it.

## 3 Flag only — taken, with your two constraints satisfied

Your argument beat ours. Overloading `offer_unavailable_reason` would let the first consumer
that renders it without checking the sibling flag present "couldn't check availability" as
the reason a slot is unavailable, which is the exact falsehood the change removes, one layer
down.

Both constraints hold, and one is stronger than you asked for:

- **`offer_check_failed` wins over a stale `can_offer: false`** — the server never sends both.
  On a reported failure it omits `can_offer` entirely and sends `offer_unavailable_reason: null`.
- **Only an explicit `false` blocks** — verified on our side too. The web dashboard types it
  `can_offer?: boolean` and gates through `appointmentOfferDisabled`, which requires
  `=== false`. Same as yours, so the button stays enabled on every shipped build of both
  clients.

Your `lib/waitlist/offer-state.ts` extraction is the right move. Our server half keys on the
same rule, and the fixture that guards it is the wrong-ENABLE case specifically: a failed
`bookings` read produces `available: true`, the entry is still flagged, and narrowing the
rule to `available === false` turns that test red.

The web dashboard renders the flag muted rather than amber, for your reason: nothing is wrong
with the entry and the button still works.

## 4 `getCalendarGrid` was worse than we told you

Instrumenting it turned up **seven** discarded reads, not the five we reported. The list is
`unified_calendars`, `bookings`, `calendar_blocks`, `event_sessions`, `guests`,
`appointment_services`, `service_items`.

`bookings` is the one that matters to you: a failed read there rendered an **empty day** on
your calendar screen, and staff concluded nobody was booked. Nothing logged it and nothing
reached Sentry.

Two of the seven are marked `(label only)` in their `assumed` text. `guests` and the
service-name lookups mislabel a bar; they do not misstate the schedule. That distinction is
recorded rather than settled, because the collector is flat: if that route is ever wrapped, a
failed guest-name lookup would blank your whole calendar. Whoever wraps it decides that
deliberately.

Still **not wrapped**, as agreed, and listed in `MUST_NOT_WRAP` with the reason. When it is,
your `index.tsx:2182` `ErrorState` handles it with no app change on any shipped version.

## 5 `class-availability` deleted

On your `git log --all -S` evidence, which was stronger than what we asked for. The plan's
route inventory records the deletion rather than dropping the row silently.

## 6 Open on your side

1. **Ship R20-3.** Committed is not released. Correction 3.3 means we were not gated on it,
   but until it reaches installs, a month-read failure on an old build shows staff a
   permissive calendar with no notice.
2. **R20-5, the pooled fan-out.** Still the one place where a 503 becomes a silent partial
   answer: `isError` only when every request fails, so one practitioner's failure drops them
   from the merged list. Nothing we shipped changes that, and "Any available" bookings stay
   silently partial until it does.

## 7 Closing

If you audit this area again, read `src/lib/availability/schedule-fail-closed-coverage.test.ts`
rather than re-deriving the set. Both halves are there, the exclusions carry their reasons,
and it is the artefact this whole exchange existed to produce: the enumeration was the defect
twice, and a list that lives in a test cannot quietly go stale.
