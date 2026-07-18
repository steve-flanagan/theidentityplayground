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
//   node scripts/har-to-timings.mjs <capture.har> <flow-id> > web/src/lib/captures/<flow-id>.json
//
// The output is real measured data, recorded rather than live. That distinction
// matters and it is not a dodge: recorded-real and live-real are both real, and
// only fabricated is the problem. The site says which it is showing.
// ─────────────────────────────────────────────────────────────────────────────

import { readFile } from 'node:fs/promises'

const [, , harPath, flowId] = process.argv

if (!harPath || !flowId) {
  console.error('usage: node scripts/har-to-timings.mjs <capture.har> <flow-id>')
  process.exit(1)
}

const har = JSON.parse(await readFile(harPath, 'utf8'))

/** Only the hosts this journey is about. Everything else is noise. */
const isRelevant = (url) => {
  const u = new URL(url)
  if (!/ciamlogin|theidentityplayground/.test(u.host)) return false
  // Static assets aren't steps in an auth flow. The bundle in particular is
  // named with a content hash that changes on every build, so keeping it would
  // bake a filename into the timeline that is wrong by the next deploy.
  return !/favicon|\.css$|\.svg$|\.ico$|\.js$|\.woff2?$/.test(u.pathname)
}

const entries = har.log.entries.filter((e) => isRelevant(e.request.url))
if (entries.length === 0) {
  console.error('no relevant entries — is this the right capture?')
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
    // Tenant GUID is public, but collapsing it keeps the labels readable.
    path: u.host.includes('ciamlogin')
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
      capturedAt: har.log.pages?.[0]?.startedDateTime ?? entries[0].startedDateTime,
      note: 'Derived from a real HAR by scripts/har-to-timings.mjs. Timings only — no headers, cookies, bodies or query strings. The HAR itself is gitignored and must stay that way.',
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
