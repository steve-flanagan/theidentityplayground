import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PublicClientApplication } from '@azure/msal-browser'
import { guestMsalConfig } from '../auth/guestMsalConfig'
import { clearForeignInteractionLock } from '../auth/interactionLock'
import { Guest } from './Guest'

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

  let idToken: string | null = null
  let redirectError: string | null = null

  try {
    // The result when we have just come back from Entra, or null on an ordinary
    // load. Rejects when Entra sent an error back instead.
    const result = await instance.handleRedirectPromise()
    if (result) {
      instance.setActiveAccount(result.account)
      idToken = result.idToken
    } else {
      // A refresh or a plain visit: adopt whatever this client already holds.
      // The token cache is keyed by OUR client ID, so this is a guest token or
      // nothing — never the customer's or the member app's from elsewhere on the
      // origin.
      const cached = instance.getAllAccounts()[0]
      if (cached) {
        instance.setActiveAccount(cached)
        idToken = cached.idToken ?? null
      }
    }
  } catch (e) {
    // Entra's own errors arrive here. AADSTS50011 (redirect URI not registered)
    // is the one to expect until /guest is added to the workforce app reg. Show
    // the code verbatim — it is more useful than a friendly rewrite.
    redirectError =
      e instanceof Error ? e.message : 'The authorization response could not be read.'
  }

  createRoot(rootElement).render(
    <StrictMode>
      <Guest instance={instance} idToken={idToken} redirectError={redirectError} />
    </StrictMode>,
  )
}
