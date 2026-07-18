import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PublicClientApplication } from '@azure/msal-browser'
import { app2MsalConfig } from '../auth/app2MsalConfig'
import { clearForeignInteractionLock } from '../auth/interactionLock'
import { App2 } from './App2'
import { completeApp2Timing, readApp2Elapsed } from './crossAppSso'

/**
 * Boot the second application.
 *
 * ── Why this is a separate boot, and not a route inside the main app ────────
 *
 * Because it is a separate APPLICATION. It authenticates as a different client
 * ID against a different redirect URI, and an MSAL instance is bound to exactly
 * one of each at construction. Two instances alive at once on the same page
 * would both be watching the same URL fragment for a response that belongs to
 * one of them, and only one of them can be right. So the route decides which
 * single instance exists, and /app2 is reached by a real navigation.
 *
 * Their caches do not collide. Verified against msal-browser 5.17.1's own key
 * generation rather than assumed:
 *
 *   msal.<v>.token.keys.<clientId>        per client — separate tokens
 *   msal.<clientId>.active-account-filters per client — separate active account
 *   msal.<v>.account.keys                  SHARED    — accounts are per origin
 *
 * The shared one is deliberate on MSAL's part and is why this page can tell the
 * visitor an account already exists in the browser without having a token for
 * it. The page is careful to describe it as exactly that.
 *
 * ── The order below is load-bearing ─────────────────────────────────────────
 *
 * initialize → handleRedirectPromise → render. The redirect response is
 * consumed BEFORE React mounts anything, so no component effect can race MSAL
 * for the fragment. That race — a child effect running before MsalProvider's —
 * is what silently broke every sign-in on this site once, and the fix is
 * structural: by the time a component exists, the fragment is already spent.
 */
export async function mountApp2(rootElement: HTMLElement): Promise<void> {
  // Symmetric with main.tsx. The interaction lock is one key for the whole
  // origin, so the main app can strand this page exactly as easily as the
  // reverse. Clears a DIFFERENT client ID only, and before initialize(), since
  // afterwards is too late. See auth/interactionLock.ts.
  clearForeignInteractionLock(app2MsalConfig.auth.clientId)

  const instance = new PublicClientApplication(app2MsalConfig)
  await instance.initialize()

  let idToken: string | null = null
  let elapsedMs: number | null = null
  let redirectError: string | null = null

  try {
    // Returns the result when we have just come back from Entra, or null on an
    // ordinary page load. Rejects when Entra sent an error back instead.
    const result = await instance.handleRedirectPromise()

    if (result) {
      instance.setActiveAccount(result.account)
      idToken = result.idToken
      // Only close the measurement when a redirect actually completed —
      // otherwise a refresh would silently re-time a trip that never happened.
      elapsedMs = completeApp2Timing()
    } else {
      // An ordinary load or a refresh. Read what this client already holds.
      // MSAL looks the token up in a cache keyed by OUR client ID, and App2
      // checks the `aud` claim on top of that before saying a word about it —
      // showing the main app's token here would be the one unforgivable bug on
      // a page whose entire claim is "a different app got this".
      const cached = instance.getAllAccounts()[0]?.idToken
      idToken = cached ? cached : null
      elapsedMs = idToken ? readApp2Elapsed() : null
    }
  } catch (e) {
    // Entra's own errors arrive here — AADSTS50011 for an unregistered redirect
    // URI is the likely one outside production. Show it verbatim; the error
    // code is more useful to anyone reading this page than a friendly rewrite.
    redirectError = e instanceof Error ? e.message : 'The authorization response could not be read.'
  }

  // Whatever account the origin already knows about, for the "no token yet"
  // state. Deliberately not used as evidence of anything — see App2.
  const sharedAccount = instance.getAllAccounts()[0]
  const sharedAccountName = sharedAccount?.username ?? sharedAccount?.name ?? null

  createRoot(rootElement).render(
    <StrictMode>
      <App2
        instance={instance}
        idToken={idToken}
        elapsedMs={elapsedMs}
        redirectError={redirectError}
        sharedAccountName={sharedAccountName}
      />
    </StrictMode>,
  )
}
