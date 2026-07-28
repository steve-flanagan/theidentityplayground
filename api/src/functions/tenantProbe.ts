import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions'
import { withRateLimit } from '../lib/rateLimit'
import { graphGet, isTenantName, TENANTS } from '../lib/graphToken'

/**
 * SCAFFOLDING. Proves the cross-tenant credential chain reaches Graph, and
 * answers one open question while it is at it. Delete it once the Admin's View
 * or SCIM exercises graphToken.ts in production — it is a probe, not a feature.
 *
 * ── WHAT IT IS FOR ───────────────────────────────────────────────────────────
 *
 * Two things were configured on 27 July 2026 and neither was ever observed
 * working, which on this project is not the same as working:
 *
 *   1. The MI -> assertion -> foreign-tenant app token exchange. Admin consent
 *      succeeded in both demo tenants and the service principals exist, but
 *      nothing has since asked for a token with them. A consent screen is not a
 *      token.
 *   2. Whether an APP-ONLY read of auditLogs/signIns works in the External ID
 *      tenant. A delegated read as Global Admin returned rows, so the premium
 *      gate did not fire there. Production runs app-only and that gate has
 *      behaved differently across the two paths before. External tenants also
 *      report their licence as Free, which is exactly what a premium check would
 *      look at.
 *
 * A failure here is as useful as a success. `Authentication_RequestFromNonPremium
 * TenantOrB2CTenant` from the external tenant means the Admin's View is workforce
 * only and Conditional Access needs rethinking too.
 *
 * ── IT RETURNS NO PERSONAL DATA, BY CONSTRUCTION ─────────────────────────────
 *
 * The response carries a count, one timestamp and Graph's status code. Not a row,
 * not a field off a row. This endpoint is anonymous and the sign-in log holds
 * other people's addresses, IPs and coordinates — so rather than write a
 * redaction step that a later edit could quietly undo, it never reads the rows at
 * all. The redaction rules for the module that WILL read them are in the spec,
 * Module 6, "Privacy rule".
 *
 *   GET /api/tenant-probe?tenant=external
 *   GET /api/tenant-probe?tenant=workforce
 */

// Deliberately mean. Every call mints or reuses an app token and hits Graph in
// somebody else's directory; this is a diagnostic, not something to poll.
const LIMIT = 5
const WINDOW_SECONDS = 300

async function tenantProbe(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const requested = request.query.get('tenant') ?? 'external'

  // Resolved through the allowlist in graphToken.ts, never used as a tenant id.
  // An anonymous caller must not be able to point this at an arbitrary directory.
  if (!isTenantName(requested)) {
    return {
      status: 400,
      jsonBody: { error: 'unknown tenant', allowed: Object.keys(TENANTS) },
    }
  }

  try {
    // $top=1 for the same reason the interactive testing settled on it: large
    // page sizes against this collection were slow to the point of hanging.
    const { status, body } = await graphGet(requested, '/auditLogs/signIns?$top=1')
    const rows = Array.isArray((body as any)?.value) ? (body as any).value : []

    return {
      jsonBody: {
        tenant: requested,
        // The chain produced a token, or graphGet would have thrown before the
        // request. This is the answer to question 1 and it is true even on a 403.
        tokenAcquired: true,
        graphStatus: status,
        rows: rows.length,
        // One timestamp. It is the site's own log, it identifies nobody, and it
        // is the only way to see the ingestion lag from outside a browser.
        newest: rows[0]?.createdDateTime ?? null,
        // Present only on failure, and it is the point of the probe.
        graphError: status >= 400 ? ((body as any)?.error?.code ?? 'unknown') : null,
      },
    }
  } catch (err: any) {
    // The exchange itself failed: no token was ever issued. Log the detail for
    // the operator and return only the shape, since an assertion failure can
    // echo identifiers back in its message.
    context.error('cross-tenant token exchange failed', err)
    return {
      status: 502,
      jsonBody: {
        tenant: requested,
        tokenAcquired: false,
        error: 'token exchange failed, see function logs',
      },
    }
  }
}

app.http('tenant-probe', {
  methods: ['GET'],
  authLevel: 'anonymous',
  handler: withRateLimit(tenantProbe, { limit: LIMIT, windowSeconds: WINDOW_SECONDS }),
})
