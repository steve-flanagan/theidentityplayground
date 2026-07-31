import { useCallback, useEffect, useMemo, useState } from 'react'
import { API_BASE } from '../lib/apiBase'
import { ScimTranscript } from './ScimTranscript'
import { SiteNav } from '../components/SiteNav'
import { IDLE_PIPELINE, ScimPipeline, type PipelineModel } from './ScimPipeline'
import { LINE_MS, TAIL_MS } from './CallTicker'

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
 * The SCIM requests Entra made during an operation, found by NOVELTY rather than
 * by time.
 *
 * ── WHY NOT A TIMESTAMP, WHICH IS THE OBVIOUS WAY ────────────────────────────
 *
 * It was a timestamp, and it silently returned nothing on the live site while
 * every other part of the page worked. The filter compared `Date.now()` in the
 * browser against `at` values stamped by the Function App — TWO DIFFERENT CLOCKS.
 * Steve's machine runs roughly 10-12 seconds ahead of Azure, which is plenty to
 * make "events at or after I started" reject events created four seconds later.
 *
 * Measured 30 July 2026: a hire whose events the server stamped 15:17:48–50 had
 * a client `startedAt` of about 15:18:00. Filtering by time found 0 of 3.
 * Filtering by novelty found 3 of 3, in the same run.
 *
 * Client clocks are not authoritative for anything a server wrote. Snapshot what
 * exists, do the thing, take what appeared. No clock is involved and none can
 * drift.
 */
/**
 * What the SCIM stage should say, derived from the traffic we actually observed.
 *
 * ── THIS REPLACED A HARDCODED STRING, AND THAT STRING WAS A LIE ──────────────
 *
 * The stage used to read `detail: 'PATCH /Users'` whenever the backend reported
 * `deprovisioned: true`. But `deprovisioned` only means provisionOnDemand
 * returned 200, and a 200 from provisionOnDemand means "I evaluated the user",
 * NOT "I sent something". This module has now produced that silent no-op four
 * separate times.
 *
 * Steve hit it on the live site: Entra sent nothing, the store recorded no PATCH,
 * and the pipeline cheerfully announced "PATCH /Users" anyway. The application
 * stage was the only honest thing on screen, because it polls for the row.
 *
 * So the label comes from the events. No traffic, no claim.
 */
/**
 * What the SCIM stage is allowed to claim, derived only from requests Entra
 * actually sent us.
 *
 * The write is the whole point: a POST on the way in, a PATCH on the way out.
 * Nothing else changes the downstream app, so when the write is absent the
 * stage has NOT succeeded, however much other traffic went past.
 *
 * ── WHY THIS IS NOT JUST `calls.find()` ──────────────────────────────────────
 *
 * Entra reads before it writes. A terminate that decides nothing differs still
 * leaves two GETs in the events store, and the previous version of this
 * function fell back to returning the LAST call when it found no write. So a
 * run that transmitted no change lit the stage green and labelled it
 * `GET /Users/<id>`, sitting next to an amber "row unchanged".
 *
 * Steve caught that on the live site, for the second time. It is the same false
 * claim the hardcoded `PATCH /Users` string made, reached a different way: the
 * label was true, and the state it was attached to was not.
 *
 * Observed 31 July, his run: `GET /Users?filter=...` then
 * `GET /Users/dd8dcb72-44ce-4db8-a192-e53df5eec334`, and no PATCH. A terminate
 * eight minutes earlier sent the same two reads AND a PATCH. Reads are what
 * both runs have in common, which is exactly why they prove nothing.
 */
export function scimOutcome(
  calls: string[],
  expect: 'POST' | 'PATCH',
): { write: string | null; readOnly: boolean } {
  const write = calls.find((c) => c.startsWith(expect)) ?? null
  return {
    write,
    // Read-and-decline and total silence teach different things, so the page
    // distinguishes them: one is the attribute comparison declining to act, the
    // other is a run that never reached this endpoint at all.
    readOnly: write === null && calls.length > 0,
  }
}

async function knownEventKeys(): Promise<Set<string>> {
  try {
    const res = await fetch(`${API_BASE}/scim-demo/events`)
    if (!res.ok) return new Set()
    const body = (await res.json()) as { events: { at: string }[] }
    return new Set((body.events ?? []).map((e) => e.at))
  } catch {
    return new Set()
  }
}

async function scimSince(known: Set<string>): Promise<{ scim: string[]; app: string[] }> {
  try {
    const res = await fetch(`${API_BASE}/scim-demo/events`)
    if (!res.ok) return { scim: [], app: [] }
    const body = (await res.json()) as {
      events: { at: string; method: string; path: string; status: number }[]
    }
    const fresh = (body.events ?? [])
      .filter((e) => !known.has(e.at))
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
  // Whether the last run reached us without a write, and which way. Held as its
  // own state rather than inferred from the stage's label: the explanation
  // panel used to fire on `detail === 'nothing sent'`, so it went silent the
  // moment the label became more accurate. Display copy is not a control flag.
  const [noWrite, setNoWrite] = useState<null | 'silent' | 'read-only'>(null)

  // The feed arrives oldest-first, because /Users pages in creation order and
  // the table below reads through the same store call. That put every new hire
  // on the last row, off the bottom of a long table, which is the one row the
  // visitor just caused and wants to see. Sorted for display only — the SCIM
  // endpoint's own paging order is unchanged, since Entra reads that one.
  //
  // Sorted rather than reversed: `rows` is written from three different fetch
  // sites and a reverse would silently depend on all three agreeing on order.
  // useMemo so this recomputes when the feed changes, not on every poll tick.
  const newestFirst = useMemo(
    () => [...rows].sort((a, b) => b.created.localeCompare(a.created)),
    [rows],
  )

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

  /**
   * ── ONE SEQUENCE, NOT THREE INDEPENDENT ONES ──────────────────────────────
   *
   * Steve, after watching the first version: "The highlights happen instantly
   * sometimes. I'd rather it sit highlighted on entra, run thru the cmds to
   * build the user (slower I think), then highlight scim, go thru all those,
   * then highlight the app."
   *
   * So a stage does not advance until the calls above it have finished playing.
   * The waits below are derived from LINE_MS rather than guessed, so changing the
   * pace in one constant keeps the choreography correct.
   *
   * The calls themselves are still only ever what the backend reported doing.
   * Pacing is presentation; the content is not.
   */
  const playFor = (queue: string[]) =>
    new Promise((r) => setTimeout(r, queue.length * LINE_MS + TAIL_MS))

  const hire = async () => {
    setBusy('hire')
    setError(null)
    // Cleared per run, so the panel never explains the previous one.
    setNoWrite(null)
    // Snapshot before anything happens, so what appears afterwards is provably
    // new. Never a timestamp: the browser clock and Azure's differ by ten
    // seconds on this machine, which silently emptied this once already.
    const known = await knownEventKeys()
    setPipeline({ ...IDLE_PIPELINE, entra: { state: 'working' } })

    try {
      const res = await fetch(`${API}/scim-demo/hire`, { method: 'POST' })
      const body = await readJson(res)
      if (!res.ok) {
        setPipeline({ ...IDLE_PIPELINE, entra: { state: 'failed', detail: 'not created' } })
        setError(
          res.status === 429
            ? `Rate limited. ${retryHint(res)} This demo creates real directory objects, so it is capped per IP address.`
            : (body?.error ?? 'Hire failed.'),
        )
        return
      }

      const hired = body as HireResponse
      setHired(hired)

      // ── Entra: hold the highlight while its own calls go past ──────────────
      const graphCalls = hired.graphCalls ?? []
      setPipeline((p) => ({ ...p, ticker: { entra: graphCalls, scim: [], app: [] } }))
      await playFor(graphCalls)

      setPipeline((p) => ({
        ...p,
        entra: { state: 'done', detail: hired.employee.userPrincipalName.split('@')[0] },
        ticker: { entra: [], scim: [], app: [] },
      }))

      // ── SCIM: only now does the pipeline light, and only its calls play ────
      const traffic = await scimSince(known)
      setPipeline((p) => ({
        ...p,
        provisioning: { state: 'working' },
        ticker: { entra: [], scim: traffic.scim, app: [] },
      }))
      await playFor(traffic.scim)

      // Derived from what Entra actually sent us, never from the push's status.
      const scim = scimOutcome(traffic.scim, 'POST')
      setNoWrite(scim.write || !hired.provisionedOnDemand ? null : scim.readOnly ? 'read-only' : 'silent')
      setPipeline((p) => ({
        ...p,
        provisioning: scim.write
          ? { state: 'done', detail: scim.write }
          : {
              state: 'failed',
              detail: !hired.provisionedOnDemand
                ? (hired.provisionError ?? 'not sent')
                : scim.readOnly
                  ? 'no POST sent'
                  : 'nothing sent',
            },
        ticker: { entra: [], scim: [], app: [] },
      }))

      // ── The application: asked, never assumed ──────────────────────────────
      setPipeline((p) => ({ ...p, application: { state: 'working' } }))
      const landed = await awaitRow(hired.employee.userPrincipalName)
      setPipeline((p) => ({
        ...p,
        application: landed
          ? { state: 'done', detail: 'row created' }
          : { state: 'failed', detail: 'no row yet' },
        // Held until they are let go or the page is left. Who this app currently
        // knows about is a standing fact, not an event.
        held: landed ? hired.employee.displayName : null,
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
    setNoWrite(null)
    try {
      const known = await knownEventKeys()
      const leaving = hired.employee
      setPipeline((p) => ({
        ...IDLE_PIPELINE,
        held: p.held,
        entra: { state: 'working' },
      }))

      const res = await fetch(`${API}/scim-demo/terminate/${leaving.id}`, { method: 'POST' })
      const body = await readJson(res)
      if (!res.ok) {
        setPipeline(IDLE_PIPELINE)
        setError(body?.error ?? 'Terminate failed.')
        return
      }

      // Same three stages, the other way round, and the same rule: a stage waits
      // for the calls above it.
      const graphCalls: string[] = body?.graphCalls ?? []
      setPipeline((p) => ({ ...p, ticker: { entra: graphCalls, scim: [], app: [] } }))
      await playFor(graphCalls)

      setPipeline((p) => ({
        ...p,
        entra: { state: 'done', detail: 'user deleted' },
        ticker: { entra: [], scim: [], app: [] },
      }))
      setHired(null)

      const traffic = await scimSince(known)
      setPipeline((p) => ({
        ...p,
        provisioning: { state: 'working' },
        ticker: { entra: [], scim: traffic.scim, app: [] },
      }))
      await playFor(traffic.scim)

      // Same rule on the way out: a 200 from provisionOnDemand is not evidence
      // that a PATCH was sent, and saying so was how this bug reached production.
      const scim = scimOutcome(traffic.scim, 'PATCH')
      setNoWrite(scim.write || !body?.deprovisioned ? null : scim.readOnly ? 'read-only' : 'silent')
      setPipeline((p) => ({
        ...p,
        provisioning: scim.write
          ? { state: 'done', detail: scim.write }
          : {
              state: 'failed',
              detail: !body?.deprovisioned
                ? (body?.deprovisionError ?? 'not sent')
                : scim.readOnly
                  ? 'no PATCH sent'
                  : 'nothing sent',
            },
        application: { state: 'working' },
        ticker: { entra: [], scim: [], app: [] },
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
            inactive = (f.employees ?? []).some(
              (r) => r.userName === leaving.userPrincipalName && !r.active,
            )
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
        // The hold ends here. They have been let go.
        held: null,
      }))
    } catch {
      setError('Could not reach the backend.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-300">
      <SiteNav current="/scim" />
      <div className="mx-auto max-w-4xl px-6 pt-12 pb-24">
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

        {/* ── WHEN ENTRA SENDS NOTHING, EXPLAIN IT RATHER THAN HIDE IT ───────
            Steve's call, and the right one: "Let's keep it and show it."

            This is a real behaviour that anyone who runs provisioning has been
            bitten by, and a demo that only ever shows the happy path is a worse
            demo. But an amber "nothing sent" with no explanation just looks
            broken, and showing a thing is only worth doing if it teaches
            something. So the page says what happened and why. */}
        {noWrite && (
          <div className="mt-6 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
            <p className="text-sm font-medium text-amber-300">
              {noWrite === 'read-only'
                ? 'Entra read the user, then sent no change.'
                : 'Entra was asked, and sent nothing.'}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              The provisioning service compares the attributes it maps and issues a write only when
              one of them differs.{' '}
              {noWrite === 'read-only'
                ? 'Here it found nothing it maps had changed, so the reads above are the whole of the traffic and no write followed.'
                : 'Here it found nothing it maps had changed and never called this endpoint at all.'}{' '}
              The call that triggered it still returned 200.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-slate-400">
              Nothing is lost. The scheduled cycle picks the user up on its next pass, and the
              account self-destructs either way. This is left visible on purpose: a successful run
              that changed nothing is one of the harder things to notice in production, and it is
              worth seeing once.
            </p>
          </div>
        )}

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
                {newestFirst.map((r) => (
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

        {/* The way back is the nav at the top. This link used to live here and
            was the reason Steve said there was no way back: it sat under a live
            transcript, which is to say nowhere. */}
        <footer className="mt-14 border-t border-slate-800 pt-6 text-sm text-slate-600">
          Demo tenants only. Every account created here self-destructs.
        </footer>
      </div>
    </main>
  )
}
