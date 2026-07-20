import type { AccountInfo, AuthenticationResult } from '@azure/msal-browser'
import { clearLastFlow } from '../lib/lastFlow'

/**
 * Consuming the authorization response on the way back in, and recovering when
 * it cannot be consumed.
 *
 * ── The failure ─────────────────────────────────────────────────────────────
 *
 * Measured on the live site:
 *
 *   openid-configuration   (cached)
 *   /authorize      302     Entra authenticated, code issued
 *   SPA /           (cached)
 *                           no /token exchange
 *
 * The click worked and the code came back. Nothing redeemed it, and the page
 * sat blank with no error and no way forward. Clearing all site data by hand
 * was the only exit.
 *
 * `components/SignInPanel.tsx` already recovers from a failure AT THE CLICK.
 * This one happens on the RETURN, before any button exists to press, so no
 * component-level handler can reach it. That is the gap this file fills.
 *
 * It is now on a schedule rather than being an accident: demo accounts are
 * deleted 24 to 30 hours after creation, so a returning visitor's browser can
 * hold MSAL state for a user the directory no longer has.
 *
 * ── Why a null return is a failure, and not just an ordinary load ───────────
 *
 * `handleRedirectPromise()` does not have to reject to leave a code unredeemed.
 * Two paths in msal-browser 5.17.1 return null while a response sits in the
 * fragment, and BOTH are silent under this app's `LogLevel.Warning` config:
 *
 *   StandardController.mjs, handleRedirectPromiseInternal
 *     `if (!this.browserStorage.isInteractionInProgress(true)) return null`
 *     The interaction lock is missing or stamped with another client ID, so no
 *     RedirectClient is ever constructed. Logged at `info`. Nothing is sent.
 *
 *   RedirectClient.mjs, handleRedirectPromise
 *     `getRedirectResponse()` yields no serverParams, so it resets the request
 *     cache and returns null. Also logged at `info`.
 *
 * Either one reproduces the HAR exactly: a code in the fragment, no /token, no
 * error, a blank page. A try/catch alone would not catch either of them, which
 * is why the check below tests the fragment rather than only the rejection.
 *
 * ── Why testing the fragment cannot harm a working session ──────────────────
 *
 * This is the safety property, and it is MSAL's own behaviour rather than an
 * assumption. `RedirectClient.getRedirectResponse()` calls `clearHash(window)`
 * the moment it recognises a response, BEFORE returning it and before any token
 * request goes out. So once MSAL has taken ownership of a response, the code is
 * already gone from the URL.
 *
 * A `code=` still sitting in the fragment after `handleRedirectPromise()` has
 * resolved therefore means MSAL never recognised it. A successful sign-in
 * cannot reach the recovery below, and neither can a refresh after one: there
 * is no longer anything in the fragment to match.
 *
 * ── Ordering ────────────────────────────────────────────────────────────────
 *
 * Nothing here runs until `handleRedirectPromise()` has settled. The fragment
 * carries the code, and the PKCE verifier and state it is redeemed against live
 * in the cache this file wipes. Clearing first IS the failure being fixed.
 */

/**
 * The part of `PublicClientApplication` this needs.
 *
 * Narrow on purpose. `main.tsx` boots at import and pulls in the whole
 * component tree behind it, so it cannot be exercised in a unit test. Taking a
 * structural interface moves the decision out where it can be tested against
 * fakes, which is the same split `interactionLock.ts` makes and for the same
 * reason: this is the risky code, and auth cannot be driven for real from here.
 */
export interface RedirectBootInstance {
  handleRedirectPromise(): Promise<AuthenticationResult | null>
  clearCache(): Promise<void>
  setActiveAccount(account: AccountInfo | null): void
}

/**
 * What the boot did about the redirect. Returned for tests and for the caller's
 * benefit; `main.tsx` renders identically whichever one comes back.
 */
export type RedirectOutcome =
  /** A response came back and MSAL redeemed it. */
  | 'redeemed'
  /** An ordinary page load. There was nothing to redeem. */
  | 'nothing-to-redeem'
  /** A response could not be redeemed, and the state behind it was dropped. */
  | 'recovered'
  /** A response could not be redeemed, and clearing the state failed too. */
  | 'stuck'

/**
 * Is there an authorization response sitting in the fragment?
 *
 * Reads it. Never writes to it: the fragment belongs to MSAL, and
 * `SignInPanel.tsx` carries the same rule with a test holding the line.
 *
 * Takes the hash rather than reading `location` so the decision is pure.
 */
export function isAuthResponseInFragment(hash: string): boolean {
  return /(?:^|[#&?])(?:code|error)=/.test(hash)
}

/**
 * Drop the browser state that could not complete a sign-in.
 *
 * The same three calls `SignInPanel.tsx` makes when a sign-in fails at the
 * click. With no argument MSAL takes the branch that clears every account and
 * token rather than one named account, and the temporary cache goes with it, so
 * a stranded interaction lock does too.
 *
 * Cached state that cannot complete a sign-in is worth less than no cached
 * state at all.
 */
async function dropFailedState(instance: RedirectBootInstance): Promise<RedirectOutcome> {
  try {
    await instance.clearCache()
    instance.setActiveAccount(null)
    // The start stamp belongs to a redirect that never finished. Left in place,
    // the next plain page load would turn the idle minutes since the click into
    // a measured round trip. Same reasoning as SignInPanel's recovery.
    clearLastFlow()
    return 'recovered'
  } catch {
    // A recovery that fails must not stop the app from starting.
    return 'stuck'
  }
}

/**
 * Consume the authorization response, then recover if it could not be consumed.
 *
 * Call after `initialize()` and before rendering, so no component effect can
 * race MSAL for the fragment.
 *
 * Never throws. The app must mount whatever happens in here: a visitor who
 * cannot sign in is a bug, and a visitor looking at a blank page is worse.
 *
 * @param readHash injectable only so the fragment can be set in a test
 */
export async function completeRedirect(
  instance: RedirectBootInstance,
  readHash: () => string = () => window.location.hash,
): Promise<RedirectOutcome> {
  try {
    // Safe to call even though MsalProvider calls it again internally on mount.
    // StandardController memoizes the promise per instance under `options?.hash
    // || ""` and never deletes the entry, so the second call gets this same
    // promise back rather than consuming the response twice. msal-react knows
    // it: MsalProvider.js comments its own fallback with "If
    // handleRedirectPromise returns a cached promise the necessary events may
    // not be fired", and unblocks its startup state in a `.finally` for exactly
    // this case.
    const result = await instance.handleRedirectPromise()

    if (result) return 'redeemed'

    // Null with nothing in the fragment is the ordinary case: a cold load, a
    // refresh, anyone arriving without having just come back from Entra.
    if (!isAuthResponseInFragment(readHash())) return 'nothing-to-redeem'

    // Null WITH a response still in the fragment is the measured bug. MSAL
    // declined to redeem the code and said nothing about it.
    console.warn('[msal] An authorization response was not redeemed. Clearing stored sign-in state.')
  } catch (e) {
    // Entra's own errors arrive here, and so does a request cache MSAL could
    // not read. Either way the response is spent and the state behind it failed.
    console.warn('[msal] The authorization response could not be read. Clearing stored sign-in state.', e)
  }

  return dropFailedState(instance)
}
