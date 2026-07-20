import type { SsoMode } from '../auth/ssoRequest'
import type { FlowId } from './journey'
import { decodeJwt } from './jwt'

// Which flow did the visitor ACTUALLY just do?
//
// This exists because of a real credibility failure. Someone signed in via SSO
// and the timeline sat on the "Sign-in" capture — a recording of a flow they had
// not performed — with nothing on screen saying it was a recording. To an
// engineer that reads as fabricated data, and it poisons everything around it.
//
// So: only claim what we actually know, and say the rest plainly.
//
//   prompt=login was sent   → deterministic. We know. It was SSO bypassed.
//   a sign-out was clicked  → deterministic for the same reason: this app began
//                              it, so there is nothing to infer.
//   finished impossibly fast → a safe BOUND, not a guess: nobody types an email
//                              and a password in under three seconds, so no
//                              human interaction happened, so the session was
//                              reused. That is SSO.
//   took longer              → a human interacted. Which flow that was is
//                              settled separately, and only if Entra will say:
//                              see resolveAmbiguous. When it will not say, this
//                              stays ambiguous, because guessing here would
//                              reintroduce the bug.
//
// The redirect unloads the page, so this rides through sessionStorage.

const INTENT_KEY = 'tip.flow.intent'
const START_KEY = 'tip.flow.start'
/** The FROZEN answer. See finalize() for why this is not recomputed. */
const RESULT_KEY = 'tip.flow.result'

/**
 * Past this the marker is dropped rather than reported.
 *
 * What it catches is a redirect that never came back on its own: a closed tab,
 * an abandoned sign-in, a visitor who wandered off and returned to the app by
 * some other route. The interval measured in that case is real, but it is a
 * measure of the wandering, and putting it on the badge announces a flow that
 * did not happen the way the number says it did.
 *
 * ── WHY FIFTEEN MINUTES AND NOT FIVE ────────────────────────────────────────
 *
 * Five was sized on a sign-in, which is a round trip of seconds. Sign-up is not
 * that shape. External ID mails a verification code, and waiting on an email
 * runs past five minutes often enough that the slowest sign-ups were the only
 * flows getting no badge at all.
 *
 * Nothing on this side can separate a slow sign-up from an abandonment returned
 * to later. Both are genuine intervals and only the reason for their length
 * differs, which is not observable from here. Fifteen minutes is where that
 * trade is set: long enough for an email round trip, short enough that a tab
 * left open over lunch is still thrown away.
 *
 * Two things this does NOT relax. The marker is consumed on the first read
 * whatever this says (see finalize), so a longer window cannot leave one lying
 * around to be picked up by a later flow. And HUMAN_FLOOR_MS is a lower bound on
 * a different question entirely; nothing here moves it.
 *
 * It does widen the window resolveAmbiguous tests a creation time against, since
 * that window is elapsedMs wide. A returning visitor's account is hours or days
 * old, so widening it to a quarter of an hour still does not reach one.
 */
export const STALE_AFTER_MS = 15 * 60_000

/**
 * No human completes a credential entry this fast. Anything quicker than this
 * had no interaction in it at all — that is the whole basis for the inference,
 * and it is a bound rather than a heuristic.
 */
export const HUMAN_FLOOR_MS = 3000

/**
 * What the visitor set off.
 *
 * The three SsoMode values are shapes an authorization request can take. A
 * sign-out is not a request shape at all, so it sits alongside them rather than
 * being pushed into SsoMode, where it would have to lie about what it is.
 */
export type FlowIntent = SsoMode | 'sign-out'

/** Call immediately before a redirect leaves the page. */
export function markFlowStart(intent: FlowIntent): void {
  try {
    sessionStorage.setItem(INTENT_KEY, intent)
    sessionStorage.setItem(START_KEY, String(Date.now()))
  } catch {
    // Storage can be unavailable (private mode, blocked). Losing the hint is
    // fine — the timeline just doesn't preselect. It must never break sign-in.
  }
}

export type FlowMatch =
  /** We know which flow this was, and why we know. */
  | { kind: 'matched'; flow: FlowId; elapsedMs: number; because: string }
  /** A person interacted. We can't tell which flow that was, and won't pretend. */
  | { kind: 'ambiguous'; elapsedMs: number }
  /** Nothing to say. */
  | null

/** Pure so the reasoning is testable without a browser or a real sign-in. */
export function matchFlow(intent: string | null, elapsedMs: number | null): FlowMatch {
  if (!intent || elapsedMs === null || elapsedMs < 0) return null

  if (intent === 'force-credentials') {
    return {
      kind: 'matched',
      flow: 'sso-off',
      elapsedMs,
      because: 'this app sent prompt=login, so the session was deliberately ignored',
    }
  }

  if (intent === 'sign-out') {
    // Deterministic for the same reason prompt=login is: this app began it, so
    // there is no inference available to get wrong.
    //
    // Only the GLOBAL sign-out reaches this. It redirects, so its elapsed time
    // is a genuine round trip. The local button makes no request and never
    // leaves the page, so there is nothing here for it to measure — it selects
    // the flow directly in the page instead. See signOutAppOnly.
    //
    // Either way there is one 'signout' flow, because the site has exactly one
    // sign-out capture. The local/global split is taught INSIDE that flow
    // (LOGOUT_INSIDE in journey.ts — global measured, local rendered as an
    // absent node because it makes no request at all), not as a second flow.
    // Inventing a 'signout-local' id here would name a capture that does not
    // exist and cannot exist.
    return {
      kind: 'matched',
      flow: 'signout',
      elapsedMs,
      because: 'this app started the sign-out, so there is nothing to infer',
    }
  }

  if (intent === 'default') {
    if (elapsedMs < HUMAN_FLOOR_MS) {
      return {
        kind: 'matched',
        flow: 'sso-on',
        elapsedMs,
        because: 'it finished faster than anyone can type, so no prompt was shown and the session was reused',
      }
    }
    return { kind: 'ambiguous', elapsedMs }
  }

  return null
}

/**
 * How far outside the measured window a creation time may sit and still count
 * as inside it.
 *
 * The window is stamped by the browser and the creation time is stamped by
 * Entra, so two clocks meet in this comparison and the offset between them
 * lands in the answer. That is the price of dropping `iat` (see
 * resolveAmbiguous), and it is a good trade: an NTP-synced machine is off by
 * well under a second, where `iat` in this tenant was off by 292.
 *
 * The two ends do not cost the same, which is why one number covers both.
 *
 *   PAST THE END     An account created after the flow that used it is
 *                    impossible, so nothing legitimate lives out here and
 *                    widening this end costs nothing at all. Past the
 *                    tolerance a clock is wrong by over a minute, and then
 *                    nothing gets claimed.
 *
 *   BEFORE THE START This is where every genuine sign-in lives, because its
 *                    account was created hours or days ago. Widening this end
 *                    is the expensive direction. A minute is still three orders
 *                    of magnitude short of a day, so no returning visitor is
 *                    reachable by it.
 *
 * What the start end buys: a sign-up whose account was created just before the
 * measured round trip began, which is what a sign-up finishing across two trips
 * looks like from here. Without the allowance that reads as a sign-in.
 */
export const WINDOW_TOLERANCE_MS = 60_000

/**
 * The claim carrying when the account was created, exactly as it arrives:
 * lowercase, no namespace prefix.
 *
 * Not a standard claim. A claims mapping policy on the app registration is what
 * puts it in the token, so the name is whatever that policy emits and this
 * constant is the single place it is written down.
 */
export const ACCOUNT_CREATED_CLAIM = 'createddatetime'

/**
 * Two things `Date.parse` gets wrong on a timestamp that is otherwise fine.
 *
 * A space between the date and the time is accepted by V8 and rejected by other
 * engines, so the same token would resolve in Chrome and stay ambiguous in
 * Safari.
 *
 * And a value carrying a time but no zone is parsed as LOCAL time, which puts
 * the browser's clock back into a comparison built specifically to keep it out.
 * An account created at 14:00Z reads as created five hours later in New York,
 * which is how a sign-in ends up badged as a sign-up. A date with no time at all
 * is already UTC by spec and is left alone.
 */
function normalizeTimestamp(text: string): string {
  const iso = text.replace(' ', 'T')
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(iso)
  return iso.includes(':') && !hasZone ? `${iso}Z` : iso
}

/**
 * When the account was created, in epoch milliseconds, or null.
 *
 * Read straight off the ID token the app is already holding. There is no
 * network call behind this and nothing to wait for.
 *
 * The format is not assumed. This is a mapped claim, not a protocol one, so
 * what lands in it is whatever the policy emits, and every shape that cannot be
 * read confidently returns null. Null is not an error here: it is the answer
 * that leaves the flow ambiguous, and an ambiguous flow is claimed as nothing
 * at all. A wrong badge is worse than no badge.
 */
export function accountCreatedAtMs(token: string | null): number | null {
  if (!token) return null

  let raw: unknown
  try {
    raw = decodeJwt(token).payload[ACCOUNT_CREATED_CLAIM]
  } catch {
    return null
  }

  // If it ever arrives as an epoch rather than a string. Seconds and
  // milliseconds are three orders of magnitude apart for any date this claim
  // can plausibly carry, so the two windows do not overlap and there is nothing
  // to get wrong. Anything below them is not a date worth trusting.
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (raw >= 1e12) return raw
    if (raw >= 1e9) return raw * 1000
    return null
  }

  if (typeof raw !== 'string') return null
  const text = raw.trim()
  if (!text) return null

  const ms = Date.parse(normalizeTimestamp(text))
  return Number.isFinite(ms) ? ms : null
}

/**
 * Sign-up or sign-in, from when Entra says the account was created.
 *
 * ── WHY THIS IS NOT A GUESS ─────────────────────────────────────────────────
 *
 * The flow started when the visitor clicked and ended when the browser landed
 * back here. An account created inside that window was created by this flow; an
 * account that already existed before it was not. That is the whole inference,
 * and it is the same shape as the SSO bound above: a fact about ordering, not a
 * judgement about behaviour.
 *
 * The recorded sign-up capture shows why it separates cleanly. POST
 * /common/createuser fires at 50.4s of a 54.8s round trip, seconds before the
 * browser comes back. A sign-in's account is days old. Nothing sits between.
 *
 * ── WHY NOT `iat` ───────────────────────────────────────────────────────────
 *
 * This used to ask a different question: is the account younger than the token
 * naming it. The premise was that `iat` and the creation time are both stamped
 * by Entra, so subtracting them leaves no cross-clock offset in the answer.
 *
 * That premise is false in this tenant. A real sign-up came back with `iat`
 * dated 292 SECONDS EARLIER than `createddatetime` — the token stamped before
 * the account it describes, and before the captured flow entirely. Whatever
 * `iat` marks here, it is not the minting moment, and no tolerance absorbs a
 * five-minute error while still telling a sign-up from a sign-in.
 *
 * So the window replaces it, and `iat` is not read at all. Both ends of the
 * window are browser-stamped: `performance.timeOrigin` is the moment the
 * returned document began loading, and `elapsedMs` back from it is the click.
 * See roundTripMs, which built that pair from this same anchor.
 *
 * ── WHAT THE WINDOW COSTS ───────────────────────────────────────────────────
 *
 * A browser-stamped window against an Entra-stamped creation time puts two
 * clocks back into the comparison, which is exactly what the old design was
 * built to avoid. The margin swallows it: a sign-up creates the account inside
 * a window tens of seconds wide, and a sign-in's account is hours or days old.
 * Seconds of skew cannot move a day. WINDOW_TOLERANCE_MS carries the sizing.
 *
 * ── WHAT IT STILL CANNOT TELL ───────────────────────────────────────────────
 *
 * An account created moments ago in another tab, signing in interactively right
 * now, reads as a sign-up. That needs a fresh account AND a dead Entra session
 * AND a second interactive sign-in inside the window this flow ran in, which is
 * that flow's own elapsed time plus the tolerance and never wider than
 * STALE_AFTER_MS. Named here rather than papered over.
 *
 * Every failure returns the match untouched. No signal means today's behaviour,
 * which is to say nothing.
 *
 * `landedAtMs` is a parameter so the reasoning stays pure and testable against
 * written-down numbers. It defaults to the one real anchor, so no caller passes
 * it and none had to change.
 */
export function resolveAmbiguous(
  match: FlowMatch,
  createdAtMs: number | null,
  idToken: string | null,
  landedAtMs: number = performance.timeOrigin,
): FlowMatch {
  // Never disturb a branch that already knows. force-credentials, sign-out and
  // the sub-human-floor SSO bound are deterministic and are not up for revision.
  if (!match || match.kind !== 'ambiguous') return match
  if (createdAtMs === null || !Number.isFinite(createdAtMs) || !idToken) return match

  // The window this flow ran in. The pair is exact by construction: roundTripMs
  // built elapsedMs by subtracting the click from this same timeOrigin, so
  // adding it back recovers the click. Nothing new is stored to get here.
  if (!Number.isFinite(landedAtMs) || !Number.isFinite(match.elapsedMs) || match.elapsedMs < 0) {
    return match
  }

  const windowEndMs = landedAtMs
  const windowStartMs = landedAtMs - match.elapsedMs

  // An account dated after the flow that carried it. That order is impossible,
  // so a clock is out by more than the tolerance and this declines to say which
  // one. Same posture as the negative-age guard it replaces: nonsense in means
  // nothing out.
  if (createdAtMs > windowEndMs + WINDOW_TOLERANCE_MS) return match

  if (createdAtMs >= windowStartMs - WINDOW_TOLERANCE_MS) {
    return {
      kind: 'matched',
      flow: 'signup',
      elapsedMs: match.elapsedMs,
      because: 'the account did not exist when this flow started, so this flow created it',
    }
  }

  return {
    kind: 'matched',
    flow: 'signin',
    elapsedMs: match.elapsedMs,
    because: 'the account already existed when this flow started',
  }
}

/**
 * How long the round trip took: the click, out to Entra, back on our doorstep.
 *
 * The end of that interval is `performance.timeOrigin` — the epoch-millisecond
 * moment THIS document's navigation began, which is the instant the browser
 * came back from Entra with the response. It is on the same clock as the
 * `Date.now()` stamped at the click, so the two subtract cleanly, and it is a
 * constant for the life of the document, so it does not matter how late in the
 * app's startup the marker gets read.
 *
 * `Date.now()` used to sit at that end, and that was the bug. It is evaluated
 * after the returned document has loaded AND the SPA has booted, so the
 * interval covered click → Entra → redirect back → the whole cold boot. A real
 * SSO sign-in that spent 1.4s at Entra measured 4.0s, cleared HUMAN_FLOOR_MS on
 * about 2.4s of this app starting up, and got reported as interactive. The
 * floor was never the problem. The interval handed to it was.
 */
function roundTripMs(startedAt: number): number | null {
  const landedAt = performance.timeOrigin

  // NaN from garbage in storage, or an environment with no usable time origin.
  if (!Number.isFinite(startedAt) || !Number.isFinite(landedAt)) return null

  const elapsedMs = landedAt - startedAt

  // Not positive means no navigation separated the click from this read: the
  // document doing the reading is the one that did the clicking, or an older one
  // the browser restored from its back/forward cache. Either way its time origin
  // predates the click and there is no round trip here to measure.
  //
  // Say nothing. matchFlow would also reject a negative, but leaning on that
  // silently leaves the case unnamed, and the rule on this site is that
  // reporting nothing is fine while reporting a wrong number is not.
  if (elapsedMs <= 0) return null

  return elapsedMs
}

/**
 * Turn the start marker into a frozen result, exactly once.
 *
 * The bug this fixes: the elapsed time used to be recomputed as
 * `Date.now() - start` on every render, so it grew for as long as the tab stayed
 * open and the banner eventually announced an 825-second sign-in. The round trip
 * has a definite duration and it is measured when the app comes back — after
 * that it is a fact, not a running clock.
 *
 * The marker is single-use: consumed here whether or not it produced a result,
 * so an abandoned redirect can never be reported as a later sign-in.
 */
function finalize(): void {
  const intent = sessionStorage.getItem(INTENT_KEY)
  const started = sessionStorage.getItem(START_KEY)
  if (!intent || !started) return

  sessionStorage.removeItem(INTENT_KEY)
  sessionStorage.removeItem(START_KEY)

  const elapsedMs = roundTripMs(Number(started))
  // Every measurement now excludes SPA boot, so they are all a second or two
  // smaller than they were and this fires slightly less often. That is the
  // direction it should move: the guard exists to catch redirects that never
  // came back, which land minutes or hours over the line, not seconds. Trimming
  // boot time cannot rescue one of those, and it stops a genuinely slow start-up
  // from being thrown away as abandoned.
  if (elapsedMs === null || elapsedMs > STALE_AFTER_MS) return

  const match = matchFlow(intent, elapsedMs)
  if (match) sessionStorage.setItem(RESULT_KEY, JSON.stringify(match))
}

/**
 * What the visitor's last completed sign-in actually was, or null.
 *
 * Null is the common case and the correct one: on a cold page load nobody has
 * signed in yet, so there is nothing to say and the timeline must present its
 * flows as the recorded reference data they are.
 */
export function readLastFlow(): FlowMatch {
  try {
    finalize()
    const raw = sessionStorage.getItem(RESULT_KEY)
    return raw ? (JSON.parse(raw) as FlowMatch) : null
  } catch {
    return null
  }
}

/**
 * Re-freeze the answer once the account's age is known.
 *
 * The frozen result is written the first time anything reads it, which is the
 * timeline deciding on mount what it is showing. The age arrives after that, so
 * the new answer has to be written back over the old one. Without the write, a
 * refresh would drop back to "ambiguous" and the badge would come and go.
 *
 * Returns whatever the answer now is, settled or not, so the caller never has
 * to re-read storage to find out.
 */
export function settleLastFlow(
  createdAtMs: number | null,
  idToken: string | null,
): FlowMatch {
  const current = readLastFlow()
  const settled = resolveAmbiguous(current, createdAtMs, idToken)
  if (settled === current) return current

  try {
    sessionStorage.setItem(RESULT_KEY, JSON.stringify(settled))
  } catch {
    // Storage unavailable. The answer is still right in memory and the caller
    // is about to render it; all that is lost is surviving a refresh.
  }
  return settled
}

/**
 * Drop the frozen answer.
 *
 * Called on both sign-outs, and for the same reason on each: the session it
 * described is gone, so "you just did this" is no longer true of the sign-in
 * and the badge comes down.
 *
 * What happens next differs. The global button redirects, so it marks the
 * sign-out here and the round trip is measured on the way back. The local
 * button never leaves the page, so it clears and stops — the timeline is still
 * mounted and is told which flow to show directly. Without the clear, a global
 * sign-out that went stale would leave the undone sign-in standing.
 */
export function clearLastFlow(): void {
  try {
    sessionStorage.removeItem(INTENT_KEY)
    sessionStorage.removeItem(START_KEY)
    sessionStorage.removeItem(RESULT_KEY)
  } catch {
    // Nothing to do. A stale badge is not worth throwing over.
  }
}
