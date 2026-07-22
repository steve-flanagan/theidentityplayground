import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PublicClientApplication } from '@azure/msal-browser'
import { guestMsalConfig } from '../auth/guestMsalConfig'
import { clearForeignInteractionLock } from '../auth/interactionLock'
import { Guest } from './Guest'
import { storeGuestToken } from './handback'

/**
 * Boot the guest sign-up page.
 *
 * ── Why a separate boot, and not a route inside the main app ─────────────────
 *
 * The same reason /app2 is (see app2/mountApp2.tsx): it authenticates as a
 * THIRD client ID — the workforce app registration — against its own redirect
 * URI, and an MSAL instance is welded to one of each at construction. Two live
 * instances on one page would both watch the same URL fragment for a response
 * that belongs to only one of them. So the route in main.tsx decides which
 * single instance exists, and /guest is reached by a real navigation.
 *
 * ── The order below is load-bearing ─────────────────────────────────────────
 *
 * initialize → handleRedirectPromise → render, exactly as mountApp2. The
 * redirect response is consumed BEFORE React mounts, so no component effect can
 * race MSAL for the fragment — the structural fix for the outage that once broke
 * every sign-in on this site.
 */
export async function mountGuest(rootElement: HTMLElement): Promise<void> {
  // Symmetric with main.tsx and mountApp2: the interaction lock is one key for
  // the whole origin, so any other page can strand this one. Clears a DIFFERENT
  // client ID only, and before initialize(), since afterwards is too late.
  clearForeignInteractionLock(guestMsalConfig.auth.clientId)

  const instance = new PublicClientApplication(guestMsalConfig)
  await instance.initialize()

  let redirectError: string | null = null

  try {
    // The result when we have just come back from Entra, or null on a fresh
    // visit. On a refresh with a token already cached, adopt that instead.
    const result = await instance.handleRedirectPromise()
    const account = result?.account ?? instance.getAllAccounts()[0] ?? null
    const idToken = result?.idToken ?? account?.idToken ?? null

    if (idToken) {
      // Hand the real guest token to the main page, then leave. clearCache drops
      // THIS guest account from MSAL's per-origin account list before we go, so
      // the main page's CIAM instance does not see a stray "signed in" account it
      // holds no token for. Scoped to the one account, so a CIAM session (if any)
      // survives. The token string is already saved in our own key, so clearing
      // MSAL's cache cannot take it along.
      storeGuestToken(idToken)
      try {
        await instance.clearCache(account ? { account } : undefined)
      } catch {
        // Best-effort cleanup; the hand-off token is what matters and it is saved.
      }
      window.location.assign('/')
      return
    }
  } catch (e) {
    // Entra's own errors arrive here. AADSTS50011 (redirect URI not registered)
    // is the one to expect until /guest is added to the workforce app reg. Show
    // the code verbatim — it is more useful than a friendly rewrite.
    redirectError =
      e instanceof Error ? e.message : 'The authorization response could not be read.'
  }

  // No token: a fresh visit or an error. Show the interstitial.
  createRoot(rootElement).render(
    <StrictMode>
      <Guest instance={instance} redirectError={redirectError} />
    </StrictMode>,
  )
}
