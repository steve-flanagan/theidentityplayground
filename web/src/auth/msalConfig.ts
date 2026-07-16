import { LogLevel, type Configuration, type PopupRequest } from '@azure/msal-browser'

// Tenant + app identifiers.
//
// These are hardcoded on purpose, and it's worth being explicit about why:
// NEITHER OF THESE IS A SECRET. The client ID travels in every authorize
// request, sits in the `aud` claim of every token this app receives, and is
// visible in the browser's network tab to anyone who presses F12. Tenant IDs
// are equally public — they're in the OIDC discovery document, which is
// unauthenticated by design.
//
// Putting them in an environment variable would imply they need protecting and
// buy nothing. What must never appear here is a client SECRET — and it can't,
// because this is a public client using PKCE, which is exactly why the app
// registration uses the SPA platform rather than Web.
const TENANT_ID = '7e8da8a9-67bc-4d53-bfc7-fe3e13128382'
const CLIENT_ID = 'e891bf4d-ab35-4686-81b9-a973001b378f'

// External ID (CIAM) tenants authenticate at ciamlogin.com, not
// login.microsoftonline.com. Verified against this tenant's live OIDC
// discovery document rather than copied from a blog post.
const AUTHORITY = `https://theidentityplayground.ciamlogin.com/${TENANT_ID}`

export const msalConfig: Configuration = {
  auth: {
    clientId: CLIENT_ID,
    authority: AUTHORITY,
    // MSAL refuses authorities it doesn't recognise, as an anti-phishing
    // measure — it won't send your credentials to an arbitrary host just
    // because config said so. ciamlogin.com isn't on its built-in trust list,
    // so it must be declared. Omit this and every sign-in fails with an
    // "untrusted authority" error that reads like a config typo.
    knownAuthorities: ['theidentityplayground.ciamlogin.com'],
    // Relative, so the same registration works from localhost, the apex, and
    // www without three separate builds. MSAL resolves it against the current
    // origin — which must still match a registered redirect URI.
    redirectUri: '/',
    postLogoutRedirectUri: '/',
    // Note: `navigateToLoginRequestUrl` and `storeAuthStateInCookie` existed in
    // MSAL v2/v3 and are gone in v5 — the latter was IE11 scaffolding. Passing
    // them here is a type error, which is the whole argument for TypeScript:
    // in plain JS they'd be accepted, silently ignored, and I'd have believed
    // config was in effect that wasn't.
  },
  cache: {
    // sessionStorage, not localStorage: tokens die when the tab closes.
    // This is a public demo where visitors sign in on machines they may not
    // own. Persisting tokens across sessions would be convenient and wrong.
    cacheLocation: 'sessionStorage',
  },
  system: {
    loggerOptions: {
      logLevel: LogLevel.Warning,
      piiLoggingEnabled: false, // never log PII — this is a public site
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) return
        if (level === LogLevel.Error) console.error('[msal]', message)
        else if (level === LogLevel.Warning) console.warn('[msal]', message)
      },
    },
  },
}

// Only the scopes needed to identify the user. Every additional scope is
// consent the visitor has to grant and surface an attacker could inherit —
// Module 1 needs an ID token and nothing more.
export const loginRequest: PopupRequest = {
  scopes: ['openid', 'profile', 'email'],
}
