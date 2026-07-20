import { useEffect, useMemo, useState } from 'react'
import { useMsal } from '@azure/msal-react'
import { TokenInspector } from './components/TokenInspector'
import { JourneyTimeline } from './components/JourneyTimeline'
import { SignInPanel } from './components/SignInPanel'
import { buildSampleToken } from './lib/sampleToken'
import {
  accountCreatedAtMs,
  readLastFlow,
  settleLastFlow,
  type FlowMatch,
} from './lib/lastFlow'

// Phase 1. Sign in and the inspector reads your real ID token; otherwise it
// falls back to a clearly-labelled sample so the page still demonstrates
// something to a visitor who doesn't want an account.

// A union type rather than plain `string`: adding a status the styles don't
// cover becomes a compile error instead of an undefined class name at runtime.
type ModuleStatus = 'building' | 'planned' | 'live'

type Module = {
  phase: number
  name: string
  blurb: string
  status: ModuleStatus
}

// Homepage roadmap, per spec section 5: "The site is never 'unfinished,' just
// growing." Update `status` as phases land.
const MODULES: Module[] = [
  { phase: 1, name: 'Token Inspector', blurb: 'Sign in, then read your own ID token. Every claim annotated.', status: 'building' },
  { phase: 2, name: 'Three Doors, One App', blurb: 'Customer, business guest, or employee. Compare what each token says.', status: 'planned' },
  { phase: 3, name: 'Auth Methods Arena', blurb: 'Password, email OTP, social, passkey. Watch each flow execute.', status: 'planned' },
  { phase: 4, name: "The Admin's View", blurb: 'A live sign-in log. Yours shows up in it.', status: 'planned' },
  { phase: 5, name: 'Conditional Access, Live', blurb: 'Trip a real CA policy and read the policy that caught you.', status: 'planned' },
  { phase: 6, name: 'Live SCIM Provisioning', blurb: 'Hire a demo employee, watch them provision into a SaaS app in real time.', status: 'planned' },
  { phase: 7, name: 'Self-Destructing Accounts', blurb: 'Every demo account expires. Here is the job that kills them.', status: 'planned' },
]

// Record<ModuleStatus, string> forces this map to stay exhaustive: add a status
// to the union above without adding styles here and the build fails.
const STATUS_STYLES: Record<ModuleStatus, string> = {
  building: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30',
  planned: 'bg-slate-500/10 text-slate-400 ring-slate-500/30',
  live: 'bg-sky-500/10 text-sky-300 ring-sky-500/30',
}

function App() {
  const { accounts } = useMsal()

  // Built once per mount so the validity window reads relative to now.
  const sampleToken = useMemo(() => buildSampleToken(), [])

  // MSAL caches the raw ID token on the account it hands back. No extra call
  // needed — it's the token the visitor was just issued.
  const account = accounts[0] ?? null
  const realIdToken = account?.idToken ?? null

  /**
   * Sign-up or sign-in, from the account creation time the token carries.
   *
   * ── THE ORDERING PROBLEM, AND WHY THE ANSWER ARRIVES AS A PROP ────────────
   *
   * The timeline reads which flow happened once, in a useState initialiser, on
   * mount. That runs during its render, before any effect anywhere. So even
   * though this costs nothing but a base64 decode, it still lands after the
   * component has decided what it is showing, and it has to reach a component
   * that has already made up its mind.
   *
   * Same shape as localSignOutCount below: hold it here, pass it down, let the
   * timeline notice it changed. No store, no context, no event.
   */
  const [resolvedFlow, setResolvedFlow] = useState<FlowMatch>(null)

  useEffect(() => {
    // The REAL token, never `realIdToken ?? sampleToken` — which is what the JSX
    // below hands the inspector and the timeline for display. The sample's
    // createddatetime is invented, dated months before its own iat, so feeding
    // it to resolveAmbiguous would badge a sign-in that nobody performed, off a
    // number nobody measured. Pinned by App.test.tsx.
    if (!realIdToken) return
    // Only the pair we cannot tell apart. The deterministic branches already
    // know what they are and must not be second-guessed.
    if (readLastFlow()?.kind !== 'ambiguous') return

    const settled = settleLastFlow(accountCreatedAtMs(realIdToken), realIdToken)
    // Still ambiguous means the claim was absent or unreadable. Leave the page
    // exactly as it is rather than re-rendering it to say the same thing.
    if (settled?.kind === 'matched') setResolvedFlow(settled)
  }, [realIdToken])

  /**
   * Signing out of this app only makes no request and never navigates, so the
   * sessionStorage marker that carries every other flow across its redirect has
   * nothing to carry and nothing to come back and read. The panel raises it
   * here instead and the timeline moves onto the sign-out flow in place.
   *
   * A counter, not a flag: the visitor can click away to another flow and sign
   * out again, and the second click has to move the timeline as surely as the
   * first. A flag would already be true and nothing would happen. It is never
   * displayed and it is not a duration.
   */
  const [localSignOutCount, setLocalSignOutCount] = useState(0)

  return (
    // No max-width. There was one — 112rem, 1792px — and on a full-screen
    // window wider than that it stopped the page dead in the middle of the
    // monitor and left the rest empty. px-8 is the indent and stays 32px at
    // every width; the fix is the cap coming off, not the gutters growing.
    //
    // Nothing runs away as a result. The reading columns cap themselves at
    // max-w-3xl (header, roadmap, footer, the section blurbs), and the claims
    // panel is a fixed 27rem in the grid below. The only thing that grows is
    // the timeline's 1fr column, which is the one that wants the room.
    <main className="min-h-screen bg-slate-950 text-slate-300">
      <div className="px-8 pt-16 pb-20">
        <header className="max-w-3xl">
          <p className="font-mono text-xs uppercase tracking-widest text-emerald-400">
            Phase 1 · token inspector
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            The Identity Playground
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-slate-400">
            Identity work is invisible in production. This site makes it visible: sign in
            for real, then read the token that came back and every request that produced
            it.
          </p>
          <p className="mt-4 text-lg leading-relaxed text-slate-400">
            Built on Microsoft Entra by{' '}
            <span className="text-slate-200">Steven Flanagan</span>. Every module links to
            the tenant config and source that produced it.
          </p>
        </header>

        {/* Timeline left, claims right — the token you got and how you got it,
            side by side. The claims are a tall column of long values (GUIDs), so
            rather than fight them flat they scroll inside a sticky reference panel
            on the right, which is the second-monitor shape. Timeline gets the wide
            column for the axis. Claims are first in the DOM, placed right by the
            grid, so a phone shows the payoff first and then stacks the timeline —
            mobile just needs to work.

            The column widths are what makes a wide monitor pay off, now that
            nothing caps the page: claims are a fixed 27rem, so every pixel a
            wider window adds goes to the timeline's 1fr. Being the second grid
            column also puts the claims panel against the right edge rather than
            floating somewhere near the middle. Both of those collapse below lg,
            where the grid is a single stacked column. */}
        <div className="mt-12 grid gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_27rem]">
          <section
            aria-labelledby="inspector"
            className="lg:sticky lg:top-6 lg:col-start-2 lg:row-start-1 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto lg:overflow-x-hidden"
          >
            <div className="mb-4">
              <h2 id="inspector" className="text-sm font-medium uppercase tracking-widest text-slate-500">
                {realIdToken ? 'Your claims' : 'The claims you’d get'}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">
                {realIdToken
                  ? 'The real token you were just issued, every claim annotated: what it is, why it’s in your token, and which tenant configuration produced it.'
                  : 'A sample, until you sign in. Then this reads your own real token: same claims, your values.'}
              </p>
            </div>

            <div className="mb-4">
              <SignInPanel onLocalSignOut={() => setLocalSignOutCount((n) => n + 1)} />
            </div>

            <TokenInspector
              token={realIdToken ?? sampleToken}
              label={realIdToken ? 'Your ID token' : 'Sample ID token'}
              live={Boolean(realIdToken)}
            />

            {/* ── The way to /app2, which was reachable only by typing the URL ──
                Placed under the token because that is where a reader who has
                just finished reading their claims is, and the next thing /app2
                does is hand them a second set.

                GATED ON THE TOKEN, not merely explained. A signed-out visitor
                who follows this gets sent to Entra for credentials, and App2
                says so itself: with no session to reuse, its own copy drops to
                "the round trip does not prove SSO … press the button again".
                The demonstration is that no prompt appears, so offering it in
                the one state where a prompt does appear spends the page's best
                argument on the visitor least able to check it. `realIdToken`
                already gates copy elsewhere in this file, so the condition
                costs nothing new.

                A plain sentence, deliberately: this is a reference the reader
                either wants or doesn't, and the same underline treatment /app2
                uses for its link back here. */}
            {realIdToken && (
              <p className="mt-4 text-sm leading-relaxed text-slate-400">
                <a
                  href="/app2"
                  className="font-mono text-slate-300 underline decoration-slate-700 underline-offset-4 transition hover:text-emerald-300"
                >
                  /app2
                </a>{' '}
                is a second app registration in this tenant: same session, its own token.
              </p>
            )}
          </section>

          <section aria-labelledby="journey" className="min-w-0 lg:col-start-1 lg:row-start-1">
            <div className="mb-5">
              <h2 id="journey" className="text-sm font-medium uppercase tracking-widest text-slate-500">
                How those claims got there
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
                Every request in a real sign-in, measured. The entire flow stays on the overview bar;
                below it each step sits on its own axis. Click slices for details and code examples
                where applicable.
              </p>
            </div>

            <p className="mb-4 max-w-3xl rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-200/70">
              <span className="font-medium text-emerald-300">Measured, not estimated.</span> Every
              millisecond comes from a real capture of a real flow against this tenant. Server time
              per request, and the phases inside it.
            </p>

            {/* Kept OUT of the "measured" box on purpose. That box is a standing
                claim about the data's provenance; this is a temporary state note
                that stops applying the moment someone signs in. Folding a
                transient into a permanent statement made both read as hedging. */}
            {!realIdToken && (
              <p className="mb-4 max-w-3xl rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-200/70">
                <span className="font-medium text-amber-300">Recorded sample flows.</span> Sign in
                and the one you actually performed gets called out.
              </p>
            )}

            <JourneyTimeline
              token={realIdToken ?? sampleToken}
              tokenLabel={realIdToken ? 'Your ID token' : 'Sample ID token'}
              localSignOutCount={localSignOutCount}
              resolvedFlow={resolvedFlow}
            />
          </section>
        </div>

        <section className="mt-16 max-w-3xl" aria-labelledby="roadmap">
          <h2 id="roadmap" className="text-sm font-medium uppercase tracking-widest text-slate-500">
            Roadmap
          </h2>
          <ul className="mt-6 space-y-3">
            {MODULES.map((m) => (
              <li
                key={m.phase}
                className="flex gap-4 rounded-lg border border-slate-800 bg-slate-900/50 p-4"
              >
                <span className="font-mono text-sm text-slate-600" aria-hidden="true">
                  {String(m.phase).padStart(2, '0')}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h3 className="font-medium text-slate-200">{m.name}</h3>
                    <span
                      className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ring-1 ring-inset ${STATUS_STYLES[m.status]}`}
                    >
                      {m.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-slate-500">{m.blurb}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <footer className="mt-16 max-w-3xl border-t border-slate-800 pt-6">
          <p className="text-sm text-slate-600">
            Demo tenants only. No real accounts, no real data. Every account created here
            self-destructs.
          </p>
        </footer>
      </div>
    </main>
  )
}

export default App
