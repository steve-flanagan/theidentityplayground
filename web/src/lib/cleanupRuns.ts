// Module 7: reading the cleanup's own run history, live, from GitHub.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY GITHUB'S API AND NOT A STATS FILE WE PUBLISH
//
// Decision 003 scoped this as "the job writes a JSON of counts, the workflow
// commits it, the page renders it." That was rejected on two grounds.
//
// The security one: committing back needs `contents: write` on a job that holds
// User.ReadWrite.All over two tenants, and that job installs Graph modules from
// PSGallery at runtime. A supply-chain compromise there today costs one run's
// worth of tenant access. With write access to main it also costs main, which is
// the trust root for BOTH tenants' federated credentials. Transient access
// becomes permanent.
//
// The honest one, and it is the reason this file exists rather than that one:
// a stats file we publish about ourselves is a CLAIM. A link to GitHub's record
// of the run is EVIDENCE. This site's whole argument is that its numbers are
// measured and its sources are linked (design.md section 2). Pointing at a third
// party's log is more in keeping with that than publishing our own number, and
// the counts are one click away for anyone who wants them.
//
// Verified 24 July: the workflow-runs endpoint is public on a public repo, needs
// no token, and sends `Access-Control-Allow-Origin: *`, so the browser can call
// it directly. No proxy, no backend, no stored credential, nothing to maintain.
//
// THE COST, STATED: unauthenticated GitHub API is 60 requests per hour per IP.
// Two calls per page load, so ~30 loads per visitor per hour before it throttles.
// That is far beyond this site's traffic, and when it does throttle the component
// says so rather than inventing a status. See the cache below, which exists to be
// polite about it rather than because it is needed.
// ─────────────────────────────────────────────────────────────────────────────

const OWNER = 'steve-flanagan'
const REPO = 'theidentityplayground'

/** One sweep. There are two, because there are two tenants holding demo accounts. */
export type Sweep = {
  id: 'customer' | 'guest'
  /** What it sweeps, in the site's own vocabulary rather than the workflow's. */
  label: string
  tenant: string
  workflow: string
  cadence: string
  /**
   * Hours after which silence is worth flagging.
   *
   * Deliberately well above the cadence. GitHub's scheduler is best effort and
   * runs late under load: the hourly guest sweep was observed delivering at
   * 08:03, 10:53 and 13:14 on 23 July, roughly every 2.5 hours. A threshold set
   * to the cron interval would cry wolf on ordinary lateness, and a monitor that
   * cries wolf gets ignored, which is the failure it exists to prevent.
   */
  staleAfterHours: number
}

export const SWEEPS: Sweep[] = [
  {
    id: 'customer',
    label: 'Customers',
    tenant: 'External ID tenant',
    workflow: 'cleanup-demo-accounts.yml',
    cadence: 'every 6 hours',
    staleAfterHours: 14,
  },
  {
    id: 'guest',
    label: 'Guests',
    tenant: 'Workforce tenant',
    workflow: 'cleanup-guest-accounts.yml',
    cadence: 'hourly',
    staleAfterHours: 5,
  },
]

export type CleanupRun = {
  id: number
  /** null while a run is still going. */
  conclusion: string | null
  status: string
  /** 'schedule' for an unattended run, 'workflow_dispatch' for a hand-started one. */
  event: string
  startedAt: string
  url: string
}

export const runsUrl = (sweep: Sweep): string =>
  `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${sweep.workflow}/runs?per_page=8`

/** The workflow's own page, for the "see every run" link. */
export const workflowUrl = (sweep: Sweep): string =>
  `https://github.com/${OWNER}/${REPO}/actions/workflows/${sweep.workflow}`

/**
 * Pull the fields the page uses out of GitHub's response.
 *
 * Defensive about shape rather than trusting it: this is a third-party API read
 * at runtime by a visitor's browser, and a page that throws because a field moved
 * is worse than a page that says it could not read the runs.
 */
export function parseRuns(payload: unknown): CleanupRun[] {
  if (typeof payload !== 'object' || payload === null) return []
  const runs = (payload as { workflow_runs?: unknown }).workflow_runs
  if (!Array.isArray(runs)) return []

  return runs.flatMap((raw): CleanupRun[] => {
    if (typeof raw !== 'object' || raw === null) return []
    const run = raw as Record<string, unknown>
    // run_started_at is when the job actually began; created_at is when it was
    // queued. On a delayed schedule those differ, and "when did it last run" is
    // the more honest of the two.
    const startedAt = run.run_started_at ?? run.created_at
    if (typeof run.id !== 'number' || typeof startedAt !== 'string') return []

    return [
      {
        id: run.id,
        conclusion: typeof run.conclusion === 'string' ? run.conclusion : null,
        status: typeof run.status === 'string' ? run.status : 'unknown',
        event: typeof run.event === 'string' ? run.event : 'unknown',
        startedAt,
        url: typeof run.html_url === 'string' ? run.html_url : workflowUrl(SWEEPS[0]),
      },
    ]
  })
}

/**
 * Has this sweep gone quiet?
 *
 * This is the whole point of the module. A cleanup that stops running produces
 * no error, raises nothing, and leaves the site's self-destruct promise quietly
 * false. Scheduled workflows on public repos are also disabled automatically
 * after 60 days without repository activity, and both sweeps share this repo,
 * so one quiet stretch takes out both at once.
 */
export function isStale(run: CleanupRun | undefined, sweep: Sweep, now: Date): boolean {
  if (!run) return true
  const hours = (now.getTime() - new Date(run.startedAt).getTime()) / 3_600_000
  return hours > sweep.staleAfterHours
}

/** Coarse on purpose. Nobody needs the seconds, and "3 hours ago" reads faster. */
export function formatAge(iso: string, now: Date): string {
  const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000)
  if (!Number.isFinite(minutes)) return 'unknown'
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

// Five minutes. Long enough that clicking around the site costs one request per
// sweep, short enough that the page is not lying about a job that runs hourly.
const CACHE_TTL_MS = 5 * 60 * 1000

type Cached = { at: number; runs: CleanupRun[] }

/**
 * sessionStorage, matching the token cache: it dies with the tab, which is right
 * for a public demo on a machine the visitor may not own. Nothing here is
 * sensitive (it is public run metadata) but the habit is worth keeping.
 */
function readCache(sweep: Sweep): CleanupRun[] | null {
  try {
    const raw = sessionStorage.getItem(`tip.cleanup.${sweep.id}`)
    if (!raw) return null
    const cached = JSON.parse(raw) as Cached
    if (Date.now() - cached.at > CACHE_TTL_MS) return null
    return cached.runs
  } catch {
    // Private browsing, a full quota, or a shape change. A cache miss is always
    // a safe answer, so none of those are worth surfacing.
    return null
  }
}

function writeCache(sweep: Sweep, runs: CleanupRun[]): void {
  try {
    sessionStorage.setItem(`tip.cleanup.${sweep.id}`, JSON.stringify({ at: Date.now(), runs }))
  } catch {
    // Ignore: the cache is an optimisation, not a requirement.
  }
}

export type SweepResult =
  | { ok: true; runs: CleanupRun[] }
  | { ok: false; reason: 'rate-limited' | 'unavailable' }

/**
 * `fetchImpl` is injectable so tests never touch the network. Everything above
 * this line is pure and tested directly.
 */
export async function fetchSweepRuns(
  sweep: Sweep,
  fetchImpl: typeof fetch = fetch,
): Promise<SweepResult> {
  const cached = readCache(sweep)
  if (cached) return { ok: true, runs: cached }

  try {
    const response = await fetchImpl(runsUrl(sweep), {
      headers: { Accept: 'application/vnd.github+json' },
    })

    // 403 with the remaining count at zero is GitHub's rate limit. Worth telling
    // apart from a genuine outage, because it is the one a visitor can cause and
    // the one that resolves on its own.
    if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
      return { ok: false, reason: 'rate-limited' }
    }
    if (!response.ok) return { ok: false, reason: 'unavailable' }

    const runs = parseRuns(await response.json())
    writeCache(sweep, runs)
    return { ok: true, runs }
  } catch {
    return { ok: false, reason: 'unavailable' }
  }
}
