// A sample ID token, so the inspector has something to show before you sign in.
//
// This is NOT a real token and the UI must say so. It's built client-side with
// current timestamps, so the validity window reads sensibly instead of showing
// a hardcoded token that expired months ago.
//
// The claim SET mirrors what this tenant ACTUALLY issues — checked against a
// real token from a real account, not from documentation. That's the point: a
// sample promising claims the real thing doesn't deliver would be a lie, on a
// site whose whole argument is that it tells you the truth about what happened.
// The VALUES are invented, and visibly so. The set is the promise; the values
// never were.
//
// createddatetime is in that set because a claims mapping policy on the app
// registration puts it there. Stock Entra does not issue it, so it is the one
// claim here that could be missed by anyone reading the docs instead of a token.
//
// Notably absent, and deliberately so: amr, acr, auth_time, idp. An earlier
// version of this file invented amr:['pwd'] and auth_time because they'd have
// been interesting to show. Real tokens from this tenant carry neither — amr
// and acr look to be v1.0-only claims, and this tenant issues v2.0. See the
// Module 3 note in the spec, because that module's premise depends on amr.

import { ACCOUNT_CREATED_CLAIM } from './lastFlow'

const TENANT_ID = '7e8da8a9-67bc-4d53-bfc7-fe3e13128382'

/**
 * How far back the sample account was created.
 *
 * Far enough that it reads as an account that already existed, not one created
 * moments before the token. A creation time seconds off `iat` would show a
 * signed-out visitor a sample implying a sign-up that never happened.
 *
 * Derived from `now` for the same reason the validity window is: a hardcoded
 * date drifts further from the token beside it every day it sits here.
 */
const SAMPLE_ACCOUNT_AGE_SECONDS = 90 * 24 * 60 * 60

/**
 * The shape this claim actually arrives in, which is not what `toISOString()`
 * gives: a space where the T goes, whole seconds, Z on the end. Observed on a
 * real token as `2026-07-16 19:32:51Z`.
 */
function tenantTimestamp(epochSeconds: number): string {
  return new Date(epochSeconds * 1000)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, 'Z')
}

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

  // 17 claims — the same set, in the same shape, a real sign-in produces here.
  const payload = {
    iss: `https://${TENANT_ID}.ciamlogin.com/${TENANT_ID}/v2.0`,
    aud: '00000000-0000-0000-0000-000000000000',
    sub: 'sample-pairwise-subject',
    oid: '11111111-2222-3333-4444-555555555555',
    tid: TENANT_ID,
    name: 'Sample Visitor',
    preferred_username: 'sample@example.com',
    email: 'sample@example.com',
    // Computed, not typed out, so the key can never drift from the one the
    // parser reads. Sits with the identity claims, where the dictionary files it.
    [ACCOUNT_CREATED_CLAIM]: tenantTimestamp(now - SAMPLE_ACCOUNT_AGE_SECONDS),
    iat: now,
    nbf: now,
    exp: now + 3600,
    nonce: 'sample-nonce-value',
    rh: '1.SAMPLE_OPAQUE_REFRESH_HINT_NOT_REAL.',
    sid: '00000000-0000-0000-0000-000000000000',
    uti: 'SAMPLE_UTI_NOT_REAL',
    ver: '2.0',
  }

  return `${base64UrlEncode(header)}.${base64UrlEncode(payload)}.SAMPLE_SIGNATURE_THIS_TOKEN_IS_NOT_REAL_AND_WAS_NEVER_SIGNED`
}
