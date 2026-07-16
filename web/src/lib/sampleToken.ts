// A sample ID token, so the inspector has something to show before you sign in.
//
// This is NOT a real token and the UI must say so. It's built client-side with
// current timestamps, so the validity window reads sensibly instead of showing
// a hardcoded token that expired months ago.
//
// The claim shape mirrors what this tenant actually issues — verified against
// the live OIDC discovery document, including the detail that `iss` uses the
// tenant-GUID subdomain while the endpoints use the tenant-name subdomain.

const TENANT_ID = '7e8da8a9-67bc-4d53-bfc7-fe3e13128382'

function base64UrlEncode(obj: unknown): string {
  const json = JSON.stringify(obj)
  // Encode as UTF-8 first — btoa() throws on any character above U+00FF,
  // which a display name like "José" would trip immediately.
  const bytes = new TextEncoder().encode(json)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function buildSampleToken(): string {
  const now = Math.floor(Date.now() / 1000)

  const header = { typ: 'JWT', alg: 'RS256', kid: 'sample-key-not-real' }

  const payload = {
    iss: `https://${TENANT_ID}.ciamlogin.com/${TENANT_ID}/v2.0`,
    aud: '00000000-0000-0000-0000-000000000000',
    sub: 'sample-pairwise-subject',
    oid: '11111111-2222-3333-4444-555555555555',
    tid: TENANT_ID,
    name: 'Sample Visitor',
    preferred_username: 'sample@example.com',
    email: 'sample@example.com',
    amr: ['pwd'],
    auth_time: now - 90,
    iat: now,
    nbf: now,
    exp: now + 3600,
    nonce: 'sample-nonce-value',
    ver: '2.0',
  }

  return `${base64UrlEncode(header)}.${base64UrlEncode(payload)}.SAMPLE_SIGNATURE_THIS_TOKEN_IS_NOT_REAL_AND_WAS_NEVER_SIGNED`
}
