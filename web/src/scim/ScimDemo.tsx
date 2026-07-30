import { useCallback, useEffect, useState } from 'react'
import { API_BASE } from '../lib/apiBase'
import { ScimTranscript } from './ScimTranscript'
import { IDLE_PIPELINE, ScimPipeline, type PipelineModel } from './ScimPipeline'

/**
 * Module 5's page. Hire a demo employee in a real Microsoft Entra tenant, watch
 * it provision into this site's own SCIM endpoint, then let them go and watch the
 * row go inactive.
 *
 * NO MSAL HERE, and that is the reason this page is its own thing rather than a
 * homepage section. Nothing on it authenticates anybody: the visitor presses a
 * button, the backend does the directory work with its own managed identity, and
 * the whole auth apparatus the other three pages carry is simply absent.
 */

interface Employee {
  id: string
  displayName: string
  userPrincipalName: string
}

interface HireResponse {
  graphCalls?: string[]
  employee: Employee
  provisionedOnDemand: boolean
  provisionStatus: number | null
  provisionError: string | null
  selfDestructsWithinHours: number
}

interface FeedRow {
  id: string
  displayName: string | null
  userName: string
  active: boolean
  created: string
  lastModified: string
}

// Absolute, and apiBase.ts explains at length why a relative '/api' would return
// 200 with the site's own HTML instead of failing honestly.
const API = API_BASE

/** Short, local, and never the raw ISO string: the table is the thing being read,
 *  not the timestamps. */
function shortTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString()
}

/**
 * Reads a JSON body, or says plainly that it did not get one.
 *
 * This exists because of a real bug caught before it shipped. `/api` on the SWA
 * origin returns 200 with the site's own HTML (see lib/apiBase.ts), so
 * `res.json()` threw a parse error miles from the cause while `res.ok` said
 * everything was fine. A wrong content-type is a CONFIGURATION fault, not a
 * transient one, and it should name itself.
 */
/** Turns the limiter's Retry-After seconds into something a person reads. */
function retryHint(res: Response): string {
  const seconds = Number(res.headers.get('retry-after') ?? '')
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Try again shortly.'
  if (seconds < 90) return `Try again in ${Math.ceil(seconds)} seconds.`
  return `Try again in ${Math.ceil(seconds / 60)} minutes.`
}

/**
 * The SCIM requests Entra made since an operation began, split into what it
 * asked and what we answered.
 *
 * Read from the events store rather than written out here. The sequence is
 * predictable enough that hardcoding it would look identical and be a lie — the
 * same lie this page has already been corrected for twice.
 */
async function scimSince(startedAt: number): Promise<{ scim: string[]; app: string[] }> {
  try {
    const res = await fetch(`${API_BASE}/scim-demo/events`)
    if (!res.ok) return { scim: [], app: [] }
    const body = (await res.json()) as {
      events: { at: string; method: string; path: string; status: number }[]
    }
    const fresh = (body.events ?? [])
      .filter((e) => Date.parse(e.at) >= startedAt)
      .reverse() // the store is newest-first; a ticker reads oldest-first
    return {
      // Short enough to go past. /api/scim is on every line and carries nothing.
      scim: fresh.map((e) => `${e.method} ${e.path.replace('/api/scim', '').split('?')[0]}`),
      app: fresh.map((e) => `${e.status}`),
    }
  } catch {
    return { scim: [], app: [] }
  }
}

async function readJson(res: Response): Promise<any> {
  const type = res.headers.get('content-type') ?? ''
  if (!type.includes('json')) {
    throw new Error(`expected JSON from the backend, got ${type || 'no content-type'}`)
  }
  return res.json()
}

export function ScimDemo() {
  const [rows, setRows] = useState<FeedRow[]>([])
  const [hired, setHired] = useState<HireResponse | null>(null)
  const [busy, setBusy] = useState<null | 'hire' | 'terminate'>(null)
  const [error, setError] = useState<string | null>(null)
  const [feedBroken, setFeedBroken] = useState<string | null>(null)
  const [pipeline, setPipeline] = useState<PipelineModel>(IDLE_PIPELINE)

  const loadFeed = useCallback(async () => {
    try {
      const res = await fetch(`${API}/scim-demo/feed`)
      if (!res.ok) return
      const body = (await readJson(res)) as { employees: FeedRow[] }
      setRows(body.employees ?? [])
      setFeedBroken(null)
    } catch (err: any) {
      // Two different failures, deliberately treated differently.
      //
      // A wrong content-type means the backend is misconfigured and the table
      // will be empty forever. That is exactly the bug that nearly shipped here,
      // and an empty table quietly claiming "nothing provisioned yet" is how it
      // would have hidden. It gets said out loud.
      //
      // Anything else — a dropped connection, a cold start — may well succeed on
      // the next load, and an error banner for a blip makes a working demo look
      // broken. That stays quiet.
      if (String(err?.message ?? '').startsWith('expected JSON')) {
        setFeedBroken(err.message)
      }
    }
  }, [])

  useEffect(() => {
    void loadFeed()
  }, [loadFeed])

  /**
   * Waits for the row to actually appear in the application, and says so if it
   * does not.
   *
   * THIS IS THE HONEST PART OF THE PIPELINE. The other two stages are known the
   * moment the hire endpoint answers; this one is only known by asking the
   * downstream app. Marking it done off the same response would be drawing a
   * pipeline rather than showing one, and it would have hidden every silent
   * no-op this module has already produced.
   */
  const awaitRow = async (userName: string): Promise<boolean> => {
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const res = await fetch(`${API}/scim-demo/feed`)
        if (res.ok) {
          const body = (await readJson(res)) as { employees: FeedRow[] }
          setRows(body.employees ?? [])
          if ((body.employees ?? []).some((r) => r.userName === userName)) return true
        }
      } catch {
        // Keep trying; the loop is the retry.
      }
      await new Promise((r) => setTimeout(r, 1200))
    }
    return false
  }

  const hire = async () => {
    setBusy('hire')
    setError(null)
    const startedAt = Date.now()
    setPipeline({ ...IDLE_PIPELINE, entra: { state: 'working' } })
    try {
      const res = await fetch(`${API}/scim-demo/hire`, { method: 'POST' })
      const body = await readJson(res)
      if (!res.ok) {
        setPipeline({ ...IDLE_PIPELINE, entra: { state: 'failed', detail: 'not created' } })
        // 429 is the rate limiter and the one failure a visitor can cause, so it
        // gets its own sentence. The limiter already sends Retry-After, and "a
        // few minutes" when the real answer is fifty-one is the kind of vagueness
        // that makes a working site feel broken.
        setError(
          res.status === 429
            ? `Rate limited. ${retryHint(res)} This demo creates real directory objects, so it is capped per IP address.`
            : (body?.error ?? 'Hire failed.'),
        )
        return
      }

      const hire = body as HireResponse
      setHired(hire)

      // Stage one is a fact by now: Graph returned an object id.
      setPipeline((p) => ({
        ...p,
        entra: { state: 'done', detail: hire.employee.userPrincipalName.split('@')[0] },
        provisioning: { state: 'working' },
        ticker: { entra: hire.graphCalls ?? [], scim: [], app: [] },
      }))

      // A beat, so the movement is visible. Both of the first two stages were
      // already true when the response arrived; this is the order they really
      // happened in, spaced out enough to read.
      await new Promise((r) => setTimeout(r, 700))

      setPipeline((p) => ({
        ...p,
        provisioning: hire.provisionedOnDemand
          ? { state: 'done', detail: 'POST /Users' }
          : {
              state: 'failed',
              detail: hire.provisionError ?? 'not sent',
            },
        application: { state: 'working' },
      }))

      // The SCIM traffic Entra generated, read back rather than assumed.
      const traffic = await scimSince(startedAt)
      setPipeline((p) => ({ ...p, ticker: { entra: [], scim: traffic.scim, app: traffic.app } }))

      // And this one is asked, not assumed.
      const landed = await awaitRow(hire.employee.userPrincipalName)
      setPipeline((p) => ({
        ...p,
        application: landed
          ? { state: 'done', detail: 'row created' }
          : { state: 'failed', detail: 'no row yet' },
      }))
    } catch {
      setError('Could not reach the backend.')
      setPipeline(IDLE_PIPELINE)
    } finally {
      setBusy(null)
    }
  }

  const terminate = async () => {
    if (!hired) return
    setBusy('terminate')
    setError(null)
    try {
      const startedAt = Date.now()
      setPipeline({ ...IDLE_PIPELINE, entra: { state: 'working' } })
      const res = await fetch(`${API}/scim-demo/terminate/${hired.employee.id}`, { method: 'POST' })
      const body = await readJson(res)
      if (!res.ok) {
        setPipeline(IDLE_PIPELINE)
        setError(body?.error ?? 'Terminate failed.')
        return
      }

      // Same three stages, the other way round. The employee is gone from the
      // directory, Entra pushes the change, and the app marks the row inactive.
      const gone = hired.employee.userPrincipalName
      setPipeline((p) => ({
        ...p,
        entra: { state: 'done', detail: 'user deleted' },
        ticker: { entra: body?.graphCalls ?? [], scim: [], app: [] },
        provisioning: body?.deprovisioned
          ? { state: 'done', detail: 'PATCH /Users' }
          : { state: 'failed', detail: body?.deprovisionError ?? 'nothing sent' },
        application: { state: 'working' },
      }))
      setHired(null)

      const leaveTraffic = await scimSince(startedAt)
      setPipeline((p) => ({
        ...p,
        ticker: { entra: [], scim: leaveTraffic.scim, app: leaveTraffic.app },
      }))

      // Asked, not assumed, exactly as on the way in: the row must actually read
      // inactive before this claims it did.
      let inactive = false
      for (let attempt = 0; attempt < 10 && !inactive; attempt++) {
        try {
          const feed = await fetch(`${API}/scim-demo/feed`)
          if (feed.ok) {
            const f = (await readJson(feed)) as { employees: FeedRow[] }
            setRows(f.employees ?? [])
            inactive = (f.employees ?? []).some((r) => r.userName === gone && !r.active)
          }
        } catch {
          // the loop is the retry
        }
        if (!inactive) await new Promise((r) => setTimeout(r, 1200))
      }
      setPipeline((p) => ({
        ...p,
        application: inactive
          ? { state: 'done', detail: 'active false' }
          : { state: 'failed', detail: 'row unchanged' },
      }))
    } catch {
      setError('Could not reach the backend.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-300">
      <div className="mx-auto max-w-4xl px-6 pt-16 pb-24">
        <p className="font-mono text-xs uppercase tracking-widest text-emerald-400">
          Live SCIM provisioning
        </p>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white">
          Hire someone, and watch a SaaS app find out
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-slate-400">
          A demo employee is created in a real Microsoft Entra tenant, then provisioned into the app
          below over SCIM 2.0. That app is this site's own endpoint, and Entra calls it exactly as it
          calls any SaaS app. No account needed.
        </p>
        <p className="mt-4 text-lg leading-relaxed text-slate-400">
          Every hire deletes itself within 30 hours. So does the row it creates.
        </p>

        {/* ── The two buttons ─────────────────────────────────────────────── */}
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <button
            onClick={hire}
            disabled={busy !== null}
            className="rounded-lg bg-emerald-500 px-4 py-2 font-medium text-slate-950 transition hover:bg-emerald-400 disabled:opacity-50"
          >
            {busy === 'hire' ? 'Hiring…' : 'Hire someone'}
          </button>

          {hired && (
            <button
              onClick={terminate}
              disabled={busy !== null}
              className="rounded-lg border border-slate-700 px-4 py-2 font-medium text-slate-200 transition hover:border-slate-500 disabled:opacity-50"
            >
              {busy === 'terminate' ? 'Removing…' : `Let ${hired.employee.displayName.split(' ')[0]} go`}
            </button>
          )}
        </div>

        {error && (
          <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-200/80">
            {error}
          </p>
        )}

        {/* The journey, because a transcript and a table are both true and
            neither shows an object moving between two systems. */}
        <ScimPipeline model={pipeline} />

        {/* ── What just happened, in the backend's own words ──────────────── */}
        {hired && (
          <div className="mt-6 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
            <p className="text-sm text-slate-300">
              <span className="font-medium text-emerald-300">{hired.employee.displayName}</span> exists
              in the tenant as{' '}
              <span className="font-mono text-slate-200">{hired.employee.userPrincipalName}</span>.
            </p>
            <p className="mt-2 text-sm text-slate-400">
              {hired.provisionedOnDemand
                ? 'Entra ran the provisioning rule on demand rather than waiting for its next cycle.'
                : `The on-demand push did not land (${hired.provisionError ?? 'no reason given'}). The scheduled cycle picks it up within forty minutes.`}
            </p>
          </div>
        )}

        {/* ── The downstream app ──────────────────────────────────────────── */}
        <section className="mt-12" aria-labelledby="downstream">
          <h2
            id="downstream"
            className="text-sm font-medium uppercase tracking-widest text-slate-500"
          >
            The downstream app
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
            What the SCIM endpoint has been provisioned. Deprovisioning is a status change, not a
            deletion: the row stays and <span className="font-mono">active</span> goes false. That is
            what the protocol specifies and what Entra actually sends.
          </p>

          {/* Said loudly, because an empty table that claims "nothing provisioned
              yet" is indistinguishable from a working one, and that is exactly
              how this class of bug hides. */}
          {feedBroken && (
            <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-200/80">
              The table below is empty because the backend is not answering correctly, not because
              nothing is provisioned. <span className="font-mono text-xs">{feedBroken}</span>
            </p>
          )}

          <div className="mt-5 overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="border-b border-slate-800 text-xs uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">userName</th>
                  <th className="px-4 py-3 font-medium">active</th>
                  <th className="px-4 py-3 font-medium">Provisioned</th>
                  <th className="px-4 py-3 font-medium">Last change</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-slate-500">
                      Nothing provisioned yet.
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-3 text-slate-200">{r.displayName ?? '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs break-all text-slate-400">
                      {r.userName}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ring-1 ring-inset ${
                          r.active
                            ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30'
                            : 'bg-slate-500/10 text-slate-400 ring-slate-500/30'
                        }`}
                      >
                        {String(r.active)}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {shortTime(r.created)}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">
                      {/* Equal timestamps mean nothing has touched the row since it
                          arrived. That is exactly how a deprovision that silently
                          did nothing was caught, so it is worth showing. */}
                      {r.lastModified === r.created ? '—' : shortTime(r.lastModified)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* The evidence. Everything above is this site describing itself; this
            is Entra's own traffic, recorded as it arrived. */}
        <ScimTranscript />

        <footer className="mt-14 border-t border-slate-800 pt-6 text-sm text-slate-600">
          <a href="/" className="underline decoration-slate-700 underline-offset-4 hover:text-slate-400">
            Back to the playground
          </a>
        </footer>
      </div>
    </main>
  )
}
