import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions'
import { withRateLimit } from '../lib/rateLimit'
import { listUsers } from '../lib/scim/store'

/**
 * The downstream app's own view of what it has been provisioned, for the page to
 * render. Public, because everything in it is synthetic.
 *
 * ── WHY NOT JUST CALL /api/scim/Users ────────────────────────────────────────
 *
 * That endpoint requires the bearer token Entra presents, and a browser cannot
 * hold it. Shipping it to the client would hand every visitor the credential
 * that authorises writing to the store. So the page reads through here instead,
 * and this endpoint returns a fixed, explicitly-listed set of fields rather than
 * whatever the store happens to contain.
 *
 * ── WHY THIS IS SAFE TO SERVE ANONYMOUSLY, STATED RATHER THAN ASSUMED ────────
 *
 * Every row in this table describes a demo employee that THIS BACKEND invented.
 * Display names come from a fixed list in hire.ts, the UPN is generated, and no
 * visitor input reaches either. There is no real person behind any row, which is
 * exactly why the hire flow refuses caller-supplied names — that decision is
 * what makes this endpoint publishable.
 *
 * That reasoning does NOT transfer to the Admin's View. Its rows describe real
 * visitors and carry addresses, IPs and coordinates; the spec's Module 6 privacy
 * rule governs those and requires a server-side allowlist. Do not read this
 * endpoint as a precedent for that one.
 *
 * The allowlist below is still built field by field rather than by deleting keys
 * off the stored row, so a column added to the store later does not silently
 * start being served.
 */

// Generous. It is a read of a handful of rows, and the page polls it after a
// hire to watch the row appear.
const LIMIT = 60
const WINDOW_SECONDS = 60

/** All of them. The store is bounded by the expiry timer, not by paging. */
const MAX_ROWS = 200

/**
 * ── NO-STORE, AND IT IS NOT BOILERPLATE ──────────────────────────────────────
 *
 * Neither read endpoint sent a Cache-Control header, and a bare 200 on a GET is
 * an invitation: browsers apply heuristic caching to responses that do not say
 * otherwise. The page calls both of these on a three-second poll and calls them
 * "live".
 *
 * Caught on 30 July by a debug run that fetched this URL twice, four seconds
 * apart, either side of a hire, and got an identical stale body both times —
 * while the store demonstrably held the new rows. The transcript and the call
 * ticker were both reading a frozen copy on the live site.
 *
 * A poll against a cacheable URL is not a poll. no-store, explicitly.
 */
async function feed(request: HttpRequest): Promise<HttpResponseInit> {
  const base = new URL(request.url).origin
  const { resources, total } = await listUsers(1, MAX_ROWS, base)

  return {
    headers: { 'cache-control': 'no-store' },
    jsonBody: {
      total,
      employees: resources.map((u) => ({
        id: u.id,
        displayName: u.displayName ?? null,
        userName: u.userName,
        active: u.active,
        created: u.meta.created,
        // The field that made the first deprovision failure visible: a row whose
        // lastModified equals its created has never been touched since it was
        // provisioned. Worth showing for the same reason it was worth reading.
        lastModified: u.meta.lastModified,
      })),
    },
  }
}

app.http('scim-feed', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'scim-demo/feed',
  handler: withRateLimit(feed, { limit: LIMIT, windowSeconds: WINDOW_SECONDS }),
})
