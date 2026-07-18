import { PromptValue, type RedirectRequest } from '@azure/msal-browser'
import { loginRequest } from './msalConfig'

// Building the authorization request is the one part of SSO that can be tested
// without a real sign-in, so it lives here on its own rather than inline in the
// component. Auth cannot be exercised in the authoring environment
// (AADSTS50058), and untested auth-adjacent code has already broken sign-in on
// this site once — so the logic that decides what goes on the wire is unit
// tested, and the component just calls these.
//
// THE WHOLE SSO DEMO IS ONE PARAMETER.
//
//   prompt absent  → Entra honours an existing session. That IS single sign-on,
//                    and it's the DEFAULT. SSO isn't a mode you switch on.
//   prompt=login   → Entra ignores the session and demands credentials anyway.
//                    This is SSO deliberately defeated.
//   prompt=none    → Entra will use the session or fail with login_required. It
//                    never shows UI. The silent probe.
//
// Two captures that differ only by this parameter are the demo: same user, same
// live session, ~2 requests versus ~8 plus the typing.

/** How the visitor wants the authorization request shaped. */
export type SsoMode =
  /** Default OIDC: reuse the session if there is one. This is SSO. */
  | 'default'
  /** Force credential entry even though a session exists. SSO defeated. */
  | 'force-credentials'
  /** Never show UI: succeed off the session or fail with login_required. */
  | 'silent'

/**
 * Where a silent (prompt=none) iframe should land.
 *
 * Not the app. A capture showed the whole 1.8 MB SPA booting inside the hidden
 * iframe and MSAL's parent timing out waiting to read the hash — reported as
 * `timed_out`, which looks like a cookie or network fault and is neither: Entra
 * had answered in 197 ms. `public/blank.html` is a few hundred bytes of nothing,
 * which is exactly what an iframe that exists only to carry a fragment should be.
 *
 * Must be registered as a redirect URI on the app registration for every origin
 * this runs on — production is registered; localhost needs adding separately or
 * silent auth fails there with a redirect_uri mismatch.
 */
export const SILENT_REDIRECT_PATH = '/blank.html'

export function silentRedirectUri(): string {
  return `${window.location.origin}${SILENT_REDIRECT_PATH}`
}

export function buildAuthRequest(mode: SsoMode): RedirectRequest {
  switch (mode) {
    case 'force-credentials':
      return { ...loginRequest, prompt: PromptValue.LOGIN }
    case 'silent':
      return { ...loginRequest, prompt: PromptValue.NONE }
    case 'default':
    default:
      // No prompt at all. Deliberately not passing prompt:'select_account' or
      // anything else — the absence is what lets the session be reused, and
      // that absence is the thing the demo is about.
      return { ...loginRequest }
  }
}

/**
 * True when a silent (prompt=none) attempt failed only because there was no
 * usable session — i.e. SSO was unavailable, not broken.
 *
 * This is the instructive failure. A silent probe against a dead session is
 * supposed to fail this way, and saying so is better than showing an error.
 */
export function isInteractionRequired(error: unknown): boolean {
  const code =
    typeof error === 'object' && error !== null && 'errorCode' in error
      ? String((error as { errorCode: unknown }).errorCode)
      : ''
  return (
    code === 'login_required' ||
    code === 'interaction_required' ||
    code === 'consent_required' ||
    code === 'silent_sso_error'
  )
}
