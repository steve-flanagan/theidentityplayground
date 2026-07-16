import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PublicClientApplication, EventType, type AuthenticationResult } from '@azure/msal-browser'
import { MsalProvider } from '@azure/msal-react'
import './index.css'
import App from './App.tsx'
import { msalConfig } from './auth/msalConfig.ts'

// getElementById returns HTMLElement | null, and createRoot won't accept null.
// Vite's template silences this with a `!` non-null assertion; an explicit
// check costs one line and fails with a message that says what's wrong instead
// of a null dereference somewhere inside React.
const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Cannot mount: #root is missing from index.html')
}

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

createRoot(rootElement).render(
  <StrictMode>
    <MsalProvider instance={msalInstance}>
      <App />
    </MsalProvider>
  </StrictMode>,
)
