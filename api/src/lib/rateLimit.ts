import {
  type HttpHandler,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions'
import { TableClient } from '@azure/data-tables'
import { DefaultAzureCredential } from '@azure/identity'

/**
 * Per-IP rate limiting for the Graph- and mail-reaching endpoints this backend
 * will grow. It ships BEFORE any of them on purpose: the moment an endpoint that
 * reaches a tenant goes live, the Phase 0.5 gate requires this to already be here
 * (spec section 4 item 2; decision 006). The health probe stays exempt; anything
 * with real capability wraps its handler in withRateLimit().
 *
 * The counter lives in Table Storage, not in memory, because the consumption plan
 * scales out to several instances and an in-memory counter would let the real
 * limit multiply by the instance count. Auth to the table is the Function App's
 * managed identity (DefaultAzureCredential), so there is no connection string and
 * no secret anywhere in this path — the only stored credential the runtime uses is
 * its own AzureWebJobsStorage key in app settings, which never touches the repo.
 */

// Set by the provisioning script. The endpoint is a public URL, not a secret.
const TABLE_ENDPOINT = process.env.RATE_LIMIT_TABLE_ENDPOINT ?? ''
const TABLE_NAME = process.env.RATE_LIMIT_TABLE_NAME ?? 'RateLimit'

// One client for the process. DefaultAzureCredential resolves to the Function
// App's managed identity in Azure and to `az login` when run locally, so the same
// keyless code path works in both places.
let client: TableClient | undefined
function table(): TableClient {
  if (!client) {
    if (!TABLE_ENDPOINT) throw new Error('RATE_LIMIT_TABLE_ENDPOINT is not set')
    client = new TableClient(TABLE_ENDPOINT, TABLE_NAME, new DefaultAzureCredential())
  }
  return client
}

// The counter table is created on first use rather than by the provisioning
// script, so the app owns its own storage and a recreated storage account
// self-heals. createTable() returns 409 if the table already exists, which is
// success here. A failed attempt clears the memo so a later call retries,
// rather than wedging the limiter closed forever on a transient blip.
let ensured: Promise<void> | undefined
function ensureTable(t: TableClient): Promise<void> {
  if (!ensured) {
    ensured = t.createTable().then(
      () => undefined,
      (err: any) => {
        if (err?.statusCode === 409) return // already exists
        ensured = undefined // let a later call retry
        throw err
      },
    )
  }
  return ensured
}

// Table keys forbid \ / # ? and control characters. IPv6 uses ':', which is
// allowed, but encode defensively so no address can ever produce an invalid key.
function ipKey(ip: string): string {
  return ip.replace(/[^a-zA-Z0-9.:_-]/g, '_')
}

export function clientIp(request: HttpRequest): string {
  // Behind the Functions front end the caller's own address is the first hop of
  // x-forwarded-for; request.ip would be the platform's. Strip any :port.
  const first = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return first ? first.replace(/:\d+$/, '') : 'unknown'
}

export interface RateLimitResult {
  allowed: boolean
  limit: number
  remaining: number
  resetSeconds: number
}

// Fixed window. The window id is floor(now / window), so every caller in the same
// wall-clock window shares one counter row and the limit is global across
// instances rather than per-instance.
async function hit(ip: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000)
  const windowStart = Math.floor(now / windowSeconds) * windowSeconds
  const resetSeconds = windowStart + windowSeconds - now
  const partitionKey = ipKey(ip)
  const rowKey = String(windowStart)
  const t = table()
  await ensureTable(t) // create the counter table on first use; 409 = already there

  // A small optimistic-concurrency loop: read the counter, write the increment
  // guarded by its ETag, and retry if another instance beat us to it.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const existing = await t.getEntity(partitionKey, rowKey)
      const count = (existing.count as number) ?? 0
      if (count >= limit) return { allowed: false, limit, remaining: 0, resetSeconds }
      await t.updateEntity(
        { partitionKey, rowKey, count: count + 1 },
        'Replace',
        { etag: existing.etag },
      )
      return { allowed: true, limit, remaining: limit - (count + 1), resetSeconds }
    } catch (err: any) {
      if (err?.statusCode === 404) {
        // First hit this window. Create the row; if two instances race the
        // create, the loser gets 409 and falls back into the update branch.
        try {
          await t.createEntity({ partitionKey, rowKey, count: 1 })
          return { allowed: true, limit, remaining: limit - 1, resetSeconds }
        } catch (createErr: any) {
          if (createErr?.statusCode === 409) continue
          throw createErr
        }
      }
      if (err?.statusCode === 412) continue // ETag conflict — re-read and retry
      throw err
    }
  }
  // Too much contention to settle in five tries. Treat as over-limit rather than
  // let an unbounded stream through.
  return { allowed: false, limit, remaining: 0, resetSeconds }
}

export interface RateLimitOptions {
  limit: number
  windowSeconds: number
  // These endpoints reach a tenant or send mail, so a limiter outage should fail
  // closed (503) rather than wave traffic through. Flip only for probes.
  failClosed?: boolean
}

/**
 * Wrap a handler so it is rate limited per client IP. The handler runs only if
 * the caller is under the limit; otherwise it never executes and the caller gets
 * a 429 with Retry-After. Successful responses carry RateLimit-* headers.
 */
export function withRateLimit(handler: HttpHandler, options: RateLimitOptions): HttpHandler {
  const { limit, windowSeconds, failClosed = true } = options
  return async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
    const ip = clientIp(request)

    let result: RateLimitResult
    try {
      result = await hit(ip, limit, windowSeconds)
    } catch (err) {
      context.error('rate limiter unavailable', err)
      // Fail closed for real endpoints; a probe can opt out with failClosed:false.
      if (failClosed) return { status: 503, jsonBody: { error: 'rate limiter unavailable' } }
      return handler(request, context)
    }

    const rlHeaders: Record<string, string> = {
      'RateLimit-Limit': String(result.limit),
      'RateLimit-Remaining': String(result.remaining),
      'RateLimit-Reset': String(result.resetSeconds),
    }

    if (!result.allowed) {
      return {
        status: 429,
        headers: { ...rlHeaders, 'Retry-After': String(result.resetSeconds) },
        jsonBody: { error: 'rate limit exceeded' },
      }
    }

    const response = await handler(request, context)
    return {
      ...response,
      headers: { ...(response.headers as Record<string, string> | undefined), ...rlHeaders },
    }
  }
}
