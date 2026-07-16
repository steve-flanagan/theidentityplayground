import { useState } from 'react'
import { useMsal, useIsAuthenticated } from '@azure/msal-react'
import { InteractionStatus, BrowserAuthError } from '@azure/msal-browser'
import { loginRequest } from '../auth/msalConfig'

/**
 * Sign-in / sign-out controls.
 *
 * Uses redirect rather than popup: popups get blocked, behave badly on mobile,
 * and a recruiter opening this on a phone is the case that matters most.
 */
export function SignInPanel() {
  const { instance, inProgress, accounts } = useMsal()
  const isAuthenticated = useIsAuthenticated()
  const [error, setError] = useState<string | null>(null)

  const busy = inProgress !== InteractionStatus.None

  async function signIn() {
    setError(null)
    try {
      await instance.loginRedirect(loginRequest)
    } catch (e) {
      // user_cancelled isn't an error worth shouting about — they changed
      // their mind, which is allowed.
      if (e instanceof BrowserAuthError && e.errorCode === 'user_cancelled') return
      setError(e instanceof Error ? e.message : 'Sign-in failed.')
    }
  }

  async function signOut() {
    setError(null)
    try {
      // Ends the session at the IdP too, not just locally. A local-only
      // sign-out leaves the visitor still signed in at Entra, so the next
      // "sign in" silently reuses the session and looks broken.
      await instance.logoutRedirect({ account: instance.getActiveAccount() ?? undefined })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-out failed.')
    }
  }

  const account = accounts[0]

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          {isAuthenticated && account ? (
            <>
              <p className="text-sm font-medium text-slate-200">
                Signed in as {account.name ?? account.username}
              </p>
              <p className="truncate font-mono text-xs text-slate-500">{account.username}</p>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-slate-200">Not signed in</p>
              <p className="text-xs text-slate-500">
                Sign up or sign in to inspect your own real token.
              </p>
            </>
          )}
        </div>

        <button
          onClick={isAuthenticated ? signOut : signIn}
          disabled={busy}
          className={`rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${
            isAuthenticated
              ? 'border border-slate-700 text-slate-300 hover:bg-slate-800'
              : 'bg-emerald-500 text-slate-950 hover:bg-emerald-400'
          }`}
        >
          {busy ? 'Working…' : isAuthenticated ? 'Sign out' : 'Sign in'}
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-md border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-300">
          {error}
        </p>
      )}

      {!isAuthenticated && (
        <p className="mt-3 text-xs leading-relaxed text-slate-600">
          Accounts created here are demo accounts and self-destruct. Don't reuse a real password —
          not because this site is untrustworthy, but because you shouldn't reuse passwords anywhere,
          and a site about identity shouldn't have to tell you that.
        </p>
      )}
    </div>
  )
}
