import { useState } from 'react'
import type { IPublicClientApplication } from '@azure/msal-browser'
import { guestSignUpRequest } from '../auth/guestMsalConfig'

/**
 * The guest sign-up interstitial. Its own page, its own workforce MSAL instance
 * (the /app2 pattern), reached by the "Sign in as Guest (live)" link.
 *
 * Nothing here is baked, which is the whole difference from the member sample. A
 * visitor genuinely creates a self-service B2B guest in the workforce tenant via
 * Google. The copy says up front that this makes a real directory object and
 * that it self-destructs on the cleanup, because it does.
 *
 * This page only STARTS the sign-in and reports errors. On the way back from
 * Entra, mountGuest never renders it: it stores the real token and bounces to
 * the main page, where the inspector and Module 2 show the guest. See
 * guest/handback.ts and the guest-mode branch in App.tsx.
 */
export function Guest({
  instance,
  redirectError,
}: {
  instance: IPublicClientApplication
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
        {/* "validate" became "decode" on Steve's call. The inspector already
            says "Decoded, not verified" and credits MSAL with the validation, so
            the two pages were telling opposite stories about the same token. */}
        <p className="mt-6 text-lg leading-relaxed text-slate-400">
          Live data, not a sample. You become a real B2B guest in the workforce tenant. Pick a
          Microsoft or Google account, and we pass the sign-in request to them and decode the login
          token on return. Your token comes back to the inspector and the account self-destructs on
          a cleanup job.
        </p>
        <p className="mt-4 text-sm leading-relaxed text-slate-500">
          The screen also offers email and GitHub by default. Email is home-realm discovery, not a
          sign-up: it looks the address up against Entra tenants and rejects anything it does not
          find, so a personal address comes back as an error. This can cause a lot of confusion for
          business consultants. GitHub is not federated here and does nothing. It was left in to
          show the defaults.
        </p>

        <div className="mt-8">
          <button
            onClick={signUp}
            className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-400"
          >
            Continue
          </button>
          {onLocalhost && (
            <p className="mt-3 max-w-xl text-xs leading-relaxed text-amber-200/70">
              On localhost the redirect URI is{' '}
              <span className="font-mono">http://localhost:5173/guest</span>, which has to be
              registered as a SPA redirect on the workforce app reg or Entra returns AADSTS50011.
            </p>
          )}
        </div>

        {error && (
          <p className="mt-6 rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm leading-relaxed text-red-300">
            {error}
          </p>
        )}

        <p className="mt-10 text-sm text-slate-500">
          <a
            href="/"
            className="font-mono text-slate-300 underline decoration-slate-700 underline-offset-4 transition hover:text-emerald-300"
          >
            ← back to the inspector
          </a>
        </p>
      </div>
    </main>
  )
}
