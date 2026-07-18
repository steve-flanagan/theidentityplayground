import { LogLevel, type Configuration, type RedirectRequest } from '@azure/msal-browser'
import { APP2_PATH } from '../app2/route'

// The SECOND application. A separate app registration in the SAME External ID
// tenant as the main site.
//
// This file deliberately does not import from `msalConfig.ts`. Sharing a config
// object between two client IDs is how you end up with one app quietly using
// the other's identity, and this whole demo rests on the two being genuinely
// separate: separate registration, separate client ID, separate token cache,
// separate redirect URI. The duplication here is the point being demonstrated.
//
// Nothing below is a secret. Client IDs travel in every authorize request and
// land in the `aud` claim of every token; tenant IDs are in the unauthenticated
// OIDC discovery document. See the note in msalConfig.ts — the argument is the
// same one and it has not changed.

const TENANT_ID = '7e8da8a9-67bc-4d53-bfc7-fe3e13128382'

/** The second app registration: "CrossAppSSO", SPA platform, single tenant. */
export const APP2_CLIENT_ID = '0951090a-650a-4d43-9f81-b9195866fc6c'

/**
 * The main site's client ID, for display only.
 *
 * Copied rather than imported because `msalConfig.ts` does not export it, and
 * that file is not ours to change. It is used on this page for exactly one
 * thing: showing the visitor two different client IDs side by side. If it ever
 * drifts, the source of truth is `CLIENT_ID` in `auth/msalConfig.ts` — nothing
 * authenticates with the copy.
 */
export const MAIN_CLIENT_ID_FOR_DISPLAY = 'e891bf4d-ab35-4686-81b9-a973001b378f'

const AUTHORITY = `https://theidentityplayground.ciamlogin.com/${TENANT_ID}`

export const app2MsalConfig: Configuration = {
  auth: {
    clientId: APP2_CLIENT_ID,
    authority: AUTHORITY,
    // Same anti-phishing allow-list requirement as the main app: MSAL will not
    // send an authorize request to ciamlogin.com unless it is declared trusted.
    knownAuthorities: ['theidentityplayground.ciamlogin.com'],
    // origin + '/app2', not window.location.href. The visitor may have arrived
    // at "/app2/" with a trailing slash, or with a query string, and Entra
    // matches redirect URIs as exact strings — so we build the canonical form
    // rather than echoing whatever is in the address bar.
    //
    // REGISTERED TODAY: https://theidentityplayground.com/app2 only.
    // On localhost this resolves to http://localhost:5173/app2, which is NOT on
    // the CrossAppSSO registration — Entra will reject it with AADSTS50011
    // until someone adds it. The page says so when it detects localhost.
    redirectUri: `${window.location.origin}${APP2_PATH}`,
    postLogoutRedirectUri: `${window.location.origin}${APP2_PATH}`,
  },
  cache: {
    // sessionStorage, matching the main app. Two consequences worth knowing,
    // both verified against msal-browser 5.17.1's own cache keys:
    //
    //   ACCOUNTS ARE SHARED  `msal.3.account.keys` carries no client ID, so an
    //                        account cached by the main app is visible here.
    //   TOKENS ARE NOT       `msal.<v>.token.keys.<clientId>` is per client, so
    //                        this app starts with no token no matter how signed
    //                        in the visitor is elsewhere on the origin.
    //
    // That asymmetry is the honest answer to "isn't it just reusing the other
    // app's token?" — it cannot. It has to go and get its own.
    cacheLocation: 'sessionStorage',
  },
  system: {
    loggerOptions: {
      logLevel: LogLevel.Warning,
      piiLoggingEnabled: false,
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) return
        if (level === LogLevel.Error) console.error('[msal:app2]', message)
        else if (level === LogLevel.Warning) console.warn('[msal:app2]', message)
      },
    },
  },
}

/**
 * The cross-app SSO request. The demo is what is NOT in it.
 *
 * No `prompt`. That absence is the entire mechanism: a plain authorization
 * request lets Entra honour the session cookie it already has, which is single
 * sign-on, and it is the OIDC default rather than a feature anyone turns on.
 *
 * And this goes out as a TOP-LEVEL redirect, never a hidden iframe. A capture
 * on 18 July proved iframe silent auth (`prompt=none`) cannot work in a browser
 * with third-party cookie protection: Firefox partitions the ciamlogin.com
 * session cookie away from a third-party frame and Entra answers AADSTS50058,
 * "the cookies used to represent the user's session were not sent in the
 * request" — with a perfectly healthy session seconds either side of it. A
 * top-level navigation is first-party, so the cookie rides along and SSO works.
 */
export const crossAppSsoRequest: RedirectRequest = {
  scopes: ['openid', 'profile', 'email'],
}
