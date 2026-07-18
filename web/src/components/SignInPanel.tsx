import { useState } from 'react'
import { useMsal, useIsAuthenticated } from '@azure/msal-react'
import { InteractionStatus, BrowserAuthError } from '@azure/msal-browser'
import { buildAuthRequest, isInteractionRequired, silentRedirectUri } from '../auth/ssoRequest'
import { clearLastFlow, markFlowStart } from '../lib/lastFlow'

/**
 * Sign-in / sign-out controls, plus the SSO switches.
 *
 * Uses redirect rather than popup: popups get blocked, behave badly on mobile,
 * and a recruiter opening this on a phone is the case that matters most.
 *
 * ── The SSO controls, and why they exist ────────────────────────────────────
 *
 * SSO is not a feature you turn on. A plain authorization request already
 * honours an existing session — that IS single sign-on, and it's the default.
 * So the demo is the reverse: a switch that DEFEATS it (prompt=login), and a
 * silent probe that can only succeed off a session (prompt=none).
 *
 * The sign-out split is what makes any of it observable. `logoutRedirect` ends
 * the session at Entra, so after it there is nothing to single-sign-on WITH —
 * which is exactly why the first "returning user" capture of this site showed a
 * full credential entry and no SSO at all. Signing out of the app only, via
 * clearCache(), drops the local tokens and leaves the Entra session standing, so
 * the next sign-in demonstrates SSO instead of hiding it.
 */
export function SignInPanel() {
  const { instance, inProgress, accounts } = useMsal()
  const isAuthenticated = useIsAuthenticated()
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  /** Steve's checkbox: stop SSO from happening so the two flows can be compared. */
  const [bypassSso, setBypassSso] = useState(false)

  const busy = inProgress !== InteractionStatus.None

  async function signIn() {
    setError(null)
    setNote(null)
    const mode = bypassSso ? 'force-credentials' : 'default'
    // Recorded before we leave the page, so on the way back the timeline can
    // show the flow that actually happened instead of whichever one it was
    // sitting on. This must never be allowed to break sign-in — see markFlowStart.
    markFlowStart(mode)
    try {
      await instance.loginRedirect(buildAuthRequest(mode))
    } catch (e) {
      // user_cancelled isn't an error worth shouting about — they changed
      // their mind, which is allowed.
      if (e instanceof BrowserAuthError && e.errorCode === 'user_cancelled') return
      setError(e instanceof Error ? e.message : 'Sign-in failed.')
    }
  }

  /** prompt=none. Succeeds off an existing session or fails; never shows UI. */
  async function silentSignIn() {
    setError(null)
    setNote(null)
    try {
      // Land the hidden iframe on the empty page, not the app — see
      // silentRedirectUri. This is the fix for the `timed_out` failure.
      await instance.ssoSilent({
        ...buildAuthRequest('silent'),
        redirectUri: silentRedirectUri(),
      })
      setNote('Silent sign-in succeeded — that token came from your existing session, with no prompt.')
    } catch (e) {
      if (isInteractionRequired(e)) {
        // The instructive failure, not a bug: no session to single-sign-on with.
        setNote(
          'Silent sign-in returned login_required — there is no active session to reuse, so SSO had nothing to work with. Sign in once, then try again.',
        )
        return
      }
      setError(e instanceof Error ? e.message : 'Silent sign-in failed.')
    }
  }

  /** Local only. Tokens go, the Entra session stays — so the next sign-in is SSO. */
  async function signOutAppOnly() {
    setError(null)
    setNote(null)
    try {
      await instance.clearCache()
      instance.setActiveAccount(null)
      // The timeline's "you just did this" badge is about a session that no
      // longer exists here. Drop it with the tokens.
      clearLastFlow()
      setNote(
        'Signed out of this app only. Your Entra session is still live, so signing in again should not ask for credentials — that is SSO.',
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-out failed.')
    }
  }

  /** Ends the session at Entra too. After this there is no SSO to demonstrate. */
  async function signOutEverywhere() {
    setError(null)
    setNote(null)
    try {
      clearLastFlow()
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

        {!isAuthenticated && (
          <button
            onClick={signIn}
            disabled={busy}
            className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
          >
            {busy ? 'Working…' : 'Sign in'}
          </button>
        )}
      </div>

      {/* ── The SSO switches ─────────────────────────────────────────────── */}
      <div className="mt-4 border-t border-slate-800 pt-3">
        <p className="font-mono text-xs uppercase tracking-wider text-slate-500">
          Single sign-on
        </p>

        <label className="mt-2 flex cursor-pointer items-start gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={bypassSso}
            onChange={(e) => setBypassSso(e.target.checked)}
            className="mt-0.5 accent-emerald-500"
          />
          <span>
            Bypass SSO on next sign-in
            <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">
              Sends <span className="font-mono text-slate-400">prompt=login</span>, so Entra ignores
              any live session and demands credentials. Leave it off and an existing session is
              reused — that default reuse <em>is</em> SSO.
            </span>
          </span>
        </label>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            onClick={silentSignIn}
            disabled={busy}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-emerald-500/50 hover:text-emerald-300 disabled:opacity-50"
          >
            Try silent sign-in
          </button>

          {isAuthenticated && (
            <>
              <button
                onClick={signOutAppOnly}
                disabled={busy}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-slate-500 disabled:opacity-50"
              >
                Sign out of this app
              </button>
              <button
                onClick={signOutEverywhere}
                disabled={busy}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-slate-500 disabled:opacity-50"
              >
                Sign out everywhere
              </button>
            </>
          )}
        </div>

        <p className="mt-2 text-xs leading-relaxed text-slate-600">
          "This app" drops local tokens and leaves the Entra session alive, so the next sign-in
          demonstrates SSO. "Everywhere" ends the session too — after that there is nothing to
          single-sign-on with.
        </p>
      </div>

      {note && (
        <p className="mt-3 rounded-md border border-emerald-500/25 bg-emerald-500/5 p-2 text-sm leading-relaxed text-emerald-200/80">
          {note}
        </p>
      )}

      {error && (
        <p className="mt-3 rounded-md border border-red-500/30 bg-red-500/5 p-2 text-xs text-red-300">
          {error}
        </p>
      )}

      {!isAuthenticated && (
        <p className="mt-3 text-xs leading-relaxed text-slate-600">
          Accounts created here are demo accounts. Don't reuse a real password — not because this
          site is untrustworthy, but because you shouldn't reuse passwords anywhere, and a site
          about identity shouldn't have to tell you that.
        </p>
      )}
    </div>
  )
}
