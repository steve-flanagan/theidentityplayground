// The SISU journey — the model behind the recursive zoom.
//
// ─────────────────────────────────────────────────────────────────────────────
// READ THIS BEFORE CHANGING THE SHAPE. It has been misread twice.
//
// TIME IS NOT THE ONLY AXIS, AND IT DOESN'T GO ALL THE WAY DOWN.
//
//   sign-in timeline → the event "issues the ID token" → the token
//     → identity / issuer & audience / validity window / auth / tenant / protocol
//       → the claims in that group → what each one is and does → stop
//
// The first hop is temporal. The rest is COMPOSITION — anatomy, not chronology.
// A claim has no duration. Asking where a claim's timestamp comes from is a
// category error, and it was actually asked.
//
// So: a node carries a `span` ONLY if it genuinely occupies time. If it has one,
// it can be plotted and zoomed into — its children render on an axis rescaled to
// that span, which is the Powers of Ten move: 0–1400ms becomes 4–18ms and the
// scale reference changes by two orders of magnitude. If it has no span, its
// children are a list, because they aren't in time.
//
// The recursion lives in the INTERACTION — click to descend, breadcrumb to come
// back — NOT in the data. Each level is a different kind of thing. An earlier
// draft insisted "every level must itself be a timeline"; that was a formalism
// imposed on the idea and it isn't the idea.
//
// It stops when it stops: no children means that branch ends there, and
// different branches bottom out at different depths.
// ─────────────────────────────────────────────────────────────────────────────

import { CLAIMS, CLAIM_CATEGORY_LABELS, TIME_CLAIMS, type ClaimCategory } from './claims'
import { decodeJwt, formatClaimValue, formatTimeClaim } from './jwt'

// The real source of this app, embedded at build time by Vite's `?raw`.
// This is the honest way to do it: the snippet on screen IS the file that runs,
// so it cannot drift. A hand-copied snippet would rot the first time the config
// changed, and rot silently.
import msalConfigSource from '../auth/msalConfig.ts?raw'
import signInPanelSource from '../components/SignInPanel.tsx?raw'
import jwtSource from './jwt.ts?raw'

const REPO_BLOB = 'https://github.com/steve-flanagan/theidentityplayground/blob/main'

export type CodeRef = {
  /** Repo-relative path — the caption and the GitHub link. */
  file: string
  /** The real file contents. Whole file, deliberately: line ranges drift silently. */
  source: string
  /** One line on why this file is the answer to "how is this done here?" */
  note: string
}

export function codeUrl(ref: CodeRef): string {
  return `${REPO_BLOB}/${ref.file}`
}

/** Who is doing the work. The colour on the bar means this, or it means nothing. */
export type Actor = 'browser' | 'network' | 'entra'

export const ACTOR_LABELS: Record<Actor, string> = {
  browser: 'Browser',
  network: 'Network',
  entra: 'Entra',
}

/** Milliseconds from journey start. Absolute, not relative to the parent. */
export type Span = { start: number; end: number }

export type ZoomNode = {
  id: string
  label: string
  /** One line: what this is. Shown when listed as a child. */
  summary?: string
  /** The literal machine string, when there is one. Rendered monospace. */
  literal?: string
  /** Terminal payload — the "ok, I know what that is" content. */
  detail?: { what: string; why?: string; gotcha?: string }
  /** Descend into these. Absent or empty means this branch stops here. */
  children?: ZoomNode[]
  /**
   * This node exists but holds nothing, and the reason is the interesting part.
   * Annotating the absence is more credible than hiding it.
   */
  absent?: string
  /**
   * Present ONLY if this thing occupies time. Having one makes it plottable and
   * zoomable. A token, a claim group, a claim: no span. They aren't in time.
   */
  span?: Span
  /** Real code from this repo that produced or handles this step. */
  code?: CodeRef
}

export type JourneyEvent = ZoomNode & {
  actor: Actor
  /** Required for events — an event that isn't in time isn't an event. */
  span: Span
}

export type Journey = {
  id: string
  label: string
  summary: string
  duration: number
  outcome: { label: string; ok: boolean }
  events: JourneyEvent[]
}

export const spanMs = (s: Span) => s.end - s.start

// ── The token subtree ───────────────────────────────────────────────────────
// Built from the SAME claims.ts dictionary the inspector uses, and from the real
// decoded token. Nothing here is a second copy — levels 2-4 already existed,
// which is the point. No spans anywhere below: none of it is in time.

const CATEGORY_ORDER: ClaimCategory[] = [
  'identity',
  'issuer',
  'auth',
  'tenant',
  'timing',
  'protocol',
]

/** Why a category can be empty in THIS tenant. The absence is the content. */
const CATEGORY_ABSENCE: Partial<Record<ClaimCategory, string>> = {
  auth: 'This tenant issues no amr, acr, auth_time or idp on a local-account sign-in. amr and acr appear to be v1.0-only claims and this tenant issues v2.0; idp only appears for social sign-in, because for a local account the issuer IS the identity provider. Module 3 reads the method from sign-in logs instead.',
}

function claimNode(claim: string, value: unknown): ZoomNode {
  const annotation = CLAIMS[claim]
  const literal = TIME_CLAIMS.has(claim)
    ? (formatTimeClaim(value) ?? formatClaimValue(value))
    : formatClaimValue(value)

  return {
    id: `claim:${claim}`,
    label: claim,
    summary: annotation?.title,
    literal,
    detail: annotation
      ? { what: annotation.what, why: annotation.why, gotcha: annotation.gotcha }
      : { what: 'Not in the annotation dictionary yet.' },
  }
}

/** The token, as a thing you can open: categories → claims → meaning. */
export function buildTokenNode(token: string, label: string): ZoomNode {
  const { payload } = decodeJwt(token)
  const present = Object.keys(payload)

  const categories: ZoomNode[] = CATEGORY_ORDER.map((category) => {
    const claims = present.filter((c) => CLAIMS[c]?.category === category)

    return {
      id: `cat:${category}`,
      label: CLAIM_CATEGORY_LABELS[category],
      summary:
        claims.length > 0
          ? `${claims.length} claim${claims.length === 1 ? '' : 's'}`
          : 'none issued',
      absent: claims.length === 0 ? CATEGORY_ABSENCE[category] : undefined,
      children: claims.map((c) => claimNode(c, payload[c])),
    }
  })

  return {
    id: 'token',
    label,
    summary: `${present.length} claims, grouped by what they're for`,
    code: {
      file: 'web/src/lib/jwt.ts',
      source: jwtSource,
      note: 'The decoder that produced everything below — and the reason it refuses to validate.',
    },
    children: categories,
  }
}

// ── Level 1: the events ─────────────────────────────────────────────────────
// Authorization code flow + PKCE against the External ID tenant, via MSAL.js.
//
// TIMINGS ARE SAMPLE DATA and the UI says so. Plausible, not measured. Real MSAL
// timing + sign-in logs replace them when wired — same shape, real numbers.
// Inventing timings and presenting them as real would be exactly the
// metaphor-over-artifact move this project refuses.
//
// Human typing time is deliberately NOT on the axis: it dwarfs everything else
// and it isn't the machine's work. What's plotted is the machine's 1.4 seconds.

export function buildSisuJourney(token: string, tokenLabel: string): Journey {
  const events: JourneyEvent[] = [
    {
      id: 'click',
      label: 'Sign in clicked',
      actor: 'browser',
      span: { start: 0, end: 4 },
      summary: 'The only part a user sees.',
      detail: { what: 'MSAL.js begins an authorization code flow with PKCE.' },
      code: {
        file: 'web/src/components/SignInPanel.tsx',
        source: signInPanelSource,
        note: 'loginRedirect, not loginPopup — popups get blocked, and a recruiter on a phone is the case that matters.',
      },
    },
    {
      id: 'pkce',
      label: 'PKCE + state + nonce generated',
      actor: 'browser',
      span: { start: 4, end: 18 },
      summary: 'Three random values, three different jobs.',
      // These carry spans, so this event zooms: 14 ms becomes the whole axis.
      children: [
        {
          id: 'pkce:verifier',
          label: 'code_verifier / code_challenge',
          summary: 'Proof-of-possession for the code exchange',
          span: { start: 4, end: 10 },
          detail: {
            what: 'A random verifier is held in the browser; its SHA-256 challenge goes to /authorize.',
            why: 'PKCE. The code is useless to anyone who cannot present the original verifier.',
            gotcha:
              'This is what makes a public client safe without a secret. An intercepted authorization code cannot be redeemed without the verifier, which never left this tab.',
          },
        },
        {
          id: 'pkce:state',
          label: 'state',
          summary: 'CSRF defence',
          span: { start: 10, end: 13 },
          detail: {
            what: 'A random value echoed back on the redirect.',
            why: 'MSAL checks it matches the request it started.',
            gotcha: 'Distinct from nonce. state protects the redirect; nonce protects the token.',
          },
        },
        {
          id: 'pkce:nonce',
          label: 'nonce',
          summary: 'Replay defence — lands in the token',
          span: { start: 13, end: 18 },
          detail: {
            what: 'A random value the issuer echoes into the ID token.',
            why: 'MSAL generated it here, on this request.',
            gotcha:
              'You can watch this one end-to-end: generated at this event, and it comes back as a claim in the token issued at the end of this timeline.',
          },
        },
      ],
    },
    {
      id: 'authorize',
      label: 'GET /authorize',
      actor: 'network',
      span: { start: 18, end: 214 },
      summary: 'Redirect to the CIAM authority.',
      literal: 'https://theidentityplayground.ciamlogin.com/7e8da8a9-…/oauth2/v2.0/authorize',
      code: {
        file: 'web/src/auth/msalConfig.ts',
        source: msalConfigSource,
        note: 'The config that builds this URL: the ciamlogin authority, why knownAuthorities is mandatory, and why redirectUri is origin and not "/".',
      },
      detail: {
        what: 'The browser leaves for the tenant-name subdomain.',
        why: 'The authority MSAL is configured with.',
        gotcha:
          'Note the host. This is the tenant-NAME subdomain. The iss claim in the token at the end of this timeline uses the tenant-GUID subdomain instead. They are not the same host, and assuming they match is how token validation breaks.',
      },
    },
    {
      id: 'resolve',
      label: 'Tenant + app registration resolved',
      actor: 'entra',
      span: { start: 214, end: 268 },
      summary: 'redirect_uri checked against the registration.',
      detail: {
        what: 'Entra resolves the tenant, the client_id, and validates the redirect_uri exactly.',
        why: 'The app registration is the contract.',
        gotcha:
          'redirect_uri matching is exact, not prefix. This is where a trailing-slash mismatch dies, with an error that names the URI so you can read the difference.',
      },
    },
    {
      id: 'userflow',
      label: 'User flow selected — SUSI_Email',
      actor: 'entra',
      span: { start: 268, end: 302 },
      summary: 'The config that decides what happens next.',
      detail: {
        what: 'The sign-up/sign-in user flow bound to this app.',
        why: 'It determines the identity providers offered and the attributes collected.',
        gotcha:
          'This is the knob. Change the user flow and the sign-in page, the available IdPs, and ultimately the claims in the token all change — without touching a line of app code.',
      },
    },
    {
      id: 'credential',
      label: 'Credential submitted + validated',
      actor: 'entra',
      span: { start: 302, end: 648 },
      summary: 'Human time excluded from this axis.',
      detail: {
        what: 'The local account credential is validated against the directory.',
        why: 'Email + password, per the SUSI_Email flow.',
        gotcha:
          "The time a human spends typing is not plotted here. It dwarfs the whole rest of the axis and it is not the machine's work. What is plotted is the 1.4 seconds the system spent.",
      },
    },
    {
      id: 'ca',
      label: 'Conditional Access evaluated',
      actor: 'entra',
      span: { start: 648, end: 716 },
      summary: 'Its own journey, one level down.',
      absent:
        'Not built yet. This event is where the Conditional Access timeline attaches — policy set in, signals evaluated, grant or block out. Module 4.',
    },
    {
      id: 'mfa',
      label: 'MFA — not triggered',
      actor: 'entra',
      span: { start: 716, end: 726 },
      summary: 'Nothing happened here, and that is the interesting part.',
      absent:
        'No MFA on this flow: no policy required it. When one does, this event opens into the auth-methods timeline — challenge issued, method used, satisfied or not. Module 3. The token carries no amr to prove any of it, which is its own finding.',
    },
    {
      id: 'code',
      label: 'Authorization code minted',
      actor: 'entra',
      span: { start: 726, end: 798 },
      summary: 'Bound to the PKCE challenge from event 2.',
      detail: {
        what: 'A short-lived code, bound to the code_challenge sent at /authorize.',
        why: 'Authorization code flow.',
        gotcha:
          'The code is not the token and grants nothing on its own. It is single-use, short-lived, and redeemable only by whoever holds the verifier.',
      },
    },
    {
      id: 'redirect',
      label: '302 → redirect_uri',
      actor: 'network',
      span: { start: 798, end: 968 },
      summary: 'Back to the SPA with code + state.',
      literal: 'http://localhost:5173/?code=…&state=…',
      detail: {
        what: 'The browser returns to the registered redirect URI carrying the code.',
        why: 'The redirect_uri from the app registration.',
      },
    },
    {
      id: 'state-check',
      label: 'state validated',
      actor: 'browser',
      span: { start: 968, end: 986 },
      summary: 'Is this the response to the request I started?',
      detail: {
        what: 'MSAL compares the returned state to the one it generated at event 2.',
        why: 'CSRF defence.',
        gotcha: 'A mismatch means this response belongs to a different request. MSAL drops it.',
      },
    },
    {
      id: 'token-request',
      label: 'POST /token',
      actor: 'network',
      span: { start: 986, end: 1268 },
      summary: 'code + code_verifier exchanged for tokens.',
      detail: {
        what: 'The code and the original verifier go back to the token endpoint.',
        why: 'Redeeming the code.',
        gotcha:
          'No client secret. A SPA cannot keep one, which is exactly why PKCE exists — the verifier is the proof instead.',
      },
    },
    {
      id: 'issue',
      label: 'ID token issued',
      actor: 'entra',
      span: { start: 1268, end: 1342 },
      summary: 'The artifact. Open it.',
      children: [buildTokenNode(token, tokenLabel)],
    },
    {
      id: 'cache',
      label: 'nonce validated, token cached',
      actor: 'browser',
      span: { start: 1342, end: 1400 },
      summary: 'MSAL checks the echo and resolves the account.',
      detail: {
        what: 'MSAL validates the signature and the nonce, then caches the token.',
        why: "It is the client library's job, and the reason not to hand-roll this flow.",
        gotcha:
          'The nonce it checks is the one generated at event 2, echoed back as a claim. That round trip is the replay defence closing.',
      },
    },
  ]

  return {
    id: 'sisu',
    label: 'SISU — sign-up / sign-in',
    summary: 'Authorization code + PKCE against the External ID tenant.',
    duration: 1400,
    outcome: { label: 'Token issued', ok: true },
    events,
  }
}
