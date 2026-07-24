import { useEffect, useState } from 'react'

import {
  SWEEPS,
  fetchSweepRuns,
  formatAge,
  isStale,
  workflowUrl,
  type CleanupRun,
  type Sweep,
  type SweepResult,
} from '../lib/cleanupRuns'

/*
 * Module 7: self-destructing accounts.
 *
 * The site tells every visitor their demo account is deleted within 24 hours.
 * Until this section existed, the only way to know that was true was to read
 * GitHub Actions logs. This is the receipt.
 *
 * It shows the real runs, live, read from GitHub's public API in the visitor's
 * browser. Nothing here is a number this site published about itself, which is
 * deliberate: a stats file we write is a claim, and a link to GitHub's record of
 * the run is evidence. See lib/cleanupRuns.ts for why that ruled out the
 * commit-the-stats-back design decision 003 originally scoped.
 *
 * WHAT IT DELIBERATELY DOES NOT SHOW: how many accounts each run deleted. Those
 * counts are in the run log, one click away, and they cannot be read from the
 * API without a token. Rather than publish an unverifiable number next to a
 * verifiable one, the page links to the log. design.md section 2: never
 * fabricate into the gap, and say so where the gap is.
 *
 * The visitor-facing copy is plain and minimal, for Steve to rewrite. Public
 * copy is his (design.md section 2).
 */

const REPO_BLOB = 'https://github.com/steve-flanagan/theidentityplayground/blob/main'

/** Green for a clean run, amber for a problem, slate for one still going. */
function conclusionTone(conclusion: string | null): string {
  if (conclusion === 'success') return 'text-emerald-400'
  if (conclusion === null) return 'text-slate-400'
  return 'text-amber-400'
}

function conclusionLabel(run: CleanupRun): string {
  if (run.conclusion === 'success') return 'passed'
  if (run.conclusion === null) return 'running'
  return run.conclusion
}

/**
 * The last eight runs as a row of marks. Each one links to its real log, which
 * is the part that makes this evidence rather than decoration.
 */
function RunStrip({ runs }: { runs: CleanupRun[] }) {
  return (
    <ul className="mt-3 flex flex-wrap gap-1.5">
      {/* Oldest on the left, so it reads left to right like everything else on
          this site. GitHub returns newest first. */}
      {[...runs].reverse().map((run) => (
        <li key={run.id}>
          <a
            href={run.url}
            target="_blank"
            rel="noreferrer"
            title={`${run.event} · ${conclusionLabel(run)}`}
            className={`block h-5 w-2.5 rounded-sm ring-1 ring-inset transition hover:ring-slate-400 ${
              run.conclusion === 'success'
                ? 'bg-emerald-500/30 ring-emerald-500/50'
                : run.conclusion === null
                  ? 'bg-slate-700/50 ring-slate-600'
                  : 'bg-amber-500/30 ring-amber-500/50'
            }`}
          >
            <span className="sr-only">
              {run.event} run, {conclusionLabel(run)}
            </span>
          </a>
        </li>
      ))}
    </ul>
  )
}

function SweepCard({ sweep, result, now }: { sweep: Sweep; result: SweepResult | null; now: Date }) {
  const latest = result?.ok ? result.runs[0] : undefined
  const stale = result?.ok ? isStale(latest, sweep, now) : false

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="font-medium text-slate-200">{sweep.label}</h3>
        <span className="font-mono text-xs text-slate-500">{sweep.cadence}</span>
      </div>
      <p className="mt-1 text-sm text-slate-500">{sweep.tenant}</p>

      <div className="mt-4 min-h-[3.75rem]">
        {result === null && (
          // No spinner. The layout is already its final size, so nothing shifts
          // when the answer lands (design.md section 2: nothing plays).
          <p className="font-mono text-sm text-slate-600">reading run history…</p>
        )}

        {result?.ok === false && (
          <p className="text-sm leading-relaxed text-slate-500">
            {result.reason === 'rate-limited'
              ? 'GitHub is rate limiting this browser, so the run history is not readable right now. It resets within the hour.'
              : 'Could not reach GitHub to read the run history.'}{' '}
            <a
              href={workflowUrl(sweep)}
              target="_blank"
              rel="noreferrer"
              className="text-slate-300 underline decoration-slate-700 underline-offset-4 hover:text-emerald-300"
            >
              The runs are here.
            </a>
          </p>
        )}

        {result?.ok && !latest && (
          <p className="text-sm leading-relaxed text-slate-500">No runs recorded yet.</p>
        )}

        {result?.ok && latest && (
          <>
            <p className="font-mono text-sm">
              <span className={conclusionTone(latest.conclusion)}>{conclusionLabel(latest)}</span>
              <span className="text-slate-500"> · {formatAge(latest.startedAt, now)}</span>
              {latest.event !== 'schedule' && (
                <span className="text-slate-600"> · started by hand</span>
              )}
            </p>
            {stale && (
              // The failure this whole module exists to catch. A sweep that stops
              // running raises nothing on its own.
              <p className="mt-1 text-sm leading-relaxed text-amber-300/80">
                That is longer ago than this sweep should go. Something is wrong with the schedule.
              </p>
            )}
            <RunStrip runs={result.runs} />
          </>
        )}
      </div>

      <p className="mt-3">
        <a
          href={workflowUrl(sweep)}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-xs text-slate-400 underline decoration-slate-700 underline-offset-4 transition hover:text-emerald-300"
        >
          every run ↗
        </a>
      </p>
    </div>
  )
}

export function CleanupStatus() {
  const [results, setResults] = useState<Record<string, SweepResult>>({})
  // Captured once per mount. A ticking clock would re-render the whole section
  // to change "2 hours ago" to "2 hours ago".
  const [now] = useState(() => new Date())

  useEffect(() => {
    let live = true
    for (const sweep of SWEEPS) {
      fetchSweepRuns(sweep).then((result) => {
        if (live) setResults((prev) => ({ ...prev, [sweep.id]: result }))
      })
    }
    return () => {
      live = false
    }
  }, [])

  return (
    <section aria-labelledby="cleanup">
      <h2 id="cleanup" className="text-lg font-medium">
        Every demo account here deletes itself
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
        Accounts made on this site are removed 24 to 30 hours after they are created, by a
        scheduled job with no human in the loop. Below is that job's real run history, read
        live from GitHub. Each mark is a run and links to its log.
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        {SWEEPS.map((sweep) => (
          <SweepCard key={sweep.id} sweep={sweep} result={results[sweep.id] ?? null} now={now} />
        ))}
      </div>

      <div className="mt-8 max-w-2xl space-y-4 text-sm leading-relaxed text-slate-400">
        <p>
          <span className="text-slate-200">There is no stored credential.</span> GitHub mints a
          token for the workflow, and Entra trades it for a Graph token through a federated
          credential on an app registration. No client secret and no certificate exists, so
          there is nothing to rotate and nothing to leak.
        </p>
        <p>
          <span className="text-slate-200">Deleting is not destroying.</span> Graph soft-deletes
          a user, which leaves the object restorable for 30 days with its attributes intact. A
          site that promised accounts self-destruct while keeping a month of recoverable
          personal data would be lying in the one place it claims authority, so the job purges
          as well.
        </p>
        <p>
          <span className="text-slate-200">It refuses more than it deletes.</span> A user is a
          candidate only if it can be positively identified as a self-service sign-up. Every
          holder of every directory role is excluded before any age check, and a run that finds
          more candidates than its ceiling stops rather than trusting the rule that produced
          them.
        </p>
      </div>

      <p className="mt-6 flex flex-wrap gap-x-5 gap-y-2 font-mono text-xs">
        <a
          href={`${REPO_BLOB}/scripts/Remove-ExpiredDemoAccounts.ps1`}
          target="_blank"
          rel="noreferrer"
          className="text-slate-400 underline decoration-slate-700 underline-offset-4 transition hover:text-emerald-300"
        >
          the script ↗
        </a>
        <a
          href={`${REPO_BLOB}/docs/decisions/003-cross-tenant-graph.md`}
          target="_blank"
          rel="noreferrer"
          className="text-slate-400 underline decoration-slate-700 underline-offset-4 transition hover:text-emerald-300"
        >
          why it authenticates that way ↗
        </a>
        <a
          href={`${REPO_BLOB}/docs/decisions/009-workforce-guest-cleanup.md`}
          target="_blank"
          rel="noreferrer"
          className="text-slate-400 underline decoration-slate-700 underline-offset-4 transition hover:text-emerald-300"
        >
          why there are two sweeps ↗
        </a>
      </p>
    </section>
  )
}
