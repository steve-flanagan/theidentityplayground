import { useState } from 'react'
import { useMsal, useIsAuthenticated } from '@azure/msal-react'
import { InteractionStatus, BrowserAuthError } from '@azure/msal-browser'
import { buildAuthRequest } from '../auth/ssoRequest'
import { clearLastFlow, markFlowStart } from '../lib/lastFlow'

type Props = {
  /**
   * Raised after a local sign-out so the page can move the timeline onto the
   * sign-out flow.
   *
   * Optional because the panel signs out perfectly well on its own — the
   * timeline is a listener, not a dependency, and the tests mount this
   * standalone.
   */
  onLocalSignOut?: () => void
  /**
   * Module 2's member simulation. A visitor can never really be a workforce
   * member, so these drive a client-side sample: onSimulateMember turns it on,
   * simActive reports it is on, onExitSim turns it back off. App owns the state
   * and swaps the inspector, the timeline and the account-types map with it.
   */
  onSimulateMember?: () => void
  simActive?: boolean
  onExitSim?: () => void
  /**
   * Guest mode: a live /guest sign-in handed a token back to the main page. When
   * active the panel collapses to a guest indicator and an exit — the customer
   * sign-in, the member sample and the SSO controls have nothing to say about a
   * guest, which is on the inspector and Module 2 instead.
   */
  guestActive?: boolean
  onExitGuest?: () => void
}

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
 * So the demo is the reverse: a switch that DEFEATS it (prompt=login).
 *
 * There was a third control here, "Try silent sign-in", calling ssoSilent().
 * It is gone. Its hidden-iframe leg cannot receive the ciamlogin.com session
 * cookie in any browser with third-party cookie protection on, which is a
 * capture this repo already holds (notes/findings.md, 18 July): the same user,
 * the same live session, seconds apart, top-level returns a code and the iframe
 * returns login_required. So the button failed every time it was pressed, and a
 * control that always fails teaches nothing that the recorded flow does not
 * teach better. The finding kept its place on the timeline; the button did not.
 *
 * The sign-out split is what makes any of it observable. `logoutRedirect` ends
 * the session at Entra, so after it there is nothing to single-sign-on WITH —
 * which is exactly why the first "returning user" capture of this site showed a
 * full credential entry and no SSO at all. Signing out of the app only, via
 * clearCache(), drops the local tokens and leaves the Entra session standing, so
 * the next sign-in demonstrates SSO instead of hiding it.
 */
export function SignInPanel({
  onLocalSignOut,
  onSimulateMember,
  simActive = false,
  onExitSim,
  guestActive = false,
  onExitGuest,
}: Props) {
  const { instance, inProgress, accounts } = useMsal()
  const isAuthenticated = useIsAuthenticated()
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  /** Steve's checkbox: stop SSO from happening so the two flows can be compared. */
  const [bypassSso, setBypassSso] = useState(false)

  const busy = inProgress !== InteractionStatus.None

  /**
   * Is Entra's authorization response sitting in the fragment right now?
   *
   * MSAL returns the code and the error in the fragment and redeems the code
   * against state and a PKCE verifier held in the same cache the recovery below
   * wipes. Wiping it while a response is there IS the failure being fixed, so
   * this is the one condition that stands the recovery down.
   *
   * Reads the fragment. Writes nothing to it, ever: it belongs to MSAL, and
   * JourneyTimeline.test.tsx holds that line.
   */
  function authResponseInFragment(): boolean {
    return /(?:^|[#&?])(?:code|error)=/.test(location.hash)
  }

  /**
   * Drop the browser state that just failed a sign-in.
   *
   * ── Why ─────────────────────────────────────────────────────────────────────
   *
   * Measured on the live site: /authorize came back 302 with a code, and no
   * /token request followed. Nothing. The page sat blank and clearing all site
   * data by hand was the only way out, so the state that broke it was in the
   * browser. Cached state that cannot complete a sign-in is worth less than no
   * cached state at all.
   *
   * It is on a schedule, not an accident. Demo accounts are deleted 24 hours
   * after they are created, so a returning visitor's browser holds an MSAL
   * account for a user the directory no longer has.
   *
   * ── What it is allowed to touch, and when ───────────────────────────────────
   *
   * Only from the catch below, on an attempt that actually failed. Never on
   * load, never on mount, never speculatively: clearing on load signs out
   * visitors whose sessions were working. The button that reaches this only
   * renders when nobody is signed in, so there is no live session here to lose.
   *
   * @returns whether the state was really dropped, so the message can say so
   *          only when it happened
   */
  async function clearStateThatFailedSignIn(): Promise<boolean> {
    if (authResponseInFragment()) return false
    try {
      // The same call the local sign-out makes. With no argument MSAL takes the
      // branch that clears every account and token rather than one named account
      // (msal-browser 5.17.1, clearCacheOnLogout in BaseInteractionClient), and
      // the temporary cache goes with it, so a stranded interaction lock does too.
      await instance.clearCache()
      instance.setActiveAccount(null)
      // The start stamp written moments ago for a redirect that never left. No
      // navigation is coming back to read it, and left in place the next plain
      // page load would turn the idle minutes since the failed click into a
      // measured round trip. Same reasoning as signOutAppOnly below.
      clearLastFlow()
      return true
    } catch {
      // A recovery that fails must not replace the sign-in error with its own.
      return false
    }
  }

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
      // their mind, which is allowed. Nothing is broken, so nothing is cleared.
      if (e instanceof BrowserAuthError && e.errorCode === 'user_cancelled') return
      const cleared = await clearStateThatFailedSignIn()
      const detail = e instanceof Error ? e.message : 'Sign-in failed.'
      // MSAL's own message stays first: it is the useful half to anyone reading
      // this, and the sentence after it is the part a visitor needs.
      setError(cleared ? `${detail} Stored sign-in state was cleared, so try again.` : detail)
    }
  }

  /** Local only. Tokens go, the Entra session stays — so the next sign-in is SSO. */
  async function signOutAppOnly() {
    setError(null)
    setNote(null)
    try {
      await instance.clearCache()
      instance.setActiveAccount(null)
      // The old badge is about a session that no longer exists here, so it goes
      // with the tokens.
      clearLastFlow()
      // And markFlowStart is deliberately NOT called here, unlike the global
      // button below. It stamps a start time for a REDIRECT to come back and
      // finish; this path never leaves the page, so nothing would ever read the
      // stamp. It would sit in storage until some unrelated later load turned
      // the idle minutes since the click into "it took 41.7s" — an invented
      // measurement, which is the one thing this site cannot do.
      //
      // Nothing navigated, so the timeline is still mounted and can simply be
      // told which flow to show. No round trip, no number, nothing said about
      // timing.
      onLocalSignOut?.()
      setNote(
        'Signed out of this app only. Your Entra session is still live, so signing in again should not ask for credentials. That is SSO.',
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
      // Both writes have to happen BEFORE logoutRedirect, which unloads the
      // page. They ride through sessionStorage and are read when Entra sends
      // the browser back, same as the sign-in marker.
      clearLastFlow()
      markFlowStart('sign-out')
      await instance.logoutRedirect({ account: instance.getActiveAccount() ?? undefined })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-out failed.')
    }
  }

  // Guest mode collapses the panel. A live guest sign-in is already on the main
  // page's inspector and Module 2, and the customer sign-in, member sample and
  // SSO controls below have nothing to say about it — so show who you are and a
  // way out. Every hook above has already run, so this early return is safe.
  if (guestActive) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-200">Signed in as a guest</p>
            <p className="text-xs text-slate-500">
              A live B2B guest. Your real token is in the inspector and Module 2 below.
            </p>
          </div>
          <button
            onClick={onExitGuest}
            className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-slate-500"
          >
            Exit guest
          </button>
        </div>
      </div>
    )
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

      {/* ── Sign in as Guest (Module 2, live) ──────────────────────────────
          A real self-service B2B guest sign-up. It authenticates as the
          WORKFORCE app, a different client ID, so it cannot run on this page: an
          href navigation to /guest boots that instance on its own page (the same
          reason /app2 is a link, not a button). Live, so it is grouped with the
          real customer sign-in above, not the sample below. */}
      {!isAuthenticated && (
        <div className="mt-3">
          <a
            href="/guest"
            className="inline-block rounded-lg border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-500"
          >
            Sign in as Guest (live)
          </a>
          <p className="mt-2 text-xs leading-relaxed text-slate-600">
            Creates a real B2B guest on its own page, then shows your token. It
            self-destructs on the cleanup.
          </p>
        </div>
      )}

      {/* ── Sample identities (Module 2) ───────────────────────────────────
          A visitor can never really be a workforce member, so this is a
          client-side sample: App swaps the inspector, the timeline and the
          account-types map onto the member's captured token and flows, all
          clearly labelled sample. Guest joins this when its live flow lands.

          Hidden once you are really signed in. Overlaying a sample on a live
          session put the panel in two states at once — "signed in as X" up top,
          a member sample below — which read as broken. A real account takes the
          panel; the sample is only offered signed-out. */}
      {!isAuthenticated && (
        <div className="mt-4 border-t border-slate-800 pt-3">
          <p className="font-mono text-xs uppercase tracking-wider text-slate-500">
            Sample identities
          </p>
          {simActive ? (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-slate-300">
                Viewing a sample: <span className="text-emerald-300">workforce member</span>
              </p>
              <button
                onClick={onExitSim}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-slate-500"
              >
                Exit sample
              </button>
            </div>
          ) : (
            <>
              <button
                onClick={onSimulateMember}
                className="mt-2 rounded-lg border border-slate-700 px-3 py-2 text-sm font-medium text-slate-200 transition hover:border-slate-500"
              >
                Sign in as Member (sample data)
              </button>
              <p className="mt-2 text-xs leading-relaxed text-slate-600">
                No account needed. Loads a real member's captured token and sign-in, to compare against the customer above.
              </p>
            </>
          )}
        </div>
      )}

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
              reused. That default reuse <em>is</em> SSO.
            </span>
          </span>
        </label>

        {/* The whole row is behind the auth check now. It used to hold a third
            button that rendered signed out as well, so the container was always
            there; on its own it would leave 12px of nothing above the caption. */}
        {isAuthenticated && (
          <div className="mt-3 flex flex-wrap gap-2">
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
          </div>
        )}

        <p className="mt-2 text-xs leading-relaxed text-slate-600">
          "This app" drops local tokens and leaves the Entra session alive, so the next sign-in
          demonstrates SSO. "Everywhere" ends the session too. After that there is nothing to
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
          Accounts created here are demo accounts. Don't reuse a real password.
        </p>
      )}
    </div>
  )
}
