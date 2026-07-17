// The SISU journeys — built from real captures, not from imagination.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHERE THESE NUMBERS COME FROM
//
// Two HAR captures of two real flows against this real tenant, 16 July 2026:
// one sign-up, one sign-in. Every millisecond below is a measured server wait
// (HAR `timings.wait` — request sent → first byte back), which is exactly the
// time Entra spent thinking. Nothing here is estimated.
//
// An earlier version of this file invented all of it. Steve's rule killed that:
// "everything that can be should be live data." Sample data is a placeholder
// with an expiry date, never a destination — and on a site whose whole argument
// is that it tells you the truth about what happened, an invented millisecond is
// a lie in the one place the site claims authority.
//
// THE AXIS IS MACHINE TIME, AND THAT IS THE HONEST CHOICE.
//
// Wall clock for the sign-in was 20.8s; the machine worked for 1.7s of it. The
// other 19 seconds are a human typing. Those gaps sit BETWEEN requests, never
// inside one, so excluding them costs nothing and needs no special pleading —
// they're recorded on `humanGapBefore` and rendered as gaps, not as bars.
//
// WHAT CANNOT BE MEASURED, AND IS THEREFORE NOT DRAWN
//
// Entra's internal steps — tenant resolution, user flow selection, credential
// validation, CA evaluation, code minting — all happen inside a single TTFB. A
// browser cannot decompose that and neither can Wireshark. So they are NOT timed
// bars: they're composition, listed inside the request they actually happened in.
// Requests are the temporal layer; steps are anatomy. That distinction is the
// whole model, and it's why a claim (which has no duration) is a list item.
// ─────────────────────────────────────────────────────────────────────────────

import { CLAIMS, CLAIM_CATEGORY_LABELS, TIME_CLAIMS, type ClaimCategory } from './claims'
import { decodeJwt, formatClaimValue, formatTimeClaim } from './jwt'

// The real source of this app, embedded at build time by Vite's `?raw`. The
// snippet on screen IS the file that runs, so it cannot drift. A hand-copied one
// would rot the first time the config changed, and rot silently.
import msalConfigSource from '../auth/msalConfig.ts?raw'
import signInPanelSource from '../components/SignInPanel.tsx?raw'
import jwtSource from './jwt.ts?raw'

const REPO_BLOB = 'https://github.com/steve-flanagan/theidentityplayground/blob/main'

export type CodeRef = {
  file: string
  source: string
  note: string
}

export const codeUrl = (ref: CodeRef): string => `${REPO_BLOB}/${ref.file}`

/** Who is doing the work. The colour on the bar means this, or it means nothing. */
export type Actor = 'browser' | 'network' | 'entra'

export const ACTOR_LABELS: Record<Actor, string> = {
  browser: 'Browser',
  network: 'Network',
  entra: 'Entra',
}

/** Milliseconds on the MACHINE clock — human gaps are not on it. */
export type Span = { start: number; end: number }

export type ZoomNode = {
  id: string
  label: string
  summary?: string
  literal?: string
  detail?: { what: string; why?: string; gotcha?: string }
  children?: ZoomNode[]
  /** Exists but holds nothing, and the reason is the interesting part. */
  absent?: string
  /** Present ONLY if this thing occupies time. A claim doesn't. */
  span?: Span
  code?: CodeRef
}

export type JourneyEvent = ZoomNode & {
  actor: Actor
  span: Span
  /**
   * What goes ON the bar. The full "POST /common/GetCredentialType" needs a wide
   * segment to earn its space, and a bar that can't show its name is just a
   * stripe — "the main thing is what they contain, and that is best represented
   * by the name". A short name fits in far more bars. The row always has the
   * long one, so nothing is lost.
   */
  short?: string
  /**
   * Idle ms before this request fired — a human typing. Measured, but NOT on the
   * axis: it sits between requests, never inside one, so the machine clock can
   * exclude it without any special pleading.
   */
  humanGapBefore?: number
  /** What they were doing in that gap. */
  humanDoing?: string
}

export type FlowId = 'signin' | 'signup'

export type Journey = {
  id: FlowId
  label: string
  summary: string
  /** Machine time only. */
  duration: number
  /** Wall clock, including the human. Stated, not plotted. */
  wallClock: number
  outcome: { label: string; ok: boolean }
  events: JourneyEvent[]
}

export const spanMs = (s: Span) => s.end - s.start

// ── The token subtree ───────────────────────────────────────────────────────
// From the SAME claims.ts the inspector uses, and the real decoded token. Not a
// second copy of anything: these levels already existed. No spans anywhere below
// — none of it is in time.

const CATEGORY_ORDER: ClaimCategory[] = [
  'identity',
  'issuer',
  'auth',
  'tenant',
  'timing',
  'protocol',
]

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

// ── The measurements ────────────────────────────────────────────────────────
// Straight from the two captures. `wait` is HAR timings.wait — server think
// time. `humanGapBefore` is the idle gap before this request fired, which is a
// person typing, and is deliberately NOT on the axis.

// The numbers come from the derived captures, NOT from anything typed here.
// scripts/har-to-timings.mjs produced these from the real HARs; the HARs
// themselves are gitignored because they carry the auth code and the token.
// Retyping numbers by hand is how a "real" figure quietly becomes a wrong one.
import signinCapture from './captures/signin.json'
import signupCapture from './captures/signup.json'

type CapturedRequest = {
  path: string
  /** Who actually served it. `SPA /` is our own origin, not Entra. */
  host: string
  method: string
  status: number
  total: number
  idleBefore: number
  timings: Record<string, number>
}

type Capture = {
  flow: string
  requestCount: number
  machineMs: number
  wallMs: number
  humanMs: number
  requests: CapturedRequest[]
}

const CAPTURES: Record<FlowId, Capture> = {
  signin: signinCapture as Capture,
  signup: signupCapture as Capture,
}

type Measured = {
  id: string
  label: string
  /** Short form for the bar. See JourneyEvent.short. */
  short?: string
  actor: Actor
  /** Full request time, ms — measured. Filled from the capture, never by hand. */
  total: number
  /** Phase breakdown — measured. Filled from the capture. */
  timings: Record<string, number>
  /** Idle ms before this fired. A human. Not plotted. */
  humanGapBefore?: number
  /** What the human was doing in that gap. */
  humanDoing?: string
  summary?: string
  literal?: string
  detail?: ZoomNode['detail']
  absent?: string
  code?: CodeRef
  /** Marks the deep branch — the token gets attached here. */
  attachToken?: boolean
}

/** Annotation, keyed by the capture's request path. The prose is ours; the numbers aren't. */
type Annotation = Omit<Measured, 'total' | 'timings' | 'humanGapBefore'> & {
  /** Matches CapturedRequest.path. */
  match: string
}

/** What Entra does inside /authorize. Real steps, no timings — see the header. */
const AUTHORIZE_INSIDE: ZoomNode[] = [
  {
    id: 'inside:tenant',
    label: 'Tenant + app registration resolved',
    summary: 'client_id → the app registration',
    detail: {
      what: 'Entra resolves the tenant and the client_id to a registration.',
      why: 'The app registration is the contract.',
    },
  },
  {
    id: 'inside:redirect',
    label: 'redirect_uri validated',
    summary: 'Exact match, not prefix',
    detail: {
      what: 'The redirect_uri is compared to the registered list.',
      why: 'It is what stops a code being sent somewhere else.',
      gotcha:
        'Matching is exact, not prefix. A trailing slash is a mismatch. This is why msalConfig uses window.location.origin and not "/" — origin yields the registered string verbatim.',
    },
  },
  {
    id: 'inside:userflow',
    label: 'User flow selected — SUSI_Email',
    summary: 'The knob that decides the rest',
    detail: {
      what: 'The sign-up/sign-in user flow bound to this app.',
      why: 'It determines the IdPs offered and the attributes collected.',
      gotcha:
        'This is the knob. Change the user flow and the sign-in page, the available identity providers, and ultimately the claims in your token all change — without touching a line of app code.',
    },
  },
  {
    id: 'inside:pkce',
    label: 'PKCE challenge recorded',
    summary: 'Bound to the code that gets minted later',
    detail: {
      what: 'The code_challenge sent on this request is stored against the session.',
      why: 'PKCE. The code will only be redeemable by whoever holds the verifier.',
      gotcha:
        'The verifier never left the browser tab. That is what makes a public client safe without a secret, and why the app registration is SPA and not Web.',
    },
  },
]

/** What happens inside POST /login. Real steps, no timings — see the header. */
const CA_MFA_INSIDE: ZoomNode[] = [
  {
    id: 'inside:ca',
    label: 'Conditional Access evaluated',
    absent:
      'No policy applied on this flow. This is where the CA timeline attaches once Module 4 exists — policy set in, signals evaluated, grant or block out.',
  },
  {
    id: 'inside:mfa',
    label: 'MFA — not required',
    absent:
      'Nothing required it. When something does, this opens into the auth-methods timeline: challenge issued, method used, satisfied or not (Module 3). The token carries no amr to prove any of it either way, which is its own finding.',
  },
]

// ── The prose ───────────────────────────────────────────────────────────────
// Keyed by the capture's request path. THE CAPTURE DRIVES THE EVENT LIST; this
// only decorates it. That direction matters: an event cannot exist here unless
// it actually happened, and no number is retyped, so nothing can drift from what
// was measured. A request with no entry still renders — labelled from its path.

const ANNOTATIONS: Record<string, Annotation> = {
  '/{tid}/v2.0/.well-known/openid-configuration': {
    match: '/{tid}/v2.0/.well-known/openid-configuration',
    id: 'discovery',
    short: 'discovery',
    label: 'GET /.well-known/openid-configuration',
    actor: 'network',
    summary: 'MSAL asks the tenant what it is before trusting anything.',
    detail: {
      what: 'The OIDC discovery document: issuer, jwks_uri, and every endpoint.',
      why: 'MSAL fetches it on startup rather than trusting hardcoded URLs.',
      gotcha:
        'This document is why the issuer trap is knowable. It is fetched from the tenant-NAME host, and the issuer it returns uses the tenant-GUID host. They are not the same host. Validate against what this returns, never against the authority string you configured.',
    },
  },
  '/{tid}/oauth2/v2.0/authorize': {
    match: '/{tid}/oauth2/v2.0/authorize',
    id: 'authorize',
    short: '/authorize',
    label: 'GET /oauth2/v2.0/authorize',
    actor: 'network',
    summary: 'One request. Four things happen inside it.',
    code: {
      file: 'web/src/auth/msalConfig.ts',
      source: msalConfigSource,
      note: 'The config that builds this URL: the ciamlogin authority, why knownAuthorities is mandatory, and why redirectUri is origin and not "/".',
    },
    detail: {
      what: 'The browser leaves for the tenant-name subdomain carrying client_id, redirect_uri, scope, state, nonce and the PKCE challenge.',
      why: 'The authority MSAL is configured with.',
      gotcha:
        '166 ms of this is spent before Entra reads a byte: DNS, TCP, TLS. Open the phases and it is right there. This is one of only two requests in the flow that pays that — the discovery call ahead of it is the other. Everything afterwards reuses a connection and is pure server time.',
    },
  },
  '/common/GetCredentialType': {
    match: '/common/GetCredentialType',
    id: 'credtype',
    short: 'GetCredentialType',
    label: 'POST /common/GetCredentialType',
    actor: 'entra',
    humanDoing: 'typing an email address',
    summary: 'Home-realm discovery — before a password is ever typed.',
    detail: {
      what: 'Entra decides what this identity is: a local account, or federated somewhere else.',
      why: 'It fires when the email loses focus, before the password field matters.',
      gotcha:
        'This request decides whether you get a password box or a redirect to Google. On a federated identity the flow forks right here — which is exactly why idp appears in a social token and is absent from a local one.',
    },
  },
  '/{tid}/login': {
    match: '/{tid}/login',
    id: 'login',
    short: '/login',
    label: 'POST /login',
    actor: 'entra',
    humanDoing: 'typing a password',
    summary: 'The credential is checked. CA and MFA are evaluated in here too.',
    detail: {
      what: 'The credential is validated against the directory.',
      why: 'Email + password, per the SUSI_Email flow.',
      gotcha:
        'Conditional Access and MFA evaluation both happen inside this one request. Neither triggered here, and neither is separately timed — a browser sees a single TTFB and nothing can decompose it.',
    },
  },
  '/kmsi': {
    match: '/kmsi',
    id: 'kmsi',
    short: '/kmsi',
    label: 'POST /kmsi',
    actor: 'entra',
    humanDoing: 'deciding whether to stay signed in',
    summary: 'Keep me signed in. Only exists on sign-in.',
    detail: {
      what: 'Records the answer to "stay signed in?" and issues the session cookie behind it.',
      why: 'The user flow offers it to a returning user.',
      gotcha:
        'One of the four requests that differ between signing up and signing in — and the one that decides whether the NEXT sign-in needs a password at all.',
    },
  },
  '/common/validateuserattributes': {
    match: '/common/validateuserattributes',
    id: 'validate',
    short: 'validateuserattributes',
    label: 'POST /common/validateuserattributes',
    actor: 'entra',
    humanDoing: 'filling in attributes',
    summary: 'Sign-up only. The attributes the user flow asked for.',
    detail: {
      what: 'Validates the attributes the user flow collected, before anything is written.',
      why: 'SUSI_Email collects them on sign-up.',
      gotcha:
        'Which attributes appear here is user-flow config, not code — and it is what decides which claims can exist in the token later.',
    },
  },
  '/common/createuser': {
    match: '/common/createuser',
    id: 'createuser',
    short: 'createuser',
    label: 'POST /common/createuser',
    actor: 'entra',
    summary: 'Sign-up only. The most expensive thing in either flow.',
    detail: {
      what: 'The directory object is actually created.',
      why: 'First time through — there is no account yet.',
      gotcha:
        'Measured at 1,673 ms: about 40% of the entire sign-up, and more than the whole sign-in flow costs end to end. Writing a user into a directory is the expensive part of identity, and it happens exactly once per account. Everything after is comparatively free.',
    },
  },
  '/{tid}/Consent/Set': {
    match: '/{tid}/Consent/Set',
    id: 'consent',
    short: '/Consent/Set',
    label: 'POST /Consent/Set → 302',
    actor: 'entra',
    humanDoing: 'reading the consent screen',
    summary: 'Sign-up only. Ends with the code in the fragment.',
    detail: {
      what: 'Records consent, mints the authorization code, and redirects to redirect_uri.',
      why: 'First-time sign-up needs consent recorded.',
      gotcha:
        'The 302 out of this carries #code, client_info, state, session_state and clientdata. That fragment is the auth response, and it belongs to MSAL.',
    },
  },
  'SPA /': {
    match: 'SPA /',
    id: 'spa',
    short: 'SPA reload',
    label: 'GET / — the SPA reloads',
    actor: 'browser',
    summary: 'Back on our origin, carrying the code in the fragment.',
    detail: {
      what: 'The browser lands on redirect_uri with #code=… and boots the app fresh.',
      why: 'Redirect flow: this page was unloaded the entire time you were at Entra.',
      gotcha:
        'The code arrives in the URL FRAGMENT. This app once wrote that fragment on mount and destroyed the code before MSAL could read it, silently breaking every sign-in. The fragment is not ours.',
    },
  },
  '/{tid}/oauth2/v2.0/token': {
    match: '/{tid}/oauth2/v2.0/token',
    id: 'token-request',
    short: '/token',
    label: 'POST /oauth2/v2.0/token',
    actor: 'network',
    summary: 'The code and the verifier, exchanged for the token.',
    attachToken: true,
    code: {
      file: 'web/src/components/SignInPanel.tsx',
      source: signInPanelSource,
      note: 'loginRedirect, not loginPopup — popups get blocked, and a recruiter on a phone is the case that matters.',
    },
    detail: {
      what: 'The authorization code goes back with the original code_verifier, and the ID token comes out.',
      why: 'Redeeming the code.',
      gotcha:
        'No client secret anywhere. A SPA cannot keep one, which is the entire reason PKCE exists — the verifier is the proof instead. Note the phases: zero setup cost, because the connection to this host is already warm.',
    },
  },
}

// ── The phases: a real level down ───────────────────────────────────────────
// A request decomposes into measured phases, and they are the honest answer to
// "what can we zoom into?" The invented PKCE sub-slices were the only nested
// timings the old model had, and they were fiction. These are not:
//
//   GET /authorize — 713 ms
//     dns 11 · connect 74 · ssl 81 · wait 547   ← 166 ms just reaching a cold host
//   POST /token — 146 ms
//     dns 0 · connect 0 · ssl 0 · wait 146      ← connection reused; setup is free
//
// The `wait` phase is where Entra actually thinks, so that is where the
// composition hangs. Everything under `wait` is untimed, because a browser
// cannot decompose a TTFB and neither can anything else.

const PHASE_COPY: Record<string, { label: string; what: string; gotcha?: string }> = {
  blocked: { label: 'blocked', what: 'Queued in the browser before the request went out.' },
  dns: {
    label: 'DNS lookup',
    what: 'Resolving the hostname.',
    gotcha:
      'Zero on every later request: the browser caches it. Only the first trip to a host pays.',
  },
  connect: { label: 'TCP connect', what: 'Opening the socket.' },
  ssl: {
    label: 'TLS handshake',
    what: 'Negotiating the encrypted channel.',
    gotcha:
      'Setting up a connection is what costs here. In this capture only two requests pay it — the discovery call (57 ms) and /authorize (166 ms). Every request after them reuses a connection and pays nothing: GetCredentialType, /login, /kmsi and /token are all pure server time. It is why the second half of the flow looks so cheap.',
  },
  send: { label: 'Request sent', what: 'Writing the bytes.' },
  // Overridden per host below — "Entra thinking" is a lie on our own origin.
  wait: {
    label: 'Waiting',
    what: 'Time to first byte. Everything the server did, in one number.',
    gotcha:
      'This is the black box. The steps inside it are known; their individual timings are not published by Entra, and no browser or packet capture can decompose a single TTFB. That is why the steps below carry no times.',
  },
  receive: { label: 'Response received', what: 'Reading the bytes back.' },
}

const PHASE_ORDER = ['blocked', 'dns', 'connect', 'ssl', 'send', 'wait', 'receive'] as const

/** A request the annotation map doesn't know. Rendered honestly, not dropped. */
function generic(r: CapturedRequest): Annotation {
  return {
    match: r.path,
    id: r.path.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase(),
    label: `${r.method} ${r.path}`,
    actor: r.path.startsWith('SPA') ? 'browser' : 'network',
    summary: 'Not annotated yet.',
  }
}

/** Capture → plotted. Cumulative machine time; the human gaps advance nothing. */
function toEvents(capture: Capture, token: string, tokenLabel: string): JourneyEvent[] {
  let clock = 0

  // A path can repeat: MSAL fetches the discovery document once at startup and
  // again after the SPA reloads. Annotations are keyed by path, so both requests
  // used to come out with id 'discovery' — duplicate React keys, and React's
  // documented response to that is to duplicate and/or omit children. It showed
  // up as phantom rows in every detail view. Ids are per-occurrence now.
  const seen = new Map<string, number>()

  return capture.requests.map((r) => {
    const a = ANNOTATIONS[r.path] ?? generic(r)

    const nth = (seen.get(a.id) ?? 0) + 1
    seen.set(a.id, nth)
    const id = nth === 1 ? a.id : `${a.id}-${nth}`

    // A repeat that costs nothing is a cache hit, and saying so is better than
    // showing the same row twice with no explanation.
    const cached = nth > 1 && r.total === 0

    const m: Measured = {
      ...a,
      id,
      label: cached ? `${a.label} — cached` : a.label,
      short: cached ? `${a.short ?? a.label} (cached)` : a.short,
      summary: cached
        ? 'Same document, second ask. Served from cache in 0 ms.'
        : a.summary,
      detail: cached
        ? {
            what: 'MSAL re-reads the discovery document after the redirect, because the page was torn down and rebuilt.',
            why: 'The SPA reloaded — everything in memory went with it.',
            gotcha:
              'Zero milliseconds. The browser had it cached, so the second ask costs nothing. This is the same lesson as the connection reuse on /token: the first time is expensive, and after that identity is mostly free.',
          }
        : a.detail,
      total: r.total,
      timings: r.timings,
      // Only call it a human if it's long enough to be one. Sub-second gaps are
      // the browser, not a person, and labelling those "you, typing" would be a
      // small lie in a place that can't afford any.
      humanGapBefore: r.idleBefore >= 1000 ? r.idleBefore : undefined,
    }

    const span = { start: clock, end: clock + m.total }
    clock = span.end

    // What hangs off the `wait` phase — the part Entra won't itemise.
    const insideWait: ZoomNode[] =
      m.id === 'authorize'
        ? AUTHORIZE_INSIDE
        : m.id === 'login'
          ? CA_MFA_INSIDE
          : m.attachToken
            ? [buildTokenNode(token, tokenLabel)]
            : []

    // Phases, laid end to end across the request's own span. Real sub-timings.
    let pc = span.start
    const phases: ZoomNode[] = []
    for (const key of PHASE_ORDER) {
      const ms = m.timings[key] ?? 0
      if (ms <= 0) continue
      const copy = PHASE_COPY[key]
      const phaseSpan = { start: pc, end: pc + ms }
      pc = phaseSpan.end
      phases.push({
        id: `${m.id}:${key}`,
        // "Entra thinking" is a lie on our own origin: the SPA reload is Azure
        // Static Web Apps handing back HTML, and Entra is nowhere near it.
        label:
          key === 'wait'
            ? r.host.includes('ciamlogin')
              ? 'Waiting — Entra thinking'
              : 'Waiting — our host responding'
            : copy.label,
        span: phaseSpan,
        summary: `${ms} ms`,
        detail: { what: copy.what, gotcha: copy.gotcha },
        children: key === 'wait' && insideWait.length ? insideWait : undefined,
      })
    }

    /**
     * A LEVEL THAT REPEATS ITS PARENT'S NUMBER IS NOT A LEVEL.
     *
     * Six of the eight requests here are pure `wait` — no DNS, no connect, no
     * TLS, because the connection is already open. Zooming into one of those
     * produced a single row saying "waiting: 146 ms" under a request labelled
     * 146 ms. Same number, one click deeper, nothing learned. Steve: "seems like
     * a lot of useless info and just entra waiting and TCP handshakes."
     *
     * So the phase level only exists where the phases actually say something —
     * more than one of them. Below that the request keeps whatever it contains
     * (the token, the CA/MFA steps) as its direct children, which also removes a
     * pointless hop on the way to the best content on the page.
     *
     * Only /authorize and the discovery call earn it, and that IS the finding:
     * they're the two that pay for a connection.
     */
    const phasesSaySomething = phases.length > 1
    const children = phasesSaySomething
      ? phases
      : insideWait.length
        ? insideWait
        : undefined

    return {
      id: m.id,
      label: m.label,
      short: m.short,
      actor: m.actor,
      span,
      summary: m.summary,
      literal: m.literal,
      detail: m.detail,
      absent: m.absent,
      code: m.code,
      humanGapBefore: m.humanGapBefore,
      humanDoing: m.humanDoing,
      children,
    }
  })
}

export function buildJourney(flow: FlowId, token: string, tokenLabel: string): Journey {
  const capture = CAPTURES[flow]
  const events = toEvents(capture, token, tokenLabel)

  return {
    id: flow,
    label: flow === 'signin' ? 'Sign-in' : 'Sign-up',
    summary:
      flow === 'signin'
        ? 'Returning user. Authorization code + PKCE, measured against the live tenant.'
        : 'First time through. Same flow, plus the three requests that only ever happen once.',
    // Both straight from the capture. Not computed here, not typed here.
    duration: capture.machineMs,
    wallClock: capture.wallMs,
    outcome: { label: 'Token issued', ok: true },
    events,
  }
}

/** The four requests that differ. This is the whole comparison, precomputed. */
export const FLOW_DIFF = {
  signupOnly: ['validate', 'createuser', 'consent'],
  signinOnly: ['kmsi'],
} as const
