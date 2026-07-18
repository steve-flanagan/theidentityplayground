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
 */
export function completeApp2Timing(now: number = Date.now()): number | null {
  try {
    const started = sessionStorage.getItem(START_KEY)
    sessionStorage.removeItem(START_KEY)
    if (!started) return readApp2Elapsed()

    const elapsedMs = now - Number(started)
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return null

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
