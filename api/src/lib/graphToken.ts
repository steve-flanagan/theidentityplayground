import { ClientAssertionCredential, ManagedIdentityCredential } from '@azure/identity'

/**
 * A Microsoft Graph token for a tenant this app does not live in, held keyless.
 *
 * ── THE PROBLEM THIS SOLVES ──────────────────────────────────────────────────
 *
 * The Function App's identity lives in AlinaSF. The two demo tenants are
 * separate directories. Microsoft is explicit that "both the Microsoft Entra app
 * and managed identity must belong to the same tenant", so a managed identity
 * cannot federate straight into a foreign tenant's app registration — which is
 * what decision 003 originally read as a dead end.
 *
 * The same page states the supported way across, and it was tested on 27 July
 * 2026 and works in BOTH demo tenants: a MULTITENANT app registration in the
 * home tenant, with its service principal provisioned into the target tenant by
 * admin consent. See notes/next-build.md, "THE GATE".
 *
 * ── THE CHAIN ────────────────────────────────────────────────────────────────
 *
 *   user-assigned MI (id-idp-graph, home tenant)
 *     -> token for api://AzureADTokenExchange
 *     -> presented as a CLIENT ASSERTION for the multitenant app reg
 *     -> exchanged at the FOREIGN tenant's token endpoint
 *     -> app-only Graph token, scoped to that tenant
 *
 * No secret and no certificate at any hop. The federated credential on the app
 * registration trusts the MI's principal id, and that trust is the only thing
 * standing in for a credential.
 *
 * ── WHY USER-ASSIGNED, WHEN THE APP ALREADY HAD A SYSTEM-ASSIGNED ONE ────────
 *
 * Microsoft: "You can only use User-Assigned Managed Identities as a credential."
 * A system-assigned identity cannot be the subject of a federated credential.
 * The app now carries both. The system-assigned one still serves Table Storage
 * and Key Vault, and rateLimit.ts still reaches it through a bare
 * DefaultAzureCredential — App Service hands out the system-assigned identity
 * when no client id is specified, which is why that path did not break. THAT IS
 * ALSO WHY THE CLIENT ID BELOW IS NOT OPTIONAL: ask without it and you silently
 * get the wrong identity, and the assertion is rejected for a reason that does
 * not mention identities at all.
 */

// Identifiers, not secrets. Same stance the project takes on tenant and client
// ids everywhere else: they are public by design and live in app settings.
const UAMI_CLIENT_ID = process.env.GRAPH_UAMI_CLIENT_ID ?? ''
const APP_CLIENT_ID = process.env.GRAPH_APP_CLIENT_ID ?? ''

/**
 * The tenants this backend is allowed to ask for a token for, by name.
 *
 * AN ALLOWLIST, NOT A PASSTHROUGH. Any endpoint that lets a caller name a tenant
 * must resolve it through here. Taking a tenant id off a query string and putting
 * it in a token request turns this into something that will attempt an
 * authentication against any directory an anonymous caller names.
 */
export const TENANTS = {
  external: process.env.GRAPH_EXTERNAL_TENANT_ID ?? '',
  workforce: process.env.GRAPH_WORKFORCE_TENANT_ID ?? '',
} as const

export type TenantName = keyof typeof TENANTS

export function isTenantName(value: string): value is TenantName {
  return Object.prototype.hasOwnProperty.call(TENANTS, value)
}

// The MI's own token, which becomes the assertion. This audience is fixed by
// Microsoft and is not a resource you can call — it exists only to be exchanged.
const EXCHANGE_SCOPE = 'api://AzureADTokenExchange/.default'
const GRAPH_SCOPE = 'https://graph.microsoft.com/.default'

// One credential per process, built lazily. ManagedIdentityCredential caches the
// MI token internally, so the assertion callback is cheap on the warm path.
let mi: ManagedIdentityCredential | undefined
function assertion(): () => Promise<string> {
  return async () => {
    if (!UAMI_CLIENT_ID) throw new Error('GRAPH_UAMI_CLIENT_ID is not set')
    if (!mi) mi = new ManagedIdentityCredential({ clientId: UAMI_CLIENT_ID })
    const token = await mi.getToken(EXCHANGE_SCOPE)
    if (!token) throw new Error('the managed identity returned no exchange token')
    return token.token
  }
}

// One credential per tenant, memoised. ClientAssertionCredential does its own
// token caching, so rebuilding it per request would throw that away and mint a
// fresh app token on every call.
const credentials = new Map<TenantName, ClientAssertionCredential>()

export async function graphTokenFor(tenant: TenantName): Promise<string> {
  const tenantId = TENANTS[tenant]
  if (!tenantId) throw new Error(`no tenant id configured for "${tenant}"`)
  if (!APP_CLIENT_ID) throw new Error('GRAPH_APP_CLIENT_ID is not set')

  let credential = credentials.get(tenant)
  if (!credential) {
    credential = new ClientAssertionCredential(tenantId, APP_CLIENT_ID, assertion())
    credentials.set(tenant, credential)
  }

  const token = await credential.getToken(GRAPH_SCOPE)
  if (!token) throw new Error(`no Graph token issued for the ${tenant} tenant`)
  return token.token
}

export interface GraphResult {
  status: number
  body: unknown
}

/**
 * A GET against Graph in a foreign tenant. Returns the status alongside the body
 * rather than throwing on a non-2xx, because the interesting outcomes here ARE
 * the failures: whether app-only reads of auditLogs/signIns trip the premium
 * licence gate in an external tenant is unproven by any Microsoft document, and
 * the error code is the answer.
 */
export async function graphGet(tenant: TenantName, path: string): Promise<GraphResult> {
  const token = await graphTokenFor(tenant)
  const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { authorization: `Bearer ${token}` },
  })
  return { status: response.status, body: await response.json().catch(() => null) }
}
