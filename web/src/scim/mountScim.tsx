import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ScimDemo } from './ScimDemo'

/**
 * Mounts the SCIM page.
 *
 * Deliberately the shortest mount in this codebase. mountApp2 and mountGuest each
 * construct an MSAL instance, initialise it, adopt an existing account, register
 * an event callback and consume a redirect response before rendering — all of
 * which exists because those pages authenticate somebody as a specific client id.
 *
 * This page authenticates nobody. The directory work happens in the backend under
 * its own managed identity, so there is no client id, no redirect URI, no
 * interaction lock and no redirect to consume. Rendering is the whole job.
 */
export function mountScim(rootElement: HTMLElement): void {
  createRoot(rootElement).render(
    <StrictMode>
      <ScimDemo />
    </StrictMode>,
  )
}
