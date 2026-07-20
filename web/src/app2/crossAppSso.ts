import { decodeJwt } from '../lib/jwt'
import { HUMAN_FLOOR_MS } from '../lib/lastFlow'
import { APP2_CLIENT_ID } from '../auth/app2MsalConfig'

// What this page is allowed to claim, and how it knows.
//
// THE PROBLEM. We send an authorization request with no `prompt` parameter, so
// Entra decides what happens next and we do not get told which it chose:
//
//   session exists   → 302 straight back with a code. Nothing on screen. SSO.
//   no session       → Entra shows a sign-in page, the visitor types, and we
//                      get a code back anyway.
//
// Both land here with a valid token. `prompt=none` would make the difference
// explicit — it fails with login_required rather than showing UI — but that is
// exactly the hidden-iframe path a real capture proved dead in any browser with
// third-party cookie protection. So the honest signal is not in the response.
//
// THE ONE HONEST DISCRIMINATOR IS THE CLOCK. Nobody types an email and a
// password in under three seconds. A round trip faster than that had no human
// interaction in it, therefore no prompt was shown, therefore the session was
// reused. That is a BOUND, not a heuristic, and it is the same bound the main
// site's timeline already reasons with — imported rather than restated so the
// two can never drift.
//
// Anything slower is not evidence of anything. It might have been SSO plus a
// slow network, or it might have been a full credential entry. The page says
// exactly that instead of guessing, because guessing here is how a demo starts
// looking fabricated.

/** Namespaced so it cannot collide with the main app's `tip.flow.*` keys. */
const START_KEY = 'tip.app2.start'
const ELAPSED_KEY = 'tip.app2.elapsed'

/**
 * Past this the marker is dropped rather than reported.
 *
 * What it catches is a redirect that never came back on its own: a closed tab,
 * an abandoned sign-in, a visitor who wandered off and reached /app2 again by
 * some other route. That interval is real, but it measures the wandering, and
 * putting it on the page announces a round trip that did not happen the way the
 * number says it did.
 *
 * ── WHY FIVE AND NOT THE MAIN APP'S FIFTEEN ─────────────────────────────────
 *
 * Fifteen is sized for sign-up, where External ID mails a verification code and
 * the wait on that mailbox runs past five minutes often enough to matter. There
 * is no sign-up on this page. `crossAppSsoRequest` carries no prompt and no user
 * flow, so the two outcomes are a session bounce of well under a second, or a
 * credential entry on Entra's own page. Neither one waits on an email.
 *
 * Five minutes is already generous for the slow end of that: a federated hop out
 * to Google plus an MFA prompt is tens of seconds. What it will not survive is a
 * tab left open over lunch, which is the case worth throwing away.
 *
 * Two things this does not touch. The marker is consumed on the first read
 * whatever this says (see completeApp2Timing), so the window cannot leave one
 * lying around for a later flow to pick up. And HUMAN_FLOOR_MS answers a
 * different question at the other end of the scale; nothing here moves it.
 */
export const APP2_STALE_AFTER_MS = 5 * 60_000

/**
 * Call immediately before the redirect leaves the page.
 *
 * Storage can be unavailable (private mode, blocked cookies). Losing the
 * measurement is acceptable — `untimed` below is a real, honest outcome. What
 * is not acceptable is throwing here and breaking the sign-in that follows.
 */
export function markApp2Start(): void {
  try {
    sessionStorage.setItem(START_KEY, String(Date.now()))
  } catch {
    // Deliberately silent. See above.
  }
}

/**
 * Called once when we come back holding a token: turn the start stamp into an
 * elapsed time and keep THAT instead.
 *
 * Persisting the elapsed value rather than recomputing from the start stamp is
 * what lets a page refresh still say something true. sessionStorage and MSAL's
 * token cache die together when the tab closes, so the measurement and the
 * token it describes stay in step.
 *
 * ── WHERE THE INTERVAL ENDS ─────────────────────────────────────────────────
 *
 * At `performance.timeOrigin`: the epoch-millisecond moment THIS document's
 * navigation began, which is the instant the browser came back from Entra. Same
 * clock as the `Date.now()` stamped at the click, so the two subtract cleanly,
 * and fixed for the life of the document, so it does not matter how late in the
 * boot this runs.
 *
 * `Date.now()` used to sit at that end, and it is the same bug the main app's
 * roundTripMs already fixed. It is evaluated after the returned document has
 * loaded AND the SPA has booted, so the interval covered click → Entra →
 * redirect back → the entire cold boot. A real 1.4s SSO measured 3.8s.
 *
 * It costs more here than it did there. classifyAcquisition puts this number
 * straight against HUMAN_FLOOR_MS, so boot time carries a genuine SSO over the
 * floor and the page then refuses to call it SSO, on the one page whose whole
 * subject is SSO.
 *
 * `landedAtMs` is a parameter so the reasoning stays testable against
 * written-down numbers. It defaults to the one real anchor, so no caller passes
 * it.
 */
export function completeApp2Timing(
  landedAtMs: number = performance.timeOrigin,
): number | null {
  try {
    const started = sessionStorage.getItem(START_KEY)
    // Consumed before anything below can reject it, so the marker is single-use
    // whatever happens next. An abandoned redirect can never be left lying
    // around for a later one to pick up and report as its own.
    sessionStorage.removeItem(START_KEY)
    if (!started) return readApp2Elapsed()

    const elapsedMs = landedAtMs - Number(started)

    // NaN from garbage in storage, or an environment with no usable time origin.
    if (!Number.isFinite(elapsedMs)) return null

    // Not positive means no navigation separated the click from this read: the
    // document doing the reading is the one that did the clicking, or an older
    // one the browser restored from its back/forward cache. Either way its time
    // origin predates the click and there is no round trip here to measure.
    if (elapsedMs <= 0) return null

    // Longer than any redirect that came back on its own. See APP2_STALE_AFTER_MS.
    if (elapsedMs > APP2_STALE_AFTER_MS) return null

    sessionStorage.setItem(ELAPSED_KEY, String(elapsedMs))
    return elapsedMs
  } catch {
    return null
  }
}

/** The measurement for the token currently in this tab, if we have one. */
export function readApp2Elapsed(): number | null {
  try {
    const raw = sessionStorage.getItem(ELAPSED_KEY)
    if (raw === null) return null
    const elapsedMs = Number(raw)
    return Number.isFinite(elapsedMs) && elapsedMs >= 0 ? elapsedMs : null
  } catch {
    return null
  }
}

/**
 * The `aud` claim, which is the proof that this token belongs to THIS app.
 *
 * Spec allows `aud` to be a string or an array of strings; Entra issues a
 * string here, but handling both costs a line and avoids a silent null.
 */
export function readAudience(idToken: string): string | null {
  try {
    const { payload } = decodeJwt(idToken)
    const aud = payload.aud
    if (typeof aud === 'string') return aud
    if (Array.isArray(aud) && typeof aud[0] === 'string') return aud[0]
    return null
  } catch {
    return null
  }
}

export type Acquisition =
  /** Faster than any human can type. No prompt was shown; the session was reused. */
  | { kind: 'sso'; elapsedMs: number; audience: string }
  /** Slow enough that a person may have interacted. We will not call this SSO. */
  | { kind: 'interactive'; elapsedMs: number; audience: string }
  /** A real token, but the clock was unavailable. Say so; claim nothing. */
  | { kind: 'untimed'; audience: string }
  /**
   * The token is not addressed to this client. Should be impossible — MSAL
   * reads it out of a cache keyed by our own client ID — but if it ever
   * happens, the page must refuse to present it as this app's token rather
   * than assert something false about a token it did not receive.
   */
  | { kind: 'foreign-audience'; audience: string | null }

/**
 * Pure: everything that decides what the page is allowed to say, in one place
 * that can be tested without a browser or a real sign-in.
 */
export function classifyAcquisition(
  idToken: string,
  elapsedMs: number | null,
  expectedAudience: string = APP2_CLIENT_ID,
): Acquisition {
  const audience = readAudience(idToken)
  if (audience !== expectedAudience) return { kind: 'foreign-audience', audience }

  if (elapsedMs === null) return { kind: 'untimed', audience }
  if (elapsedMs < HUMAN_FLOOR_MS) return { kind: 'sso', elapsedMs, audience }
  return { kind: 'interactive', elapsedMs, audience }
}
