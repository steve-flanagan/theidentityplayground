import {
  InteractionRequiredAuthError,
  type AccountInfo,
  type IPublicClientApplication,
  type SilentRequest,
} from '@azure/msal-browser'
import { APP2_CLIENT_ID, crossAppSsoRequest } from '../auth/app2MsalConfig'
import { silentRedirectUri } from '../auth/ssoRequest'
import { readAudience } from './crossAppSso'

// What the button does BEFORE it considers a redirect.
//
// The page shipped with `loginRedirect` on every press. Someone who already
// held a token got sent back to Entra anyway, and for a Google-federated
// account Entra offered a local password page that account has no password for.
// A second press should be the cheapest operation on this page, not the most
// expensive one.
//
// `acquireTokenSilent` tries three things in order, and only the third is the
// one this repo has already proved dead:
//
//   1. the token cache for THIS client ID, same origin, no network at all
//   2. the refresh token, a direct POST to the token endpoint
//   3. a hidden iframe against the Entra session
//
// (3) is the leg the silent-probe capture killed: a third-party frame never
// receives the ciamlogin.com session cookie in a browser with tracking
// protection on. (1) and (2) are untouched by that finding, because neither one
// goes anywhere near that cookie. After this app's own redirect login there is
// a token in this app's own cache, so the ordinary second press is case (1).
//
// AND THAT IS ONLY TRUE WHEN THIS CLIENT HAS A TOKEN. The first version of this
// module gated the silent call on having an ACCOUNT, which is a different thing
// and a much weaker one. MSAL's account cache is shared across client IDs on an
// origin, so on a browser where the main app has signed in, this app sees an
// account it was never issued anything for. (1) misses, (2) misses, and (3) —
// the dead leg — runs. A HAR of that failure: Entra refused the iframe in
// 231 ms with `login_required`, then MSAL sat on its own iframe timeout for
// nearly ten seconds before raising, and only then did the redirect start. The
// button looked hung, then asked for a password. The redirect was always the
// answer; the ten seconds bought nothing.
//
// So the gate is now a token for THIS audience, not an account. See
// `holdsTokenForThisApp`.
//
// When all three legs fail MSAL raises InteractionRequiredAuthError, and the
// caller goes back to the redirect that already works. Nothing here replaces
// that path. It sits in front of it, and every branch below ends either holding
// a token or asking for that redirect.

/**
 * The three methods of MSAL this module actually uses.
 *
 * Narrower than the full instance so a test can stand in for it with an object
 * literal. Auth cannot be exercised in the authoring environment (AADSTS50058),
 * so the mock is the only way this logic gets run before it ships.
 */
export type SilentCapableInstance = Pick<
  IPublicClientApplication,
  'getActiveAccount' | 'getAllAccounts' | 'acquireTokenSilent'
>

export type HeldTokenOutcome =
  /** Straight out of this client's cache. No request left the browser. */
  | { kind: 'cache'; idToken: string }
  /** MSAL went to the network and came back without any interaction. */
  | { kind: 'renewed'; idToken: string }
  /**
   * Nothing silent is available. The caller must fall through to the redirect.
   *
   * `reason` is kept apart on purpose. 'interaction-required' is the designed
   * path and carries no message; 'unexpected' is a real failure whose message
   * must survive rather than be quietly folded into the normal case.
   */
  | { kind: 'redirect'; reason: 'no-account'; message: null }
  /**
   * An account is known here, but no token addressed to this client. Distinct
   * from 'interaction-required' on purpose: that one is MSAL reporting a silent
   * call it tried and lost, this one is the silent call never being made.
   */
  | { kind: 'redirect'; reason: 'no-token-for-this-app'; message: null }
  | { kind: 'redirect'; reason: 'interaction-required'; message: null }
  | { kind: 'redirect'; reason: 'unexpected'; message: string }

/**
 * The account to look tokens up against.
 *
 * Active account first: `mountApp2` sets it from the redirect result, and
 * `active-account-filters` is keyed per client ID, so this one is genuinely
 * ours. The fallback is the shared per-origin account cache, which may well
 * have been filled by the main app. Passing it is still correct: an account
 * identifies the USER, and tokens stay keyed by client ID underneath.
 *
 * What an account does NOT establish is that this client holds anything.
 * `holdsTokenForThisApp` is the check for that, and it runs before any silent
 * call is made.
 */
export function pickAccount(instance: SilentCapableInstance): AccountInfo | null {
  return instance.getActiveAccount() ?? instance.getAllAccounts()[0] ?? null
}

/**
 * Does this client hold a token addressed to itself?
 *
 * The gate in front of every silent call. An account on this origin proves a
 * user is known to the browser; it says nothing about which client IDs have
 * been issued tokens. Asking MSAL to renew from an account with no token of
 * ours behind it is not a cheap miss — it is the full iframe timeout, described
 * at the top of this file.
 *
 * `AccountInfo.idToken` is the right field to read, and that is verified rather
 * than assumed: in msal-common 16.11.2, `getAllAccounts` hydrates it through
 * `CacheManager.getIdToken`, whose filter pins `clientId: this.clientId`. In
 * this instance that is our client ID, so the field is either OUR ID token or
 * undefined. It cannot be the main app's.
 *
 * The audience check on top is deliberate belt and braces, and it costs one
 * already-written function. `readAudience` is the same reader
 * `classifyAcquisition` uses to refuse a foreign token at render time; this is
 * that identical distinction applied one step earlier, where it still saves the
 * ten seconds. It swallows a malformed token and returns null, so an unreadable
 * token fails the check and takes the redirect rather than throwing.
 */
export function holdsTokenForThisApp(
  account: AccountInfo,
  expectedAudience: string = APP2_CLIENT_ID,
): boolean {
  return account.idToken ? readAudience(account.idToken) === expectedAudience : false
}

/**
 * The silent request: the redirect's scopes, the account, and where leg (3) lands.
 *
 * The scopes are read off `crossAppSsoRequest` rather than restated so the two
 * cannot drift. That matters more than it looks: MSAL's cache lookup is keyed
 * by scope, so a silent call asking for a different set than the redirect
 * cached would miss the cache and go to the network for no reason.
 *
 * `redirectUri` is read by leg (3) alone. Legs (1) and (2) never navigate, so
 * they never look at it. Left unset, the hidden iframe inherits this app's own
 * redirect URI and boots the entire 1.8 MB SPA inside itself while the parent
 * waits to read a fragment; MSAL gives up after several seconds and reports
 * `timed_out`, which reads like a cookie or network fault and is neither.
 * `blank.html` is a few hundred bytes of nothing, which is all an iframe that
 * exists to carry a fragment needs to be.
 *
 * The helper is imported rather than the path restated, for the same anti-drift
 * reason as the scopes: `/blank.html` already has to stay in step with the app
 * registration and `staticwebapp.config.json`, and a local copy would make a
 * fourth place to forget. It resolves against `window.location.origin`, so it
 * needs registering on the CrossAppSSO client for every origin this runs on.
 *
 * `prompt` stays absent for the same reason it is absent on the redirect, and
 * the remaining redirect-only fields have no meaning in a silent call.
 */
export function buildHeldTokenRequest(account: AccountInfo): SilentRequest {
  return { scopes: crossAppSsoRequest.scopes, account, redirectUri: silentRedirectUri() }
}

/**
 * Show the held token, renew it, or say that a redirect is the only way left.
 *
 * Never throws. A caller that gets `kind: 'redirect'` has one thing to do and
 * it is the thing the page already did before any of this existed.
 */
export async function acquireHeldToken(
  instance: SilentCapableInstance,
): Promise<HeldTokenOutcome> {
  const account = pickAccount(instance)

  // No account anywhere on this origin means there is nothing to renew from
  // and nothing to show. Straight to the redirect, without a pointless call.
  if (!account) return { kind: 'redirect', reason: 'no-account', message: null }

  // The account above may be the main app's — the account cache is shared
  // across client IDs on this origin. Without a token for OUR audience there is
  // nothing for a silent call to find, and asking anyway costs MSAL's iframe
  // timeout before landing on the same redirect this returns immediately.
  if (!holdsTokenForThisApp(account)) {
    return { kind: 'redirect', reason: 'no-token-for-this-app', message: null }
  }

  try {
    const result = await instance.acquireTokenSilent(buildHeldTokenRequest(account))

    // Defensive, and the reason is specific: a result with no ID token would
    // put the page in a state where it believes it holds one and renders an
    // empty claims table. Treat it as a failure and take the redirect.
    if (!result?.idToken) {
      return {
        kind: 'redirect',
        reason: 'unexpected',
        message: 'The silent request returned no ID token.',
      }
    }

    // MSAL's own flag for whether it touched the network. This is what lets
    // the page distinguish "already had it" from "renewed it" without guessing.
    return { kind: result.fromCache ? 'cache' : 'renewed', idToken: result.idToken }
  } catch (error) {
    // The expected failure, and the only one that is not a fault: no cached
    // token, no usable refresh token, and the iframe leg blocked. This is the
    // signal to go and ask interactively.
    //
    // Identity check rather than an error-code list, because MSAL raises this
    // exact class for the whole family of codes. If a bundling quirk ever made
    // `instanceof` miss, the branch below still ends at the same redirect, so
    // the miss costs a stale error string and nothing else.
    if (error instanceof InteractionRequiredAuthError) {
      return { kind: 'redirect', reason: 'interaction-required', message: null }
    }

    // Anything else is a genuine failure and keeps its message. It still ends
    // at the redirect, because that is the working path and a button that does
    // nothing is worse than one that costs a round trip.
    return {
      kind: 'redirect',
      reason: 'unexpected',
      message: error instanceof Error ? error.message : String(error),
    }
  }
}
