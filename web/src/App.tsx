// Phase 0 placeholder. The bar here is deliberately low: prove the toolchain
// builds and deploys end to end. Auth (MSAL) arrives in Phase 1 — see spec
// section 5. Nothing on this page talks to a tenant yet.

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
  return (
    <main className="min-h-screen bg-slate-950 text-slate-300">
      <div className="mx-auto max-w-3xl px-6 py-20">
        <header>
          <p className="font-mono text-xs uppercase tracking-widest text-emerald-400">
            Phase 0 · scaffolding
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
