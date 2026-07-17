import { useMemo } from 'react'
import { useMsal } from '@azure/msal-react'
import { TokenInspector } from './components/TokenInspector'
import { JourneyTimeline } from './components/JourneyTimeline'
import { SignInPanel } from './components/SignInPanel'
import { buildSampleToken } from './lib/sampleToken'

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
  { phase: 1, name: 'Token Inspector', blurb: 'Sign in, then read your own ID token — every claim annotated.', status: 'building' },
  { phase: 2, name: 'Three Doors, One App', blurb: 'Customer, business guest, or employee. Compare what each token says.', status: 'planned' },
  { phase: 3, name: 'Auth Methods Arena', blurb: 'Password, email OTP, social, passkey — watch each flow execute.', status: 'planned' },
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
  const realIdToken = accounts[0]?.idToken ?? null

  return (
    <main className="min-h-screen bg-slate-950 text-slate-300">
      <div className="mx-auto max-w-3xl px-6 pb-8 pt-20">
        <header>
          <p className="font-mono text-xs uppercase tracking-widest text-emerald-400">
            Phase 1 · token inspector
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            The Identity Playground
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-slate-400">
            Identity work is invisible in production. This site makes it visible: sign in
            for real, then read exactly what happened underneath — the tokens, the
            policies, the provisioning calls.
          </p>
          <p className="mt-4 text-lg leading-relaxed text-slate-400">
            Built on Microsoft Entra by{' '}
            <span className="text-slate-200">Steven Flanagan</span>. Every module links to
            the tenant config and source that produced it.
          </p>
        </header>
      </div>
      {/* The claims come first. Signing in and seeing what you were actually
          handed is the payoff; the timeline below is how it got there. Burying
          this under the timeline put the reward after the explanation. */}
      <div className="mx-auto max-w-3xl px-6">
        <section aria-labelledby="inspector">
          <div className="mb-6">
            <h2 id="inspector" className="text-sm font-medium uppercase tracking-widest text-slate-500">
              Your claims
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Sign in and this reads the real token you were just issued. Every claim annotated:
              what it is, why it's in your token, and which tenant configuration produced it.
            </p>
          </div>

          <div className="mb-4">
            <SignInPanel />
          </div>

          {!realIdToken && (
            <p className="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-sm text-amber-200/70">
              <span className="font-medium text-amber-300">Showing a sample token.</span> Sign in and
              this panel reads the real one you were just issued — same claims, but yours, and the
              values will differ in ways worth reading.
            </p>
          )}

          <TokenInspector
            token={realIdToken ?? sampleToken}
            label={realIdToken ? 'Your ID token' : 'Sample ID token'}
          />
        </section>
      </div>

      {/* The timeline is the page, not a widget in a column — so it breaks out
          of the max-w-3xl prose measure and gets the full width to zoom in. */}
      <section className="mx-auto max-w-7xl px-6 py-8" aria-labelledby="journey">
        <div className="mb-5">
          <h2 id="journey" className="text-sm font-medium uppercase tracking-widest text-slate-500">
            How those claims got there
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
            Every request in a real sign-in, measured. The whole flow stays on the overview bar;
            below it each step sits on its own axis, and opening one rescales to just that slice.
            Switch between sign-in and sign-up and watch exactly four requests appear or vanish —
            that's the entire difference between the two.
          </p>
        </div>

        {/* The old banner here said "sample timings — plausible, not measured".
            It isn't true any more, and leaving it up would be its own lie. */}
        <p className="mb-4 max-w-3xl rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-200/70">
          <span className="font-medium text-emerald-300">Measured, not estimated.</span> Every
          millisecond comes from a real capture of a real flow against this tenant — server time
          per request, and the phases inside it. Your typing isn't on the axis: it happens between
          requests, not inside them.
        </p>

        <JourneyTimeline
          token={realIdToken ?? sampleToken}
          tokenLabel={realIdToken ? 'Your ID token' : 'Sample ID token'}
        />
      </section>

      <div className="mx-auto max-w-3xl px-6 pb-20">

        <section className="mt-16" aria-labelledby="roadmap">
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

        <footer className="mt-16 border-t border-slate-800 pt-6">
          <p className="text-sm text-slate-600">
            Demo tenants only — no real accounts, no real data. Every account created here
            self-destructs.
          </p>
        </footer>
      </div>
    </main>
  )
}

export default App
