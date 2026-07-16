import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions'

/**
 * Phase 0 health check. Exists to prove the Functions toolchain builds, starts,
 * and answers — nothing more. It touches no tenant and holds no secrets.
 *
 * `authLevel: 'anonymous'` is correct for this endpoint specifically: it's a
 * liveness probe that reveals nothing. It is NOT the default to copy for the
 * Graph-backed functions that come later — those carry real capability and need
 * auth plus the rate limiting in spec section 4.
 */
export async function health(
  _request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  context.log('health check')

  return {
    jsonBody: {
      status: 'ok',
      phase: 0,
      // Deliberately not reporting version, host, or environment details.
      // A health endpoint on a public site is reconnaissance surface; it should
      // answer "am I up" and nothing else.
    },
  }
}

app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: health,
})
