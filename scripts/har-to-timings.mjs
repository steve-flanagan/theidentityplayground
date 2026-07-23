// Derive a safe, committable timings file from a HAR capture.
//
// ─────────────────────────────────────────────────────────────────────────────
// A HAR OF A SIGN-IN IS A CREDENTIAL DUMP. IT MUST NEVER BE COMMITTED.
//
// It contains the authorization code, the ID token, session cookies, and
// possibly the credential POST body. `.gitignore` blocks *.har, and GitHub's
// secret scanning would be right to scream if one ever landed.
//
// This takes one and throws away everything except what the timeline needs:
// method, URL path, status, and the phase timings. No headers. No cookies. No
// bodies. No query strings — the code and state live there. Nothing that comes
// out of here is a secret, which is the point of running it rather than
// hand-copying numbers out of devtools.
//
//   node scripts/har-to-timings.mjs <capture.har> <flow-id> [--from <ms>] [--to <ms>]
//     > web/src/lib/captures/<flow-id>.json
//
// The output is real measured data, recorded rather than live. That distinction
// matters and it is not a dodge: recorded-real and live-real are both real, and
// only fabricated is the problem. The site says which it is showing.
//
// ── ONE HAR CAN HOLD SEVERAL FLOWS ───────────────────────────────────────────
//
// A recording session is one browser tab, and a person sitting at it does more
// than one thing: sign in, probe, sign out, probe again. The browser writes all
// of it into a single HAR. Without a window this script folds four actions into
// one "flow" whose machineMs is the sum of things that never happened together
// — a fabricated number assembled out of real ones, which is worse than an
// obviously invented one because it looks measured.
//
// So: --from / --to slice one action out. Both are milliseconds from the FIRST
// entry in the HAR, which is the same zero the browser's network panel shows,
// so the numbers you read off devtools are the numbers you pass here. The
// filter is on when a request STARTED; a request that starts inside the window
// is kept whole, even if its response lands after --to. Truncating a request's
// own duration to fit a window would be inventing a shorter one.
//
// The window is recorded in the output so the slice is never a silent edit.
// ─────────────────────────────────────────────────────────────────────────────

import { readFile } from 'node:fs/promises'

const USAGE =
  'usage: node scripts/har-to-timings.mjs <capture.har> <flow-id> [--from <ms>] [--to <ms>]'

// Hand-rolled rather than a dependency: two flags, and this script is deliberately
// zero-install so it can be run against a credential dump without npm touching it.
const argv = process.argv.slice(2)
const positional = []
let fromMs = 0
let toMs = Infinity

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]
  if (arg === '--from' || arg === '--to') {
    const value = Number(argv[++i])
    if (!Number.isFinite(value) || value < 0) {
      console.error(`${arg} needs a non-negative number of milliseconds`)
      process.exit(1)
    }
    if (arg === '--from') fromMs = value
    else toMs = value
  } else if (arg.startsWith('--')) {
    console.error(`unknown flag ${arg}\n${USAGE}`)
    process.exit(1)
  } else {
    positional.push(arg)
  }
}

const [harPath, flowId] = positional

if (!harPath || !flowId) {
  console.error(USAGE)
  process.exit(1)
}

if (fromMs >= toMs) {
  console.error(`--from (${fromMs}) must be less than --to (${toMs})`)
  process.exit(1)
}

const har = JSON.parse(await readFile(harPath, 'utf8'))

if (!har.log?.entries?.length) {
  console.error('this HAR has no entries at all')
  process.exit(1)
}

/**
 * Only the hosts this journey is about. Everything else is noise.
 *
 * Three kinds of host matter: the CIAM tenant (ciamlogin), the workforce tenant
 * (login.microsoftonline.com, where Module 2's member and guest sign in), and our
 * own origin on the real site (the redirect landing). The localhost dev server is
 * deliberately NOT one of them. The member capture is taken through capture.html
 * on it, and a dev server's own timings — Vite compiling a module, the HMR
 * socket — are not representative of anything that ships. Entra's timings are the
 * same wherever the client runs, so dropping the localhost rows loses nothing real
 * and keeps a member sample from carrying a two-second bar that is pure dev noise.
 */
const isRelevant = (url) => {
  const u = new URL(url)
  const path = u.pathname
  // Static assets aren't steps in an auth flow. The bundle in particular is
  // named with a content hash that changes on every build, so keeping it would
  // bake a filename into the timeline that is wrong by the next deploy.
  if (/favicon|\.css$|\.svg$|\.ico$|\.js$|\.mjs$|\.woff2?$|\.map$/.test(path)) return false
  // Vite dev-server machinery: module requests, its client, the refresh runtime.
  // Present only in a localhost capture and never a step in the flow.
  if (/^\/@|^\/src\/|^\/node_modules\//.test(path)) return false
  // Entra's own telemetry and reporting, plus the user-flow form markup: real
  // requests, but not steps that advance the flow. perftrace and cspreport are
  // fire-and-forget reporting; the .cshtml is the sign-up form's HTML, not its
  // submit. (cspreport also carries the tenant NAME rather than the GUID, so it
  // would not templatize.)
  if (/\/perftrace\b|\/cspreport\b|\.cshtml$/.test(path)) return false
  // Entra, either tenant.
  if (/ciamlogin|login\.microsoftonline\.com/.test(u.host)) return true
  // Our own origin, but only on the real site. Localhost is a capture harness.
  return /theidentityplayground/.test(u.host)
}

/**
 * The capture's own zero — the first entry in the file, relevant or not. Using
 * the first *relevant* entry instead would make the window move whenever the
 * relevance filter changed, so the same --from would slice a different action.
 */
const captureStart = new Date(har.log.entries[0].startedDateTime).getTime()
const offsetOf = (e) => new Date(e.startedDateTime).getTime() - captureStart

const sliced = toMs !== Infinity || fromMs !== 0

const entries = har.log.entries.filter((e) => {
  const offset = offsetOf(e)
  return offset >= fromMs && offset <= toMs && isRelevant(e.request.url)
})

if (entries.length === 0) {
  console.error(
    sliced
      ? `no relevant entries between ${fromMs} ms and ${toMs} ms — widen the window or check it's the right capture`
      : 'no relevant entries — is this the right capture?',
  )
  process.exit(1)
}

const t0 = new Date(entries[0].startedDateTime).getTime()

/** Negative means "not applicable to this request" in the HAR spec. Drop those. */
const phase = (v) => (typeof v === 'number' && v > 0 ? Math.round(v) : 0)

let previousEnd = null
const requests = []

for (const e of entries) {
  const u = new URL(e.request.url)
  const startedAt = new Date(e.startedDateTime).getTime() - t0
  const total = Math.round(e.time)

  // The gap since the last response landed. Nothing was computing; a person was
  // typing. Recorded so the timeline can show it WITHOUT putting it on the
  // machine axis — it sits between requests, never inside one.
  const idleBefore = previousEnd === null ? 0 : Math.max(0, startedAt - previousEnd)
  previousEnd = startedAt + total

  // An OAuth error comes back in the redirect, not the status line — a silent
  // probe that finds no session is a 302, not a 4xx. Pull just the error CODE
  // out of the Location header; nothing else from it, because that header also
  // carries state and (on success) the authorization code.
  const location = (e.response.headers ?? []).find(
    (h) => h.name.toLowerCase() === 'location',
  )?.value
  const oauthError = location?.match(/[#&?]error=([^&]+)/)?.[1]

  requests.push({
    // Tenant GUID is public, but collapsing it keeps the labels readable. Both
    // Entra hosts carry it; our own origin does not, and is labelled SPA.
    path: /ciamlogin|login\.microsoftonline\.com/.test(u.host)
      ? u.pathname.replace(/\/[0-9a-f-]{36}(?=\/|$)/i, '/{tid}')
      : `SPA ${u.pathname}`,
    host: u.host,
    method: e.request.method,
    status: e.response.status,
    ...(oauthError ? { oauthError: decodeURIComponent(oauthError) } : {}),
    startedAt,
    total,
    idleBefore,
    timings: {
      blocked: phase(e.timings.blocked),
      dns: phase(e.timings.dns),
      connect: phase(e.timings.connect),
      ssl: phase(e.timings.ssl),
      send: phase(e.timings.send),
      wait: phase(e.timings.wait),
      receive: phase(e.timings.receive),
    },
  })
}

const machineMs = requests.reduce((a, r) => a + r.total, 0)
const wallMs = previousEnd

console.log(
  JSON.stringify(
    {
      flow: flowId,
      // When sliced, the page's start time is the start of the whole recording
      // — a different moment from this flow, sometimes by half a minute. The
      // slice's own first request is the honest answer to "when was this".
      capturedAt: sliced
        ? entries[0].startedDateTime
        : (har.log.pages?.[0]?.startedDateTime ?? entries[0].startedDateTime),
      note: 'Derived from a real HAR by scripts/har-to-timings.mjs. Timings only — no headers, cookies, bodies or query strings. The HAR itself is gitignored and must stay that way.',
      // Present only on a slice, and it is provenance: it says this flow was cut
      // out of a longer recording, and exactly where from.
      ...(sliced
        ? {
            window: {
              fromMs,
              toMs: toMs === Infinity ? null : toMs,
              note: 'Milliseconds from the first entry of the source HAR. One recording held several flows; this is one of them.',
            },
          }
        : {}),
      requestCount: requests.length,
      machineMs,
      wallMs,
      humanMs: wallMs - machineMs,
      requests,
    },
    null,
    2,
  ),
)
