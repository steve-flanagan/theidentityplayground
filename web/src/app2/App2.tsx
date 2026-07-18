import { useState } from 'react'
import type { IPublicClientApplication } from '@azure/msal-browser'
import {
  APP2_CLIENT_ID,
  MAIN_CLIENT_ID_FOR_DISPLAY,
  crossAppSsoRequest,
} from '../auth/app2MsalConfig'
import { classifyAcquisition, markApp2Start } from './crossAppSso'
import { decodeJwt, formatClaimValue, formatTimeClaim } from '../lib/jwt'

/**
 * Module 2's first half: the same person, two applications, one session.
 *
 * Everything this page has to say fits in one sentence — *a different app
 * registration got a token and nobody typed anything* — so the page is built
 * around making that one sentence checkable rather than around saying it
 * loudly. The client IDs are on screen because they are the proof the apps are
 * different; the round-trip time is on screen because it is the proof no human
 * was involved.
 *
 * ── What this component does NOT do ─────────────────────────────────────────
 *
 * No effect on mount touches `location`, and nothing here reads or writes the
 * URL fragment. Entra returns the authorization code in the fragment and MSAL
 * is the only thing entitled to read it — an earlier component wrote the
 * fragment from a mount effect and silently broke every sign-in in production.
 * The redirect response is consumed in mountApp2 BEFORE React renders, and this
 * component receives the outcome as plain props.
 */

type Props = {
  instance: IPublicClientApplication
  /** The ID token this app holds, resolved before render. Never the main app's. */
  idToken: string | null
  /** Measured round trip for that token, in ms. Null when it could not be measured. */
  elapsedMs: number | null
  /** An error Entra returned on the way back, if any. */
  redirectError: string | null
  /**
   * An account already sitting in this origin's shared MSAL cache — almost
   * certainly put there by the main app. Not a session, and not a token.
   */
  sharedAccountName: string | null
}

/** Claims worth showing here. The full annotated read is the main app's job. */
const CLAIMS_ON_SHOW = ['aud', 'iss', 'oid', 'sub', 'preferred_username', 'name', 'iat', 'exp']

function formatElapsed(ms: number): string {
  return ms < 10_000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}

/** A client ID, monospaced, with the middle intact — these get compared by eye. */
function ClientIdRow({ label, id, note, mine }: { label: string; id: string; note: string; mine?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2">
      <span className="w-28 shrink-0 text-xs uppercase tracking-widest text-slate-500">{label}</span>
      <code className={`font-mono text-sm ${mine ? 'text-emerald-300' : 'text-slate-400'}`}>{id}</code>
      <span className="text-sm text-slate-500">{note}</span>
    </div>
  )
}

export function App2({ instance, idToken, elapsedMs, redirectError, sharedAccountName }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(redirectError)

  const acquisition = idToken ? classifyAcquisition(idToken, elapsedMs) : null

  // Decoding is for display only and never validates anything — see lib/jwt.
  // MSAL already validated the token it handed us; this is a viewer.
  const payload = (() => {
    if (!idToken) return null
    try {
      return decodeJwt(idToken).payload
    } catch {
      return null
    }
  })()

  /**
   * The whole demo, in four lines.
   *
   * A top-level redirect with no `prompt` parameter. Not `ssoSilent` — that
   * runs in a hidden iframe, and a real capture proved a third-party iframe
   * never receives the Entra session cookie in a browser with tracking
   * protection on. First-party navigation is the reason this works at all.
   */
  async function getToken() {
    setError(null)
    setBusy(true)
    // Stamped immediately before we leave the page; read on the way back.
    markApp2Start()
    try {
      await instance.loginRedirect(crossAppSsoRequest)
    } catch (e) {
      setBusy(false)
      setError(e instanceof Error ? e.message : 'Could not start the authorization request.')
    }
  }

  const onLocalhost =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'

  return (
    <main className="min-h-screen bg-slate-950 text-slate-300">
      <div className="max-w-[72rem] px-8 pt-16 pb-20">
        <header className="max-w-3xl">
          <p className="font-mono text-xs uppercase tracking-widest text-emerald-400">
            App 2 · cross-app SSO
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            A second application, the same session
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-slate-400">
            This page is a different app registration in the same Entra tenant — its own client
            ID, its own redirect URI, its own token cache. It has never seen your credentials and
            it never will. If you are signed in on the main app, it can still get a token for you,
            and you will not be asked for anything.
          </p>
          {/* A real navigation, not a client-side route change: each app boots
              its own MSAL instance, and swapping instances in place is a good
              way to leave a half-initialised one behind. */}
          <p className="mt-4 text-sm">
            <a href="/" className="text-slate-500 underline decoration-slate-700 underline-offset-4 transition hover:text-emerald-300">
              ← the main app
            </a>
          </p>
        </header>

        {/* ── Two client IDs. This is the "different app" evidence. ────────── */}
        <section aria-labelledby="apps" className="mt-12 max-w-3xl">
          <h2 id="apps" className="text-sm font-medium uppercase tracking-widest text-slate-500">
            Two applications
          </h2>
          <div className="mt-3 divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-2">
            <ClientIdRow
              label="Main app"
              id={MAIN_CLIENT_ID_FOR_DISPLAY}
              note="the one you signed into"
            />
            <ClientIdRow label="This app" id={APP2_CLIENT_ID} note="the one you are on now" mine />
          </div>
          <p className="mt-3 text-sm leading-relaxed text-slate-500">
            Same tenant, same user, two registrations. MSAL caches accounts per origin but tokens
            per client ID, so this app genuinely starts with nothing — it cannot borrow the other
            app's token, it has to be issued its own.
          </p>
        </section>

        {/* ── The state panel: what actually happened. ─────────────────────── */}
        <section aria-labelledby="state" className="mt-10 max-w-3xl">
          <h2 id="state" className="text-sm font-medium uppercase tracking-widest text-slate-500">
            This application's token
          </h2>

          <div className="mt-3 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
            {!acquisition && (
              <>
                <p className="text-lg font-medium text-slate-200">This application has no token.</p>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  {sharedAccountName ? (
                    <>
                      MSAL's cache in this tab already holds an account —{' '}
                      <span className="font-mono text-slate-300">{sharedAccountName}</span>. That is
                      a local cache entry shared across client IDs on this origin, not a session and
                      not a token for this app. Nothing has been issued to{' '}
                      <span className="font-mono">{APP2_CLIENT_ID.slice(0, 8)}…</span> yet.
                    </>
                  ) : (
                    <>
                      Nothing has been issued to this client ID in this tab. If you have a live
                      Entra session — from the main app, or from anywhere else in this tenant — the
                      button below will get a token off it without asking you for anything.
                    </>
                  )}
                </p>
              </>
            )}

            {acquisition?.kind === 'sso' && (
              <>
                <p className="text-lg font-medium text-emerald-300">
                  Token issued. No prompt appeared.
                </p>
                <p className="mt-2 text-sm leading-relaxed text-slate-300">
                  Round trip from click to token:{' '}
                  <span className="font-mono text-emerald-300">
                    {formatElapsed(acquisition.elapsedMs)}
                  </span>
                  , measured in this browser. Nobody entered a password in that window — there was
                  not time to. Entra already had a session for you, and this request did not ask it
                  to ignore one, so it issued a token to a second application you had never visited.
                </p>
              </>
            )}

            {acquisition?.kind === 'interactive' && (
              <>
                <p className="text-lg font-medium text-amber-300">
                  Token issued — but this page will not call it SSO.
                </p>
                <p className="mt-2 text-sm leading-relaxed text-slate-300">
                  Round trip:{' '}
                  <span className="font-mono text-amber-300">
                    {formatElapsed(acquisition.elapsedMs)}
                  </span>
                  . That is long enough for a person to have typed something, so it is not evidence
                  of anything. If Entra showed you a sign-in page just now, there was no session to
                  reuse and it made one.
                </p>
                <p className="mt-2 text-sm leading-relaxed text-slate-300">
                  There is a session now. Press the button again — the second attempt is the
                  demonstration.
                </p>
              </>
            )}

            {acquisition?.kind === 'untimed' && (
              <>
                <p className="text-lg font-medium text-slate-200">Token issued. Timing unknown.</p>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  This browser blocked the session storage this page measures the round trip with,
                  so it cannot tell you whether a prompt appeared. The token below is real; the
                  claim about how it got here is the part that is missing, and it is not going to be
                  guessed.
                </p>
              </>
            )}

            {acquisition?.kind === 'foreign-audience' && (
              <>
                <p className="text-lg font-medium text-red-300">Refusing to show this token.</p>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  It carries{' '}
                  <span className="font-mono">aud={acquisition.audience ?? 'unreadable'}</span>,
                  which is not this application's client ID. Whatever it is, it is not this app's
                  token, and presenting it as one would be the exact fabrication this page exists to
                  rule out.
                </p>
              </>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                onClick={getToken}
                disabled={busy}
                className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
              >
                {busy
                  ? 'Redirecting…'
                  : acquisition
                    ? 'Get another token'
                    : 'Get a token from the shared session'}
              </button>
              <span className="text-xs leading-relaxed text-slate-500">
                Sends a top-level redirect to Entra with no{' '}
                <span className="font-mono text-slate-400">prompt</span> parameter.
              </span>
            </div>

            {error && (
              <p className="mt-4 rounded-md border border-red-500/30 bg-red-500/5 p-3 text-xs leading-relaxed text-red-300">
                {error}
              </p>
            )}

            {onLocalhost && (
              /* Dev-only, and it saves a confusing twenty minutes. Stated as a
                 conditional rather than a prediction: the recorded redirect URI
                 for this registration is the production one, and whether the
                 localhost variant is also registered has not been confirmed. */
              <p className="mt-4 rounded-md border border-slate-700 bg-slate-800/40 p-3 text-xs leading-relaxed text-slate-400">
                <span className="font-medium text-slate-300">Running on localhost.</span> The
                redirect URI recorded for the CrossAppSSO app registration is{' '}
                <span className="font-mono">https://theidentityplayground.com/app2</span>. If Entra
                answers with AADSTS50011, then{' '}
                <span className="font-mono">{window.location.origin}/app2</span> is not on that
                registration yet — add it there and this works.
              </p>
            )}
          </div>
        </section>

        {/* ── The token itself, if there is one. ───────────────────────────── */}
        {payload && acquisition && acquisition.kind !== 'foreign-audience' && (
          <section aria-labelledby="claims" className="mt-10 max-w-3xl">
            <h2 id="claims" className="text-sm font-medium uppercase tracking-widest text-slate-500">
              What this app was handed
            </h2>
            <dl className="mt-3 divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-2">
              {CLAIMS_ON_SHOW.filter((name) => name in payload).map((name) => {
                const value = payload[name]
                const time = formatTimeClaim(value)
                return (
                  <div key={name} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-2">
                    <dt className="w-40 shrink-0 font-mono text-xs text-slate-500">{name}</dt>
                    <dd
                      className={`min-w-0 break-all font-mono text-sm ${
                        name === 'aud' ? 'text-emerald-300' : 'text-slate-300'
                      }`}
                    >
                      {time ?? formatClaimValue(value)}
                      {name === 'aud' && (
                        <span className="ml-2 font-sans text-xs text-slate-500">
                          ← issued to this app, not the one you signed into
                        </span>
                      )}
                    </dd>
                  </div>
                )
              })}
            </dl>

            {/* Collapsed by default: the point of this page is the aud claim
                above, not another wall of base64. */}
            <details className="mt-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
              <summary className="cursor-pointer text-sm text-slate-400">
                The raw ID token
              </summary>
              <p className="mt-2 text-xs leading-relaxed text-slate-500">
                Decoded above for display only — nothing here verifies the signature, and a browser
                is the wrong place to try.
              </p>
              <pre className="mt-2 max-h-48 overflow-auto break-all whitespace-pre-wrap font-mono text-xs text-slate-500">
                {idToken}
              </pre>
            </details>
          </section>
        )}

        {/* ── Why it works. Short, because the page above is the argument. ─── */}
        <section aria-labelledby="how" className="mt-10 max-w-3xl">
          <h2 id="how" className="text-sm font-medium uppercase tracking-widest text-slate-500">
            Why there was no prompt
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">
            The authorization request this page sends carries no{' '}
            <span className="font-mono text-slate-300">prompt</span> parameter. That absence is the
            whole mechanism: a plain request lets Entra honour the session cookie it already holds.
            SSO is the OIDC default, not a feature switched on.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-slate-400">
            It also goes out as a top-level navigation rather than a hidden iframe. A capture on
            this tenant showed the same user, seconds apart: the top-level request came back with a
            code, and a{' '}
            <span className="font-mono text-slate-300">prompt=none</span> iframe came back{' '}
            <span className="font-mono text-slate-300">login_required</span> — Firefox partitions
            the session cookie away from a third-party frame, so Entra never sees it. Silent SSO by
            iframe is over; first-party redirects still work.
          </p>
        </section>

        <footer className="mt-16 max-w-3xl border-t border-slate-800 pt-6">
          <p className="text-sm text-slate-600">
            Demo tenants only — no real accounts, no real data. Every account created here
            self-destructs.
          </p>
        </footer>
      </div>
    </main>
  )
}
