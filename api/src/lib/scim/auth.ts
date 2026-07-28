import { SecretClient } from '@azure/keyvault-secrets'
import { DefaultAzureCredential } from '@azure/identity'
import { timingSafeEqual } from 'node:crypto'
import type { HttpRequest } from '@azure/functions'

/**
 * Bearer-token authentication for the SCIM endpoint.
 *
 * ── THIS IS THE ONE STORED SECRET IN THE PROJECT, AND IT DOES NOT BREAK THE
 *    KEYLESS STORY ─────────────────────────────────────────────────────────────
 *
 * Everything else here holds no credential: CI deploys by OIDC, the cleanup
 * sweeps federate from GitHub, and cross-tenant Graph exchanges a managed
 * identity token for an app token (ADR 012). This one is different and the
 * distinction is worth being precise about rather than apologising for.
 *
 * It is an INBOUND credential. Microsoft Entra presents it to US to prove it is
 * the provisioning service; we do not present it to anyone. The keyless posture
 * is about credentials this system holds in order to reach other systems, and
 * that count is still zero.
 *
 * Microsoft does document a keyless alternative — Workload Identity Federation
 * for SCIM provisioning, where Entra presents a short-lived signed JWT instead
 * of a stored token. It is gallery-only: "after submitting your request for
 * publishing your app in the gallery, our team will work with you to enable this
 * method." [M] use-scim-to-provision-users-and-groups, ms.date 2025-10-06,
 * updated 2026-07-24. A non-gallery app cannot use it, so a bearer token is the
 * only option available here, not the lazy one.
 *
 * The token lives in Key Vault, read by the Function App's system-assigned
 * managed identity, which already holds Key Vault Secrets User. It is never in
 * the repo, never in app settings, and never in a log.
 */

const VAULT_URL = process.env.KEY_VAULT_URL ?? ''
const SECRET_NAME = process.env.SCIM_TOKEN_SECRET_NAME ?? 'scim-bearer-token'

// Memoised for the life of the process. A Key Vault round trip per SCIM request
// would add latency to every provisioning call for a value that changes when
// Steve rotates it, which is to say approximately never. A restart re-reads it.
let cached: string | undefined
async function expectedToken(): Promise<string> {
  if (cached) return cached
  if (!VAULT_URL) throw new Error('KEY_VAULT_URL is not set')
  const client = new SecretClient(VAULT_URL, new DefaultAzureCredential())
  const secret = await client.getSecret(SECRET_NAME)
  if (!secret.value) throw new Error(`secret ${SECRET_NAME} has no value`)
  cached = secret.value
  return cached
}

/**
 * Constant-time comparison. A plain `===` on a bearer token leaks its prefix
 * through response timing, one character at a time. timingSafeEqual throws on a
 * length mismatch, so lengths are compared first and unequal lengths simply fail
 * — the length of the token is not the secret.
 */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

export async function isAuthorised(request: HttpRequest): Promise<boolean> {
  const header = request.headers.get('authorization') ?? ''
  const [scheme, presented] = header.split(' ')
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !presented) return false
  try {
    return safeEqual(presented.trim(), await expectedToken())
  } catch {
    // Vault unreachable or the secret missing. FAIL CLOSED. An endpoint that
    // creates and deletes directory objects must never fall open because a
    // dependency blinked.
    return false
  }
}
