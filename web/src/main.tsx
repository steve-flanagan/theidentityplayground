import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PublicClientApplication, EventType, type AuthenticationResult } from '@azure/msal-browser'
import { MsalProvider } from '@azure/msal-react'
import './index.css'
import App from './App.tsx'
import { msalConfig } from './auth/msalConfig.ts'
import { clearForeignInteractionLock } from './auth/interactionLock.ts'
import { completeRedirect } from './auth/redirectBoot.ts'
import { isApp2Path } from './app2/route.ts'

// getElementById returns HTMLElement | null, and createRoot won't accept null.
// Vite's template silences this with a `!` non-null assertion; an explicit
// check costs one line and fails with a message that says what's wrong instead
// of a null dereference somewhere inside React.
const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Cannot mount: #root is missing from index.html')
}

// ─────────────────────────────────────────────────────────────────────────────
// ROUTING — one page each, and only one MSAL instance ever exists.
//
// There is no router library here; there are two pages, and adding a routing
// dependency to choose between them would be more moving parts than the choice
// deserves. What matters is the else: /app2 authenticates as a DIFFERENT client
// ID, and an MSAL instance is welded to one client ID and one redirect URI when
// it is constructed. If both instances existed at once they would both be
// watching the same URL fragment for an authorization response that belongs to
// exactly one of them.
//
// So the branch decides which single application boots. The main app's path
// below is untouched by this — everything from `new PublicClientApplication`
// onwards is the code that has been signing people in all along.
//
// The import is dynamic so that visitors to the main site never download the
// second app: Vite splits it into its own chunk, fetched only on /app2.
// ─────────────────────────────────────────────────────────────────────────────
if (isApp2Path(window.location.pathname)) {
  const { mountApp2 } = await import('./app2/mountApp2.tsx')
  await mountApp2(rootElement)
} else {
  // MSAL keys its interaction lock per ORIGIN, not per client, so an abandoned
  // /app2 redirect leaves a lock that blocks sign-in and sign-out here. Because
  // exactly one instance boots per page load, this app booting proves app2's
  // instance is gone and its lock is stale. Only ever clears a DIFFERENT client
  // ID, and must run before initialize(). Full argument in auth/interactionLock.ts.
  clearForeignInteractionLock(msalConfig.auth.clientId)

  const msalInstance = new PublicClientApplication(msalConfig)

  // MSAL v3+ requires initialize() before any other call, and it's async because
  // it may need to talk to the network. Rendering before it resolves produces
  // "uninitialized_public_client_application" errors that look like a config
  // problem but are really a race.
  await msalInstance.initialize()

  // If a session already exists (e.g. a page refresh), adopt it rather than
  // making the user sign in again.
  const accounts = msalInstance.getAllAccounts()
  if (accounts.length > 0) {
    msalInstance.setActiveAccount(accounts[0])
  }

  // After an interactive sign-in, MSAL raises LOGIN_SUCCESS but does NOT set the
  // active account for you. Without this the user is signed in yet every
  // getActiveAccount() returns null — a confusing half-authenticated state.
  msalInstance.addEventCallback((event) => {
    if (event.eventType === EventType.LOGIN_SUCCESS && event.payload) {
      const payload = event.payload as AuthenticationResult
      msalInstance.setActiveAccount(payload.account)
    }
  })

  // Consume the authorization response BEFORE React mounts, which is the order
  // app2/mountApp2.tsx has always used. Relying on MsalProvider to call
  // handleRedirectPromise from an effect leaves a returning visitor with no
  // recovery when it declines to redeem the code: no component is mounted yet,
  // so there is no button to press and nothing to press it. Full argument, and
  // the msal-browser source it rests on, in auth/redirectBoot.ts.
  //
  // Registered AFTER the event callback above on purpose. LOGIN_SUCCESS fires
  // during this call, so the handler has to already be listening for the
  // success path to behave exactly as it did before.
  //
  // This is the last thing before mount, and it must not become a way to fail
  // to mount. completeRedirect handles its own failures and does not throw;
  // this try/catch is the outer guarantee that nothing it grows later can
  // either.
  try {
    await completeRedirect(msalInstance)
  } catch {
    // Deliberately empty. The app renders regardless.
  }

  createRoot(rootElement).render(
    <StrictMode>
      <MsalProvider instance={msalInstance}>
        <App />
      </MsalProvider>
    </StrictMode>,
  )
}
