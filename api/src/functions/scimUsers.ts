import {
  app,
  type HttpRequest,
  type HttpResponseInit,
  type InvocationContext,
} from '@azure/functions'
import { withRateLimit } from '../lib/rateLimit'
import { recordEvent } from '../lib/scim/events'
import { isAuthorised } from '../lib/scim/auth'
import { applyPatch } from '../lib/scim/patch'
import {
  createUser,
  deleteUser,
  findByUserName,
  getUser,
  listUsers,
  replaceUser,
} from '../lib/scim/store'
import {
  SCHEMA_LIST_RESPONSE,
  SCHEMA_USER,
  scimError,
  scimResponse,
  type ScimListResponse,
  type ScimUser,
} from '../lib/scim/types'

/**
 * The /Users half of a SCIM 2.0 endpoint, written to RFC 7644 rather than to any
 * one client. Microsoft Entra provisions to it; so can Okta, unchanged.
 *
 * ── WHAT MICROSOFT ACTUALLY REQUIRES ─────────────────────────────────────────
 *
 * Verified against use-scim-to-provision-users-and-groups (ms.date 2025-10-06,
 * updated 2026-07-24), not from memory. The must-support list is: create users;
 * modify with PATCH; retrieve a known resource; query by userName and
 * externalId; support listing and PAGINATION; soft-delete via active=false with
 * the user still returned on GET; support /Schemas; accept a single bearer
 * token. Groups are optional — "only one is required" — and this implements
 * /Users, so /Groups is deliberately absent rather than missing.
 *
 * ── THE PAGE THAT SURPRISES PEOPLE ───────────────────────────────────────────
 *
 * "/scim" must appear in the root of the endpoint URL. [M] The Functions route
 * prefix is /api, so the tenant URL is .../api/scim and the requirement holds.
 *
 * ── ON RATE LIMITING A PROVISIONING TARGET ───────────────────────────────────
 *
 * Deliberately loose. Every other endpoint here is throttled to single digits
 * per window; this one is called by a sync engine that batches, and a limit
 * tuned for a browser would present as a provisioning failure with a
 * quarantined job at the other end. The real gate on this endpoint is the
 * bearer token, and nothing touches storage before it is checked. The limiter
 * is here to bound an unauthenticated flood, not to shape legitimate traffic.
 */

const LIMIT = 300
const WINDOW_SECONDS = 60

/** The RFC's default page size when a client does not ask for one. */
const DEFAULT_COUNT = 100

/** `.../api/scim`, derived from the request so it is right in every environment
 *  rather than configured in one and wrong in the other. `meta.location` and the
 *  Location header both have to be absolute and resolvable by the client. */
function baseUrl(request: HttpRequest): string {
  const url = new URL(request.url)
  const root = url.pathname.slice(0, url.pathname.toLowerCase().indexOf('/scim') + '/scim'.length)
  return `${url.origin}${root}`
}

/**
 * Entra's match step sends `filter=userName eq "value"`. The spec allows a
 * grammar far larger than that, and implementing the rest of it would be
 * building for a client nobody has. Handles userName and externalId, the two
 * Microsoft documents as the query attributes, and returns null for anything
 * else so the caller can answer 400 rather than silently listing everything —
 * which is the dangerous failure, since an unrecognised filter that falls
 * through to "return all users" is how a provisioning engine decides every user
 * already exists.
 */
function parseFilter(filter: string): { attribute: 'userName' | 'externalId'; value: string } | null {
  const match = /^\s*(userName|externalId)\s+eq\s+"(.*)"\s*$/i.exec(filter)
  if (!match) return null
  const attribute = match[1].toLowerCase() === 'username' ? 'userName' : 'externalId'
  return { attribute, value: match[2] }
}

function readBodyUser(body: unknown): (Partial<ScimUser> & { userName: string }) | null {
  const b = body as Partial<ScimUser> | null
  if (!b || typeof b !== 'object' || typeof b.userName !== 'string' || !b.userName) return null
  return {
    userName: b.userName,
    externalId: typeof b.externalId === 'string' ? b.externalId : undefined,
    displayName: typeof b.displayName === 'string' ? b.displayName : undefined,
    name: b.name,
    emails: Array.isArray(b.emails) ? b.emails : undefined,
    active: typeof b.active === 'boolean' ? b.active : undefined,
  }
}

/**
 * Records the exchange, then answers exactly as it would have.
 *
 * ── WHY A WRAPPER AND NOT A LINE IN EACH BRANCH ──────────────────────────────
 *
 * The handler below has eleven return points. Recording at each one guarantees a
 * future branch that forgets, and the branch most likely to be added in a hurry
 * is an error path — which is the one worth seeing.
 *
 * The request body is read from a CLONE. An HttpRequest body is a stream and can
 * be consumed once; reading it here would leave the handler with nothing, which
 * would turn "show me the traffic" into "break the endpoint that produces it".
 *
 * Recording never affects the response. recordEvent does not throw by
 * construction, and this wrapper does not await anything that could change what
 * Entra receives.
 *
 * InitHandler is narrower than HttpHandler on purpose: HttpHandler may return a
 * full HttpResponse, which has no readable `jsonBody`, so the wider type would
 * force a cast just to record the body.
 */
type InitHandler = (
  request: HttpRequest,
  context: InvocationContext,
) => Promise<HttpResponseInit>

function recorded(inner: InitHandler): InitHandler {
  return async (request: HttpRequest, context: InvocationContext) => {
    let raw = ''
    try {
      raw = await request.clone().text()
    } catch {
      // No body, or a runtime without clone(). The exchange is still worth
      // recording without it.
    }

    const response = await inner(request, context)

    const url = new URL(request.url)
    await recordEvent({
      at: new Date().toISOString(),
      method: request.method,
      // Path and query only. The origin is noise and the query carries the
      // filter, which is the interesting half of Entra's match step.
      path: `${url.pathname}${url.search}`,
      status: response.status ?? 200,
      requestBody: raw,
      responseSummary:
        response.jsonBody === undefined ? '' : JSON.stringify(response.jsonBody, null, 2),
    })

    return response
  }
}

async function handler(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  if (!(await isAuthorised(request))) {
    return {
      status: 401,
      headers: { 'www-authenticate': 'Bearer', 'content-type': 'application/scim+json' },
      jsonBody: { schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], status: '401' },
    }
  }

  const base = baseUrl(request)
  const id = request.params.id

  try {
    // ── Collection ──────────────────────────────────────────────────────────
    if (!id) {
      if (request.method === 'GET') {
        const filter = request.query.get('filter')
        if (filter) {
          const parsed = parseFilter(filter)
          if (!parsed) {
            return scimError(400, `unsupported filter: ${filter}`, 'invalidFilter')
          }
          // externalId is not indexed separately; the store keys on userName and
          // externalId is carried alongside. Only userName has a server-side
          // lookup because that is the one Entra issues per user per cycle.
          const found =
            parsed.attribute === 'userName'
              ? await findByUserName(parsed.value, base)
              : (await listUsers(1, 1000, base)).resources.find(
                  (u) => u.externalId === parsed.value,
                ) ?? null

          // A match query that finds nothing is NOT a 404. It is an empty list,
          // and the difference decides whether the client creates the user or
          // gives up. Returning 404 here is the classic way to make a SCIM
          // endpoint provision nobody.
          const body: ScimListResponse = {
            schemas: [SCHEMA_LIST_RESPONSE],
            totalResults: found ? 1 : 0,
            itemsPerPage: found ? 1 : 0,
            startIndex: 1,
            Resources: found ? [found] : [],
          }
          return scimResponse(200, body)
        }

        const startIndex = Number(request.query.get('startIndex') ?? '1') || 1
        const count = Number(request.query.get('count') ?? String(DEFAULT_COUNT)) || DEFAULT_COUNT
        const { resources, total } = await listUsers(startIndex, count, base)
        const body: ScimListResponse = {
          schemas: [SCHEMA_LIST_RESPONSE],
          totalResults: total,
          itemsPerPage: resources.length,
          startIndex,
          Resources: resources,
        }
        return scimResponse(200, body)
      }

      if (request.method === 'POST') {
        const input = readBodyUser(await request.json().catch(() => null))
        if (!input) return scimError(400, 'userName is required', 'invalidValue')

        // RFC 7644 §3.3: a duplicate unique attribute is 409 with scimType
        // "uniqueness". Entra treats that as "already exists, switch to update"
        // rather than as an error, so getting it wrong turns a benign race into
        // a failed cycle.
        const existing = await findByUserName(input.userName, base)
        if (existing) {
          return scimError(409, `userName ${input.userName} already exists`, 'uniqueness')
        }

        const created = await createUser(input, base)
        context.log(`scim: created ${created.id} (${created.userName})`)
        return scimResponse(201, created, created.meta.location)
      }

      return scimError(405, `${request.method} not allowed on /Users`)
    }

    // ── Single resource ─────────────────────────────────────────────────────
    const current = await getUser(id, base)

    if (request.method === 'GET') {
      if (!current) return scimError(404, `user ${id} not found`)
      return scimResponse(200, current)
    }

    if (request.method === 'PATCH') {
      if (!current) return scimError(404, `user ${id} not found`)
      const outcome = applyPatch(current, await request.json().catch(() => null))
      const saved = await replaceUser(outcome.user)
      // Logged because the ignored list is how you find out a client is sending
      // an attribute nobody mapped, without failing its cycle to tell you.
      context.log(
        `scim: patched ${id} applied=[${outcome.applied.join(',')}] ignored=[${outcome.ignored.join(',')}] active=${saved.active}`,
      )
      return scimResponse(200, saved)
    }

    if (request.method === 'PUT') {
      if (!current) return scimError(404, `user ${id} not found`)
      const input = readBodyUser(await request.json().catch(() => null))
      if (!input) return scimError(400, 'userName is required', 'invalidValue')
      const saved = await replaceUser({
        ...current,
        userName: input.userName,
        externalId: input.externalId,
        displayName: input.displayName,
        name: input.name,
        emails: input.emails,
        active: input.active ?? current.active,
        schemas: [SCHEMA_USER],
      })
      return scimResponse(200, saved)
    }

    if (request.method === 'DELETE') {
      // Hard delete. Entra's normal deprovision is PATCH active=false and this
      // is only reached if deletion is explicitly enabled on the mapping.
      const removed = await deleteUser(id)
      if (!removed) return scimError(404, `user ${id} not found`)
      context.log(`scim: deleted ${id}`)
      return { status: 204 }
    }

    return scimError(405, `${request.method} not allowed on /Users/{id}`)
  } catch (err) {
    context.error('scim: unhandled error', err)
    // Never echo the error text. It can carry storage account names, table
    // names and query fragments, and this endpoint answers the public internet.
    return scimError(500, 'internal error')
  }
}

app.http('scim-users', {
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  authLevel: 'anonymous', // The bearer token is the gate. See scim/auth.ts.
  route: 'scim/Users/{id?}',
  // recorded() innermost, so the rate limiter's own 429s are NOT written to the
  // transcript. Those are us defending ourselves, not Entra talking to us, and
  // mixing them in would make the protocol story harder to read.
  handler: withRateLimit(recorded(handler), { limit: LIMIT, windowSeconds: WINDOW_SECONDS }),
})
