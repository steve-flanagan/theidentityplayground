// Client-side JWT decoding for display.
//
// ⚠️ THIS DOES NOT VERIFY THE SIGNATURE, AND THAT IS DELIBERATE.
//
// The UI says so out loud, because it's the most useful thing this module can
// teach. Decoding proves nothing about authenticity — anyone can hand-craft a
// JWT with any claims they like. A token is only trustworthy once its signature
// is verified against the issuer's published keys (the jwks_uri in the OIDC
// discovery document), and that verification belongs on a server, not in a
// browser where the attacker controls the runtime.
//
// So: this is a viewer, not a validator. We display a token the user just
// received through MSAL, which already validated it. We are not making a trust
// decision here — we're showing them what they were handed.

export type DecodedJwt = {
  header: Record<string, unknown>
  payload: Record<string, unknown>
  /** The signature segment, shown but never checked. */
  signature: string
  raw: string
}

export class JwtDecodeError extends Error {}

/**
 * base64url → string. Not the same as base64: the alphabet swaps +/ for -_
 * and padding is dropped. Feeding base64url straight to atob() fails on
 * exactly the tokens that happen to contain those characters — an
 * intermittent bug that looks like "sometimes tokens are corrupt".
 */
function base64UrlDecode(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')

  const binary = atob(padded)

  // atob yields a binary string, one byte per char. Claims can contain
  // non-ASCII (names, for instance), so decode the bytes as UTF-8 rather than
  // trusting the binary string — otherwise "José" arrives mangled.
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder('utf-8').decode(bytes)
}

export function decodeJwt(token: string): DecodedJwt {
  const parts = token.split('.')
  if (parts.length !== 3) {
    throw new JwtDecodeError(
      `Expected 3 dot-separated segments, got ${parts.length}. This may be an opaque token rather than a JWT.`,
    )
  }

  const [headerSeg, payloadSeg, signature] = parts

  let header: Record<string, unknown>
  let payload: Record<string, unknown>
  try {
    header = JSON.parse(base64UrlDecode(headerSeg))
  } catch {
    throw new JwtDecodeError('Header segment is not valid base64url-encoded JSON.')
  }
  try {
    payload = JSON.parse(base64UrlDecode(payloadSeg))
  } catch {
    throw new JwtDecodeError('Payload segment is not valid base64url-encoded JSON.')
  }

  return { header, payload, signature, raw: token }
}

/** Unix seconds → readable local time, with relative context. */
export function formatTimeClaim(value: unknown): string | null {
  if (typeof value !== 'number') return null
  const date = new Date(value * 1000)
  if (Number.isNaN(date.getTime())) return null

  const deltaMs = date.getTime() - Date.now()
  const mins = Math.round(Math.abs(deltaMs) / 60000)
  const rel =
    mins < 1
      ? 'just now'
      : deltaMs > 0
        ? `in ${mins} min${mins === 1 ? '' : 's'}`
        : `${mins} min${mins === 1 ? '' : 's'} ago`

  return `${date.toLocaleString()} (${rel})`
}

export function formatClaimValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ')
  if (value === null) return 'null'
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}
