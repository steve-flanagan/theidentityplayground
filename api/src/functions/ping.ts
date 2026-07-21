import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions'
import { withRateLimit } from '../lib/rateLimit'

/**
 * A throttled no-op that exists only to prove the rate limiter works end to end
 * before any real capability sits behind it. It touches no tenant and holds no
 * secret. The limit is deliberately low so a short curl loop trips the 429.
 *
 * Remove this once a genuine Graph- or mail-reaching endpoint exercises
 * withRateLimit() in production — it is scaffolding, not a feature.
 */
async function ping(_request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> {
  return { jsonBody: { pong: true } }
}

app.http('ping', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: withRateLimit(ping, { limit: 5, windowSeconds: 60 }),
})
