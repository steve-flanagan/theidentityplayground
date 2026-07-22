import { LogLevel, type Configuration, type RedirectRequest } from '@azure/msal-browser'
import { GUEST_PATH } from '../guest/route'

// The WORKFORCE app registration — the same one capture.tsx signs into and the
// one notes/environment.md calls "serves both Module 2 doors, member and guest".
// A visitor signs into it as a self-service B2B guest (Google), so Module 2 can
// show a real guest token beside the customer and the member sample.
//
// This is the THIRD MSAL client on the origin, after the CIAM main app and the
// CIAM /app2 demo. Exactly one instance boots per page (see main.tsx), so they
// never fight over the redirect fragment.
//
// Deliberately NOT ciamlogin.com. That is the External ID tenant; this is the
// WORKFORCE tenant, which authenticates at login.microsoftonline.com — a host
// MSAL trusts by default, so unlike the two CIAM configs this needs no
// knownAuthorities.
//
// Public identifiers only, same argument as msalConfig.ts. No secret exists or
// is possible: SPA platform, PKCE.

const WORKFORCE_TENANT_ID = '9e1372b0-e94f-40af-aef8-6a5fa2bfb2e4'

/** The workforce "member" app registration. Serves both member and guest. */
export const GUEST_CLIENT_ID = '1cb2c7c3-2f2d-499a-8dea-da847280262a'

const AUTHORITY = `https://login.microsoftonline.com/${WORKFORCE_TENANT_ID}`

export const guestMsalConfig: Configuration = {
  auth: {
    clientId: GUEST_CLIENT_ID,
    authority: AUTHORITY,
    // origin + '/guest', not window.location.href: the visitor may have arrived
    // with a trailing slash or a query string, and Entra matches redirect URIs
    // as exact strings, so we build the canonical form.
    //
    // MUST BE REGISTERED as a SPA redirect URI on the workforce app reg (…262a):
    //   https://theidentityplayground.com/guest
    //   http://localhost:5173/guest        (for local testing)
    // Until it is, Entra rejects the return with AADSTS50011 and the page shows
    // the code verbatim.
    redirectUri: `${window.location.origin}${GUEST_PATH}`,
    postLogoutRedirectUri: `${window.location.origin}${GUEST_PATH}`,
  },
  cache: {
    // sessionStorage, matching the other two configs: tokens die with the tab,
    // which is right for a public demo on a machine the visitor may not own.
    cacheLocation: 'sessionStorage',
  },
  system: {
    loggerOptions: {
      logLevel: LogLevel.Warning,
      piiLoggingEnabled: false,
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) return
        if (level === LogLevel.Error) console.error('[msal:guest]', message)
        else if (level === LogLevel.Warning) console.warn('[msal:guest]', message)
      },
    },
  },
}

/**
 * The self-service sign-up request.
 *
 * `prompt: 'select_account'` shows the account picker, where a visitor can add a
 * Google account — the self-service B2B path that the B2X_1_B2B user flow and
 * Google federation on this app reg are configured for. capture.tsx signs guests
 * in exactly this way.
 *
 * Steering straight past the picker to Google with `domain_hint: 'google.com'`
 * is a possible refinement, left off for now so the picker still appears and the
 * flow matches the captured one. Steve's call once the sign-in is verified.
 */
export const guestSignUpRequest: RedirectRequest = {
  scopes: ['openid', 'profile', 'email'],
  prompt: 'select_account',
}
