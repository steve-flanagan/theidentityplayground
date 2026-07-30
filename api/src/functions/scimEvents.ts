import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions'
import { withRateLimit } from '../lib/rateLimit'
import { listEvents } from '../lib/scim/events'

/**
 * The transcript: what Entra actually sent this endpoint, newest first.
 *
 * This is the part of Module 5 that makes it evidence rather than a screenshot.
 * A name appearing on a card proves nothing to anyone who does this for a living.
 * The match query issued before every create, and the exact shape of the PATCH
 * that disables someone, are the things worth looking at — and the PATCH is the
 * headline, because it does not follow the specification Microsoft asks you to
 * implement.
 *
 * Public for the same reason the feed is, and the reason is specific rather than
 * general: every body in here describes an employee this backend invented, from a
 * fixed list of names, with no visitor input anywhere in the path. NO HEADERS are
 * recorded, so the bearer token Entra presents is not in the store to leak.
 */

// The page polls this. Generous enough for a few seconds' cadence with several
// people watching, low enough to bound a scraper.
const LIMIT = 120
const WINDOW_SECONDS = 60

/** Enough to show a full hire-and-leave cycle several times over. The store is
 *  bounded by the expiry timer, not by this. */
const MAX_EVENTS = 40

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
async function events(_request: HttpRequest): Promise<HttpResponseInit> {
  return {
    headers: { 'cache-control': 'no-store' },
    jsonBody: { events: await listEvents(MAX_EVENTS) },
  }
}

app.http('scim-events', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'scim-demo/events',
  handler: withRateLimit(events, { limit: LIMIT, windowSeconds: WINDOW_SECONDS }),
})
