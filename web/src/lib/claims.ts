// The claim annotation dictionary — the substance of Module 1.
//
// Each entry answers three questions a visitor (or an interviewer) would ask:
//   what is this claim, why is it in MY token, and what config produced it?
// The third is the one most token decoders skip, and it's the one that
// demonstrates understanding rather than lookup.

export type ClaimCategory =
  | 'identity' // who the subject is
  | 'issuer' // who minted this and for whom
  | 'timing' // when it's valid
  | 'auth' // how they authenticated
  | 'tenant' // which directory
  | 'protocol' // OIDC/JWT mechanics

export type ClaimAnnotation = {
  /** Short human name. */
  title: string
  category: ClaimCategory
  /** Plain-English: what is this? */
  what: string
  /** Why is it in this token — what put it there? */
  why: string
  /** Optional: a gotcha that bites people who assume. */
  gotcha?: string
}

export const CLAIM_CATEGORY_LABELS: Record<ClaimCategory, string> = {
  identity: 'Identity',
  issuer: 'Issuer & audience',
  timing: 'Validity window',
  auth: 'Authentication',
  tenant: 'Tenant',
  protocol: 'Protocol',
}

export const CLAIMS: Record<string, ClaimAnnotation> = {
  // ---- Issuer & audience -------------------------------------------------
  iss: {
    title: 'Issuer',
    category: 'issuer',
    what: 'The authority that minted this token. Every validator must check it.',
    why: 'Set by the tenant that issued the token — here, the External ID tenant.',
    gotcha:
      "In this tenant the issuer host is NOT the host you called. Endpoints live on the tenant-name subdomain (theidentityplayground.ciamlogin.com) but iss uses the tenant-GUID subdomain. Validate against what's in the discovery document, never against the authority string you configured.",
  },
  aud: {
    title: 'Audience',
    category: 'issuer',
    what: 'Who this token is FOR. A token addressed to someone else is not yours to accept.',
    why: 'The client ID of the app registration that requested it.',
    gotcha:
      'Checking iss without checking aud is a classic hole: a validly-signed token issued for a different app will sail through signature validation.',
  },

  // ---- Identity ----------------------------------------------------------
  sub: {
    title: 'Subject',
    category: 'identity',
    what: 'The stable identifier for the user — but scoped to this app, not global.',
    why: 'Generated per user, per app registration.',
    gotcha:
      "sub is pairwise: the SAME user gets a DIFFERENT sub in a different app. Use oid to correlate a user across your own apps in one tenant. Using sub as a cross-app primary key is a bug that only surfaces once you build a second app.",
  },
  oid: {
    title: 'Object ID',
    category: 'identity',
    what: 'The immutable directory object ID for this user.',
    why: 'Assigned by Entra when the account was created.',
    gotcha:
      'Stable across apps and across renames — unlike email or UPN, which users can change. This is the correlation key Module 6 uses to find "your" sign-in.',
  },
  name: {
    title: 'Display name',
    category: 'identity',
    what: 'Human-readable name. For display only.',
    why: 'Emitted because the openid/profile scope was requested.',
    gotcha: 'User-supplied and not unique. Never use it for authorization decisions.',
  },
  preferred_username: {
    title: 'Preferred username',
    category: 'identity',
    // This entry used to read "the identifier the user signs in with", which is
    // false for every federated user in this tenant — and false in exactly the
    // way the claim is interesting. Checked against real tokens from both paths.
    what: 'A human-readable label for the account. What actually lands here depends entirely on how the account was created.',
    why: 'Emitted with the profile scope.',
    gotcha:
      'Sign in with a local account and this is the email address you typed. Sign in with Google and it is a value Entra generated — <oid>@theidentityplayground.onmicrosoft.com — which that user has never seen, did not choose, and cannot sign in with. Both tokens carry the claim; only one of them carries a username. It reads like an identifier while being neither their identity nor, half the time, their username. Mutable, reassignable, and never safe to key on: use oid.',
  },
  email: {
    title: 'Email',
    category: 'identity',
    what: "The user's email address.",
    why: 'Emitted because the email scope was requested.',
    gotcha:
      'Presence does not mean verified. Whether it was proven depends on how the account was created — a self-service signup that never confirmed the address still yields this claim.',
  },

  // ---- Tenant ------------------------------------------------------------
  tid: {
    title: 'Tenant ID',
    category: 'tenant',
    what: 'The directory that issued this token.',
    why: 'The External ID tenant this app is registered in.',
    gotcha:
      'For multi-tenant apps this is a required authorization check, not trivia. A valid token from the wrong tenant is still the wrong tenant.',
  },

  // ---- Authentication ----------------------------------------------------
  amr: {
    title: 'Authentication methods',
    category: 'auth',
    what: 'HOW the user proved who they are, as an array — e.g. pwd, mfa, otp, fido.',
    why: 'Reflects what actually happened at sign-in, not what policy asked for.',
    gotcha:
      'This is the claim to watch across Module 3. Sign in with a password and it says pwd; complete MFA and mfa appears; use a passkey and you get fido. It is the audit trail of the sign-in you just did.',
  },
  acr: {
    title: 'Authentication context class',
    category: 'auth',
    what: 'A coarse indicator of authentication strength.',
    why: 'Set by the authentication policy that applied.',
    gotcha: 'Largely superseded by amr for real decisions. Prefer amr.',
  },
  idp: {
    title: 'Identity provider',
    category: 'auth',
    what: 'Which IdP actually authenticated the user.',
    why: 'Present when the account came from somewhere else — Google, Facebook, another tenant.',
    gotcha:
      'Absent for local accounts, because the issuer IS the IdP. Its presence is the tell that this identity is federated — Module 2 makes this visible by comparing doors.',
  },
  auth_time: {
    title: 'Authentication time',
    category: 'auth',
    what: 'When the user actually authenticated.',
    why: 'Recorded at sign-in.',
    gotcha:
      'Distinct from iat. A token can be re-issued silently from an existing session, so iat moves while auth_time stays put. If you need "did they authenticate recently", this is the claim — not iat.',
  },

  // ---- Timing ------------------------------------------------------------
  iat: {
    title: 'Issued at',
    category: 'timing',
    what: 'When this token was minted.',
    why: 'Stamped by the issuer.',
  },
  nbf: {
    title: 'Not before',
    category: 'timing',
    what: 'The token is invalid before this time.',
    why: 'Stamped by the issuer, usually equal to iat.',
  },
  exp: {
    title: 'Expires at',
    category: 'timing',
    what: 'The token is invalid after this time. Typically about an hour for an ID token.',
    why: 'Stamped by the issuer per tenant lifetime policy.',
    gotcha:
      'Validators must allow a little clock skew. Also: expiry is not revocation — a token stays valid until exp even if the account is disabled a minute later. That gap is why short lifetimes matter.',
  },

  // ---- Protocol ----------------------------------------------------------
  nonce: {
    title: 'Nonce',
    category: 'protocol',
    what: 'A random value the client generated and the issuer echoed back.',
    why: 'MSAL generated it on the authorize request.',
    gotcha:
      'This is the replay defence: the client checks the echoed nonce matches the one it sent. A token replayed from elsewhere carries the wrong nonce. MSAL validates this for you — which is exactly why you should not hand-roll this flow.',
  },
  ver: {
    title: 'Token version',
    category: 'protocol',
    what: 'The token format version — 2.0 here.',
    why: 'Determined by the app registration and the endpoint used.',
    gotcha:
      'v1.0 and v2.0 tokens differ in which claims exist and what they mean. Claim-shape bugs often trace back to code written against the other version.',
  },
  rh: {
    title: 'Refresh hint',
    category: 'protocol',
    what: 'An opaque Microsoft-internal value.',
    why: 'Added by Entra.',
    gotcha: 'Undocumented and not for your use. Ignore it.',
  },
  uti: {
    title: 'Unique token identifier',
    category: 'protocol',
    what: 'An opaque per-token ID, used internally for correlation.',
    why: 'Added by Entra.',
  },
  sid: {
    title: 'Session ID',
    category: 'protocol',
    what: 'Identifies the user session at the issuer.',
    why: 'Emitted when session management is in play.',
    gotcha: 'Used by front-channel logout so apps can be told the session ended.',
  },
  at_hash: {
    title: 'Access token hash',
    category: 'protocol',
    what: 'A hash binding this ID token to the access token issued alongside it.',
    why: 'Emitted when both are returned together.',
    gotcha: 'Lets a client detect a swapped-in access token from a different response.',
  },
  c_hash: {
    title: 'Code hash',
    category: 'protocol',
    what: 'A hash binding this ID token to the authorization code it came from.',
    why: 'Emitted in flows that return a code.',
  },
}

/** Claims worth calling out because they reveal HOW the user signed in. */
export const SIGNAL_CLAIMS = new Set(['amr', 'idp', 'acr', 'auth_time'])

/** Unix-seconds claims that should render as human dates. */
export const TIME_CLAIMS = new Set(['iat', 'nbf', 'exp', 'auth_time'])

export function getAnnotation(claim: string): ClaimAnnotation | undefined {
  return CLAIMS[claim]
}
