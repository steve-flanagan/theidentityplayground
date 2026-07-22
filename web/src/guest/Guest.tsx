import { useState } from 'react'
import type { IPublicClientApplication } from '@azure/msal-browser'
import { TokenInspector } from '../components/TokenInspector'
import { guestSignUpRequest } from '../auth/guestMsalConfig'

/**
 * The guest sign-up page. /app2-style: its own page, its own workforce MSAL
 * instance, and it shows the REAL guest token it gets back.
 *
 * Nothing here is baked, which is the whole difference from the member sample. A
 * visitor genuinely creates a self-service B2B guest in the workforce tenant via
 * Google, and the token below is theirs. The copy says up front that this makes a
 * real directory object and that it self-destructs on the cleanup, because it
 * does.
 *
 * v1 shows the token here, proving the self-signup end to end (the same shape
 * /app2 shipped in). Folding the result back into the main page's Module 2 — the
 * customer / member / guest diff and the blast-radius map — is the next step, and
 * it waits on this sign-in being verified in a real browser.
 */
export function Guest({
  instance,
  idToken,
  redirectError,
}: {
  instance: IPublicClientApplication
  idToken: string | null
  redirectError: string | null
}) {
  const [error, setError] = useState<string | null>(redirectError)

  async function signUp() {
    setError(null)
    try {
      // A top-level redirect, not a popup: popups get blocked and behave badly on
      // mobile, and this is the same reliable path the main app and /app2 use.
      await instance.loginRedirect(guestSignUpRequest)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed.')
    }
  }

  const onLocalhost = window.location.hostname === 'localhost'

  return (
    <main className="min-h-screen bg-slate-950 text-slate-300">
      <div className="mx-auto max-w-3xl px-8 pt-16 pb-20">
        <p className="font-mono text-xs uppercase tracking-widest text-emerald-400">
          Module 2 · B2B guest
        </p>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
          Sign in as a guest
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-slate-400">
          This one is live, not a sample. You sign in with Google and become a real B2B guest in the
          workforce tenant, and the token below is your own. The account self-destructs on the
          cleanup job, the same as every demo account here.
        </p>

        {!idToken && (
          <div className="mt-8">
            <button
              onClick={signUp}
              className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-400"
            >
              Continue with Google
            </button>
            {onLocalhost && (
              <p className="mt-3 max-w-xl text-xs leading-relaxed text-amber-200/70">
                On localhost the redirect URI is <span className="font-mono">http://localhost:5173/guest</span>,
                which has to be registered as a SPA redirect on the workforce app reg or Entra
                returns AADSTS50011.
              </p>
            )}
          </div>
        )}

        {error && (
          <p className="mt-6 rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm leading-relaxed text-red-300">
            {error}
          </p>
        )}

        {idToken && (
          <div className="mt-10">
            <h2 className="mb-4 text-sm font-medium uppercase tracking-widest text-slate-500">
              Your guest token
            </h2>
            <TokenInspector token={idToken} label="Your guest ID token" live />
            <p className="mt-6 text-sm text-slate-500">
              <a
                href="/"
                className="font-mono text-slate-300 underline decoration-slate-700 underline-offset-4 transition hover:text-emerald-300"
              >
                ← back to the inspector
              </a>
            </p>
          </div>
        )}
      </div>
    </main>
  )
}
