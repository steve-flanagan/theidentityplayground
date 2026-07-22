// The SISU journeys — built from real captures, not from imagination.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHERE THESE NUMBERS COME FROM
//
// Real HAR captures of real flows against this real tenant, 16–18 July 2026:
// sign-up, sign-in, SSO, SSO bypassed, a silent probe, and a sign-out. Every
// millisecond below is a measured server wait (HAR `timings.wait` — request sent
// → first byte back), which is exactly the time Entra spent thinking. Nothing
// here is estimated.
//
// The sign-out was cut out of a longer recording that also held a sign-in and
// two probes — one tab, one person, four things. `--from/--to` on the derive
// script slices one action out, and the slice is recorded in the JSON, because
// summing four unrelated actions into one "flow" would produce a fabricated
// total assembled entirely out of real numbers.
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
  /**
   * A gap that was NOT a person. Sign-out has one: Entra's own page finishing up
   * before it redirects back. The gap is measured either way, but "a person,"
   * over it would be a claim we can't support — see the gate in toEvents.
   */
  idleDoing?: string
}

export type FlowId =
  | 'signup'
  | 'signin'
  | 'sso-on'
  | 'sso-off'
  | 'sso-probe'
  | 'signout'
  // Module 2's member simulation: the workforce equivalents of signin / sso-on,
  // measured off Member@ through the workforce app. A separate tab set from the
  // customer flows above — see MEMBER_FLOWS.
  | 'member-signin'
  | 'member-sso'

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
      note: 'The decoder that produced everything below, and the reason it refuses to validate.',
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
import ssoOnCapture from './captures/sso-on.json'
import ssoOffCapture from './captures/sso-off.json'
import ssoProbeCapture from './captures/sso-probe.json'
import signoutCapture from './captures/signout.json'
import memberSigninCapture from './captures/member-signin.json'
import memberSsoCapture from './captures/member-sso.json'

type CapturedRequest = {
  path: string
  /** Who actually served it. `SPA /` is our own origin, not Entra. */
  host: string
  method: string
  status: number
  /** OAuth errors ride in the redirect, not the status line. e.g. login_required. */
  oauthError?: string
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
  /**
   * Present when the flow was sliced out of a longer recording. One browser
   * session held a sign-in, two probes and a sign-out; the window says which
   * milliseconds of it this is, so the slice is provenance rather than a silent
   * edit. See scripts/har-to-timings.mjs --from/--to.
   */
  window?: { fromMs: number; toMs: number | null; note: string }
  requests: CapturedRequest[]
}

const CAPTURES: Record<FlowId, Capture> = {
  signup: signupCapture as Capture,
  signin: signinCapture as Capture,
  'sso-on': ssoOnCapture as Capture,
  'sso-off': ssoOffCapture as Capture,
  'sso-probe': ssoProbeCapture as Capture,
  signout: signoutCapture as Capture,
  'member-signin': memberSigninCapture as Capture,
  'member-sso': memberSsoCapture as Capture,
}

/**
 * What each flow is, in one line. The SSO pair is the point: sso-on and sso-off
 * are the SAME user with the SAME live Google-federated session, and they differ
 * by exactly one request parameter. 1.1 seconds against 13.5.
 *
 * ── THE OUTCOME IS PER FLOW, AND IT HAD TO BECOME SO ────────────────────────
 *
 * buildJourney used to default every flow that did not carry an OAuth error to
 * "Token issued". That held while every flow was a sign-in. A SIGN-OUT ISSUES NO
 * TOKEN — the label would have been a flat false statement, in the one badge a
 * reader glances at first, on a site whose entire argument is that its labels are
 * true. So each flow states its own ending and nothing can inherit one by
 * accident. A captured OAuth error still overrides whatever is written here: a
 * flow does not get to claim it succeeded when the capture says otherwise.
 */
export const FLOW_META: Record<
  FlowId,
  { label: string; summary: string; outcome: { label: string; ok: boolean } }
> = {
  signup: {
    label: 'Sign-up',
    summary: 'First time through. Three requests that only ever happen once, and no /kmsi.',
    outcome: { label: 'Token issued', ok: true },
  },
  signin: {
    label: 'Sign-in',
    summary: 'Interactive sign-in with a local account, no session to reuse.',
    outcome: { label: 'Token issued', ok: true },
  },
  'sso-on': {
    label: 'SSO',
    summary:
      'A live session already existed. No prompt, no typing. /authorize handed back a code off the session cookie.',
    outcome: { label: 'Token issued', ok: true },
  },
  'sso-off': {
    label: 'SSO bypassed',
    summary:
      'The same session, one parameter different: prompt=login makes Entra ignore it and re-authenticate anyway.',
    outcome: { label: 'Token issued', ok: true },
  },
  'sso-probe': {
    label: 'Silent probe',
    summary:
      'prompt=none with no session. It cannot show UI, so it fails on purpose, and the failure is the useful part.',
    // Overridden by the captured login_required anyway. Stated so the fallback is
    // never the thing that decides what a failing flow claims.
    outcome: { label: 'No token', ok: false },
  },
  signout: {
    label: 'Sign-out',
    summary:
      'Global sign-out. Two requests end the session at Entra. The local variant makes none at all.',
    outcome: { label: 'Session ended', ok: true },
  },
  'member-signin': {
    label: 'Sign-in',
    summary:
      'A workforce member, signing in with a password. Home-realm discovery, the credential, the token.',
    outcome: { label: 'Token issued', ok: true },
  },
  'member-sso': {
    label: 'SSO',
    summary:
      'The same member with a live session. No password: after the account is picked, /reprocess continues off the session.',
    outcome: { label: 'Token issued', ok: true },
  },
}

/**
 * The flows a visitor is offered, in the order they appear.
 *
 * NOT every FlowId. sso-probe is a real capture and its numbers are real, but
 * the tab strip is a list of things somebody can go and do, and a prompt=none
 * probe is not one of them: the hidden-iframe leg it needs cannot receive the
 * ciamlogin.com session cookie in any browser with third-party cookie
 * protection on, so there is no state a visitor can put their browser in that
 * makes it succeed. Sitting as a peer beside five performable flows implied
 * otherwise.
 *
 * The capture stays and the finding stays. Both moved INTO the SSO flow, onto
 * /authorize, which is the request the probe is the counterfactual to: see
 * FLOW_ANNOTATIONS['sso-on']. The id stays in FlowId because CAPTURES,
 * FLOW_META and FLOW_ONLY are all Record<FlowId, …> and the flow is still
 * buildable; what changed is that nothing offers it.
 *
 * Sign-out sits last on purpose: it is the only one that ends a session rather
 * than starting one, and its value is the contrast with the four to its left.
 */
export const TAB_FLOWS: readonly FlowId[] = [
  'signup',
  'signin',
  'sso-on',
  'sso-off',
  'signout',
]

/**
 * Module 2's member simulation has its own tab set, entirely separate from the
 * customer flows above. A visitor never really signs in as a member, so this is
 * driven by the "Sign in as Member" control, not by a lastFlow marker: the
 * timeline renders it with `simulated`, which turns off the "yours" badge and
 * the deep-link fragment. Two flows, the same signin-vs-SSO contrast the
 * customer strip makes, one tenant over.
 */
export const MEMBER_FLOWS: readonly FlowId[] = ['member-signin', 'member-sso']

/**
 * Requests unique to a flow, marked with ◆ so switching makes the diff visible.
 * Nothing here is cosmetic: each entry is a request that exists in one flow and
 * genuinely does not exist in its counterpart.
 */
export const FLOW_ONLY: Record<FlowId, readonly string[]> = {
  signup: ['validate', 'createuser', 'consent'],
  signin: ['kmsi'],
  'sso-on': [],
  'sso-off': ['federation'],
  'sso-probe': [],
  // The only two requests on the site that end a session rather than start one.
  signout: ['logout', 'logoutsession'],
  // The member pair's diff, the same shape as the customer SSO pair: signing in
  // pays home-realm discovery and the credential; reusing the session pays
  // neither and hits /reprocess instead.
  'member-signin': ['credtype', 'login'],
  'member-sso': ['reprocess'],
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
  /** What was happening in a gap that was NOT a human. See JourneyEvent.idleDoing. */
  idleDoing?: string
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

/**
 * What ONE flow says differently about a request. Merged over the shared
 * annotation rather than replacing it, `detail` included, so a flow that only
 * has its own millisecond figure to state writes one sentence instead of
 * restating what the request is and why it happens.
 *
 * This is the same shape FLOW_PHASE_COPY takes one level down, and it is the
 * same shape on purpose: a measurement belongs to a capture, so the sentence
 * quoting it belongs to a flow, and everything else falls through.
 */
type AnnotationOverride = Partial<Omit<Annotation, 'detail'>> & {
  detail?: Partial<NonNullable<Annotation['detail']>>
}

/** Shared annotation plus this flow's differences. See AnnotationOverride. */
function mergeAnnotation(base: Annotation, override?: AnnotationOverride): Annotation {
  if (!override) return base

  // `what` is the one required field, so it decides whether there is a detail
  // block at all. Everything else merges key by key.
  const what = override.detail?.what ?? base.detail?.what

  return {
    ...base,
    ...override,
    detail: what === undefined ? undefined : { ...base.detail, ...override.detail, what },
  }
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
        'Matching is exact, not prefix. A trailing slash is a mismatch. This is why msalConfig uses window.location.origin and not "/": origin yields the registered string verbatim.',
    },
  },
  {
    id: 'inside:userflow',
    label: 'User flow selected: SUSI_Email',
    summary: 'The knob that decides the rest',
    detail: {
      what: 'The sign-up/sign-in user flow bound to this app.',
      why: 'It determines the IdPs offered and the attributes collected.',
      gotcha:
        'This is the knob. Change the user flow and the sign-in page, the available identity providers, and ultimately the claims in your token all change, without touching a line of app code.',
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

/**
 * What is inside GET /logout — and, next to it, the sign-out that isn't here.
 *
 * The absent node is the point of the whole flow. A local sign-out makes NO
 * network request, so there is no capture of it and there never can be: the
 * measurement is the empty set. Rendering it as an `absent` node is the only
 * honest way to put it on a timeline — it gets the hatched treatment and says
 * why it's empty, instead of being given an invented bar next to five measured
 * ones.
 *
 * The zero-request claim is not from memory. Verified against the installed
 * @azure/msal-browser 5.17.1: clearCache() → SilentCacheClient.logout() →
 * clearCacheOnLogout(), which touches browserStorage and IndexedDB and holds no
 * network client at all.
 */
const LOGOUT_INSIDE: ZoomNode[] = [
  {
    id: 'inside:global',
    label: 'Global sign-out: the session at Entra is ended',
    summary: 'end_session_endpoint, reached by a top-level navigation',
    detail: {
      what: 'The browser leaves for the tenant and Entra invalidates the session behind the cookie, then redirects to post_logout_redirect_uri.',
      why: 'logoutRedirect(). MSAL takes the endpoint from the discovery document fetched just before this.',
      gotcha:
        'It has to be a top-level navigation. Ending a session means acting on a cookie for a host that is not ours, so the page is unloaded to do it. That is why a global sign-out costs a redirect and a full reload of the app, and the local one costs nothing.',
    },
  },
  {
    id: 'inside:local',
    label: 'Local sign-out: not this request, and not any request',
    absent:
      'clearCache() drops the tokens out of the browser and nothing leaves it. There is no capture of that flow because there is nothing to capture: no request, no response, nothing to put on an axis. The Entra session is untouched, so the next sign-in is silent SSO and /authorize hands a code straight back off the session cookie. That is the gap behind "I signed out, and it signed me straight back in."',
  },
]

/** What happens inside POST /login. Real steps, no timings — see the header. */
const CA_MFA_INSIDE: ZoomNode[] = [
  {
    id: 'inside:ca',
    label: 'Conditional Access evaluated',
    absent:
      'No policy applied on this flow. This is where the CA timeline attaches once Module 4 exists: policy set in, signals evaluated, grant or block out.',
  },
  {
    id: 'inside:mfa',
    label: 'MFA: not required',
    absent:
      'Nothing required it. When something does, this opens into the auth-methods timeline (Module 3). This tenant issues no amr either way, so the token cannot show it.',
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
      // Deliberately quotes no measurement. How much of this request is
      // connection setup varies from capture to capture, and it varies a long
      // way: 166 ms in one, 49 in another, none at all in a third. Every flow
      // that measures it overrides this with its own figure. See
      // FLOW_ANNOTATIONS.
      gotcha:
        'Some of this may not be Entra at all. DNS, TCP and TLS are paid by whichever request reaches the tenant host on a cold connection, and they are setup rather than server time. Whether this one paid them depends on what the browser already had open.',
    },
  },
  '/common/GetCredentialType': {
    match: '/common/GetCredentialType',
    id: 'credtype',
    short: 'GetCredentialType',
    label: 'POST /common/GetCredentialType',
    actor: 'entra',
    humanDoing: 'typing an email address',
    summary: 'Home-realm discovery, before a password is ever typed.',
    detail: {
      what: 'Entra decides what this identity is: a local account, or federated somewhere else.',
      why: 'It fires when the email loses focus, before the password field matters.',
      gotcha:
        'This request decides whether you get a password box or a redirect to Google. On a federated identity the flow forks right here, which is exactly why idp appears in a social token and is absent from a local one.',
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
        'Conditional Access and MFA evaluation both happen inside this one request. Neither triggered here, and neither is separately timed. A browser sees a single TTFB and nothing can decompose it.',
    },
  },
  '/{tid}/reprocess': {
    match: '/{tid}/reprocess',
    id: 'reprocess',
    short: '/reprocess',
    label: 'GET /reprocess',
    actor: 'entra',
    humanDoing: 'picking an account',
    summary: 'The session is reused. No password, just a choice of account.',
    detail: {
      what: 'Entra reprocesses the existing sign-in session for the account that was picked.',
      why: 'A live session already existed, so there was nothing to authenticate. Picking an account is enough to continue the authorize.',
      gotcha:
        'SSO with a prompt, not silent SSO. The session is reused so no credential is entered, but an account chooser still appears, which is why /reprocess stands where GetCredentialType and /login are in the sign-in. Force a fresh sign-in instead and you pay the home-realm discovery and the credential check this skips.',
    },
  },
  '/{tid}/federation/oauth2': {
    match: '/{tid}/federation/oauth2',
    id: 'federation',
    label: 'POST /federation/oauth2',
    short: '/federation',
    actor: 'entra',
    humanDoing: 'signing in at Google',
    summary: 'The trip out to Google and back. Only happens when SSO is defeated.',
    detail: {
      what: 'Entra hands off to the federated identity provider and takes the result back.',
      why: 'This account is a Google identity, and prompt=login forced a fresh authentication.',
      gotcha:
        'This entire leg is what SSO skips. Compare the two SSO flows: with the session reused it does not appear at all, and /authorize returns a code in 190 ms. Defeat the session and you pay this round trip plus the human at the other end of it: 601 ms of machine and about eleven seconds of person.',
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
        'One of the four requests that differ between signing up and signing in, and the one that decides whether the NEXT sign-in needs a password at all.',
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
        'Which attributes appear here is user-flow config, not code, and it is what decides which claims can exist in the token later.',
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
      why: 'First time through. There is no account yet.',
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
    label: 'GET / · the SPA reloads',
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
      note: 'loginRedirect, not loginPopup. Popups get blocked, and they behave badly on mobile.',
    },
    detail: {
      what: 'The authorization code goes back with the original code_verifier, and the ID token comes out.',
      why: 'Redeeming the code.',
      gotcha:
        'No client secret anywhere. A SPA cannot keep one, which is the entire reason PKCE exists. The verifier is the proof instead.',
    },
  },
  '/{tid}/oauth2/v2.0/logout': {
    match: '/{tid}/oauth2/v2.0/logout',
    id: 'logout',
    short: '/logout',
    label: 'GET /oauth2/v2.0/logout',
    actor: 'network',
    summary: 'RP-initiated logout. The request the local sign-out never makes.',
    code: {
      file: 'web/src/components/SignInPanel.tsx',
      source: signInPanelSource,
      note: 'Both sign-outs, in one file: signOutAppOnly() calls clearCache() and touches no network at all; signOutEverywhere() calls logoutRedirect() and produces everything on this timeline.',
    },
    detail: {
      what: 'The browser navigates to end_session_endpoint and Entra returns its sign-out page.',
      why: 'logoutRedirect(), the "sign out everywhere" button.',
      gotcha:
        'Local sign-out ends at the browser. This one leaves it, and that single request is the entire difference between them.',
    },
  },
  '/{tid}/oauth2/v2.0/logoutsession': {
    match: '/{tid}/oauth2/v2.0/logoutsession',
    id: 'logoutsession',
    short: '/logoutsession',
    label: 'POST /oauth2/v2.0/logoutsession',
    actor: 'entra',
    humanDoing: 'picking which account to sign out',
    summary: "What Entra's own sign-out page posts once you have picked an account.",
    detail: {
      what: 'The second half of the sign-out: the account chosen on the page is submitted back to the tenant.',
      why: 'The sign-out page returned by /logout offered an account picker. Its assets are in the same capture.',
      gotcha:
        'The picker exists because a browser can hold more than one Entra session. Sign-out is per account, not per browser, so "I signed out" and "I am signed out" are different statements, and the one you ended is not necessarily the one the next app picks up.',
    },
  },
}

/**
 * Prose that is only true in ONE flow, keyed by flow and then by request path.
 *
 * The shared map above is keyed by path alone, which was fine while every flow
 * was a sign-in: `SPA /` meant the same thing in all of them. It stopped being
 * true the moment a sign-out landed on the same URL — the shared entry says the
 * browser arrives "carrying the code in the fragment", and after a sign-out
 * there is no code and nothing to carry. Rather than water the sign-in copy down
 * to something vague enough to cover both, a flow can override one path and say
 * the specific true thing. Anything not overridden falls through to the shared
 * map, so this stays small by construction.
 *
 * ── /authorize, which was the same bug at request level ─────────────────────
 *
 * The shared gotcha on /authorize read "166 ms of this is spent before Entra
 * reads a byte… one of only two requests in the flow that pays that. The
 * discovery call ahead of it is the other. Everything afterwards reuses a
 * connection and is pure server time." Measured off the sign-in capture, keyed
 * by path, rendered in all five flows that have an /authorize. It is true in
 * exactly one of them.
 *
 *   signin     11 + 74 + 81 = 166. Discovery pays 57. Nothing after pays. TRUE.
 *   signup      0 + 27 + 22 =  49, and no DNS at all. Discovery pays 66.
 *   sso-off     1 + 85 + 82 = 168. Discovery is a 0 ms cache hit, so the other
 *                                  payer is /token, at 154.
 *   sso-on      0 + 0 + 0. The request pays nothing and has no phases to open.
 *   sso-probe   0 + 0 + 0. Same.
 *
 * So the reader of four flows out of five was invited to open a phase
 * breakdown against a figure that flow never measured, on the flagship row.
 */
const FLOW_ANNOTATIONS: Partial<Record<FlowId, Record<string, AnnotationOverride>>> = {
  signup: {
    '/{tid}/oauth2/v2.0/authorize': {
      detail: {
        gotcha:
          '49 ms of this is spent before Entra reads a byte: TCP and TLS, and no DNS, because the discovery call resolved the host a moment earlier. Open the phases and it is right there. This is one of only two requests in the flow that pays for a connection. The discovery call is the other, at 66 ms. Everything afterwards reuses one and is pure server time.',
      },
    },
  },
  signin: {
    '/{tid}/oauth2/v2.0/authorize': {
      detail: {
        gotcha:
          '166 ms of this is spent before Entra reads a byte: DNS, TCP, TLS. Open the phases and it is right there. This is one of only two requests in the flow that pays that. The discovery call ahead of it is the other, at 57 ms. Everything afterwards reuses a connection and is pure server time.',
      },
    },
  },
  'sso-on': {
    '/{tid}/oauth2/v2.0/authorize': {
      // Where the silent probe lives now. It was a tab of its own beside five
      // flows a visitor can perform, which read as a sixth thing to try; it is
      // not one, and this is the request it is the counterfactual to. Same
      // endpoint, same session, one parameter and one browsing context
      // different, opposite outcomes. The capture is untouched: 197 ms and
      // login_required are read off sso-probe.json.
      detail: {
        gotcha:
          'None of this is connection setup. DNS, TCP and TLS all measured 0 ms, so the whole 190 ms is Entra reading the session cookie and handing back a code. The same endpoint with prompt=none, sent from a hidden iframe, came back login_required in 197 ms with that session still live. Firefox partitions the ciamlogin.com cookie away from a third-party frame, so Entra never sees it and answers AADSTS50058, "the cookies used to represent the user\'s session were not sent in the request." Silent SSO by iframe is finished in any browser with that protection on. This request works because a top-level navigation is first-party.',
      },
    },
  },
  'sso-off': {
    '/{tid}/oauth2/v2.0/authorize': {
      detail: {
        gotcha:
          '168 ms of this is spent before Entra reads a byte: DNS, TCP, TLS. Open the phases and it is right there. One other request in this flow pays for a connection and it is /token, at 154 ms. The discovery call ahead of it measured 0 ms, because the answer was already in the browser.',
      },
    },
  },
  'sso-probe': {
    '/{tid}/oauth2/v2.0/authorize': {
      detail: {
        gotcha:
          'None of this is connection setup. The whole 197 ms is Entra deciding it cannot answer, then saying so: prompt=none forbids showing UI, so the only move left is a redirect carrying login_required.',
      },
    },
  },
  signout: {
    '/{tid}/v2.0/.well-known/openid-configuration': {
      match: '/{tid}/v2.0/.well-known/openid-configuration',
      id: 'discovery',
      short: 'discovery',
      label: 'GET /.well-known/openid-configuration',
      actor: 'network',
      summary: 'Read again, this time for end_session_endpoint.',
      detail: {
        what: 'The same discovery document, re-read so MSAL can find the sign-out endpoint.',
        why: 'MSAL builds the logout URL from metadata rather than from a hardcoded path.',
        gotcha:
          'Zero on the clock: no round trip happened, the answer was already in the browser. The sign-out URL is assembled entirely from a document fetched for a different purpose minutes earlier, which is why the whole sign-out starts 18 ms after the button.',
      },
    },
    'SPA /': {
      match: 'SPA /',
      id: 'spa',
      short: 'SPA reload',
      label: 'GET / · the SPA reloads, signed out',
      actor: 'browser',
      idleDoing: "Entra's sign-out page, before it hands the browser back",
      summary: 'Back on our own origin at post_logout_redirect_uri.',
      detail: {
        what: 'The browser lands back on the app and boots it fresh, with nothing in the cache.',
        why: 'postLogoutRedirectUri, set to window.location.origin in msalConfig.',
        gotcha:
          'The flow ends here. There is no /token after it, because there is nothing to redeem. Count the requests. On a sign-in this exact same reload is the moment MSAL finds the code in the fragment and spends it; here the reload is the last thing that happens.',
      },
    },
  },
  'member-signin': {
    '/{tid}/oauth2/v2.0/authorize': {
      // The shared entry points at the CIAM msalConfig and promises four inside
      // steps to open. The workforce member goes through a different app, and this
      // sample does not expose that app's internals, so both are dropped. The
      // connection-setup gotcha underneath is generic and stays.
      code: undefined,
      summary: 'The browser leaves for the workforce tenant to start the sign-in.',
      detail: {
        what: 'The browser leaves for the workforce tenant carrying client_id, redirect_uri, scope, state, nonce and the PKCE challenge.',
        why: 'The workforce authority this app registration is configured with.',
      },
    },
    '/{tid}/login': {
      detail: {
        why: 'A native workforce credential, checked against the directory.',
        gotcha:
          'Conditional Access and MFA are evaluated inside this one request when a policy applies. Neither did here, and a browser sees a single TTFB either way, so nothing inside it is separately timed.',
      },
    },
    '/{tid}/oauth2/v2.0/token': {
      // Same as authorize: the shared code reference is the CIAM sign-in panel,
      // not this flow. The PKCE / no-secret point in the shared detail still
      // holds, the member app being a SPA too.
      code: undefined,
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
    // Was "Only the first trip to a host pays." It is not a rule, and the
    // sign-in capture breaks it on the same host inside a fifth of a second:
    // 9 ms on the discovery call and 11 ms again on /authorize. The sentence
    // rendered on the 11 ms row, denying the number it sat under. Quotes
    // nothing now; the flow that measured it says so itself.
    gotcha:
      'Most requests here measure 0 for it, because the browser already holds an answer. Having resolved a host once is not a guarantee that the next request to it is free.',
  },
  connect: { label: 'TCP connect', what: 'Opening the socket.' },
  ssl: {
    label: 'TLS handshake',
    what: 'Negotiating the encrypted channel.',
    // Deliberately quotes no measurement. Which requests pay for a connection,
    // and how much, is a fact about one capture — see FLOW_PHASE_COPY.
    gotcha:
      'Setting up a connection is what costs here. A request that reuses one pays none of it.',
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

/**
 * Phase prose that is only true in ONE flow, keyed by flow and then by phase.
 * The same mechanism as FLOW_ANNOTATIONS, one level down.
 *
 * PHASE_COPY is keyed by phase name alone, so a sentence written off the sign-in
 * capture rendered on every flow. The TLS gotcha named the two requests that pay
 * for a connection (57 ms and 166 ms) and listed /token among the ones that
 * reuse. True in four flows. In sso-off /token opens a fresh connection and pays
 * 73 ms of connect and 81 ms of TLS, and the sentence rendered as the gotcha ON
 * that handshake row: the page told the reader a connection cost nothing,
 * directly beneath the 81 ms it had just charged for one.
 *
 * A measurement belongs to a capture, so the prose quoting it belongs to a flow.
 * Anything not overridden falls through to PHASE_COPY, which quotes nothing.
 *
 * `ssl` is here for three flows because only three pay for a connection at all:
 * sso-on, sso-probe and signout reuse throughout and render no phase rows for
 * it. `dns` is here for one, because sign-in is the flow that disproves the
 * sentence PHASE_COPY.dns used to carry.
 */
const FLOW_PHASE_COPY: Partial<Record<FlowId, Record<string, { gotcha: string }>>> = {
  signup: {
    ssl: {
      gotcha:
        'Setting up a connection is what costs here. Two requests pay it: the discovery call (66 ms) and /authorize (49 ms). Everything after them reuses a connection, so the 1673 ms in createuser is pure server time.',
    },
  },
  signin: {
    ssl: {
      gotcha:
        'Setting up a connection is what costs here. Only two requests pay it: the discovery call (57 ms) and /authorize (166 ms). Every request after them reuses a connection and pays nothing: GetCredentialType, /login, /kmsi and /token are all pure server time. It is why the second half of the flow looks so cheap.',
    },
    dns: {
      gotcha:
        'Paid twice on the same host in this flow: 9 ms on the discovery call, then 11 ms again on /authorize a fifth of a second later. A resolved host does not stay resolved.',
    },
  },
  'sso-off': {
    ssl: {
      gotcha:
        'Setting up a connection is what costs here. Two requests pay it: /authorize (168 ms) and /token (154 ms). In every other capture /token reuses a connection.',
    },
  },
}

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
function toEvents(
  flow: FlowId,
  capture: Capture,
  token: string,
  tokenLabel: string,
): JourneyEvent[] {
  let clock = 0

  /**
   * The member simulation reuses the shared request annotations, which are
   * mostly generic OAuth mechanics, but its authorize must not open into the
   * CIAM-specific inside steps below. See the insideWait assignment.
   */
  const memberFlow = flow.startsWith('member-')

  /** This flow's overrides, if it has any. Falls through to the shared map. */
  const overrides = FLOW_ANNOTATIONS[flow] ?? {}

  /** The same, for the phase rows inside a request. See FLOW_PHASE_COPY. */
  const phaseOverrides = FLOW_PHASE_COPY[flow] ?? {}

  // A path can repeat: MSAL fetches the discovery document once at startup and
  // again after the SPA reloads. Annotations are keyed by path, so both requests
  // used to come out with id 'discovery' — duplicate React keys, and React's
  // documented response to that is to duplicate and/or omit children. It showed
  // up as phantom rows in every detail view. Ids are per-occurrence now.
  const seen = new Map<string, number>()

  return capture.requests.map((r) => {
    // Shared prose first, then this flow's differences merged over it. An
    // override used to REPLACE the entry, which meant a flow correcting one
    // sentence had to restate the whole annotation. See mergeAnnotation.
    const a = mergeAnnotation(ANNOTATIONS[r.path] ?? generic(r), overrides[r.path])

    const nth = (seen.get(a.id) ?? 0) + 1
    seen.set(a.id, nth)
    const id = nth === 1 ? a.id : `${a.id}-${nth}`

    // A repeat that costs nothing is a cache hit, and saying so is better than
    // showing the same row twice with no explanation.
    const cached = nth > 1 && r.total === 0

    const m: Measured = {
      ...a,
      id,
      label: cached ? `${a.label} (cached)` : a.label,
      short: cached ? `${a.short ?? a.label} (cached)` : a.short,
      summary: cached
        ? 'Same document, second ask. Served from cache in 0 ms.'
        : a.summary,
      detail: cached
        ? {
            what: 'MSAL re-reads the discovery document after the redirect, because the page was torn down and rebuilt.',
            why: 'The SPA reloaded. Everything in memory went with it.',
            gotcha:
              'Zero milliseconds. The browser had it cached, so the second ask costs nothing.',
          }
        : a.detail,
      total: r.total,
      timings: r.timings,
      // Only call it a human if it's long enough to be one AND we can say what
      // they were doing. Sub-second gaps are the browser, not a person, and
      // labelling those "you, typing" would be a small lie in a place that can't
      // afford any.
      //
      // The second half of that gate arrived with sign-out, which has a 1.1s gap
      // that is NOT a person: Entra's own page finishing before it redirects
      // back. Without the gate the row would have read "a person," with nothing
      // after it — an unsupported claim rendered by an accident of copy. Every
      // gap over a second in the five older captures already carries a
      // humanDoing, so nothing about them changes.
      humanGapBefore: r.idleBefore >= 1000 && (a.humanDoing || a.idleDoing) ? r.idleBefore : undefined,
    }

    const span = { start: clock, end: clock + m.total }
    clock = span.end

    // What hangs off the `wait` phase — the part Entra won't itemise. The member
    // sample deliberately does NOT open the authorize internals: those steps (the
    // SUSI_Email user flow, the msalConfig redirect) are CIAM-specific and untrue
    // of a workforce app, so a member authorize shows its real phases and stops.
    const insideWait: ZoomNode[] =
      m.id === 'authorize'
        ? memberFlow
          ? []
          : AUTHORIZE_INSIDE
        : m.id === 'login'
          ? CA_MFA_INSIDE
          : m.id === 'logout'
            ? LOGOUT_INSIDE
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
            ? /ciamlogin|login\.microsoftonline\.com/.test(r.host)
              ? 'Waiting: Entra thinking'
              : 'Waiting: our host responding'
            : copy.label,
        span: phaseSpan,
        summary: `${ms} ms`,
        // The flow's own sentence if it has one, otherwise the shared copy.
        detail: { what: copy.what, gotcha: phaseOverrides[key]?.gotcha ?? copy.gotcha },
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
      idleDoing: m.idleDoing,
      children,
    }
  })
}

export function buildJourney(flow: FlowId, token: string, tokenLabel: string): Journey {
  const capture = CAPTURES[flow]
  const events = toEvents(flow, capture, token, tokenLabel)

  // The outcome comes from the capture, not from an assumption that every flow
  // succeeds. A silent probe against no session returns login_required, and
  // saying so is the whole value of that flow — an OAuth failure arrives as a
  // 302 carrying an error, never as a 4xx, which is why the script digs the code
  // out of the redirect rather than reading the status line.
  const failure = capture.requests.find((r) => r.oauthError)

  return {
    id: flow,
    label: FLOW_META[flow].label,
    summary: FLOW_META[flow].summary,
    // Both straight from the capture. Not computed here, not typed here.
    duration: capture.machineMs,
    wallClock: capture.wallMs,
    // A captured error always wins; otherwise the flow's own stated ending. This
    // used to fall back to "Token issued" for anything without an error, which
    // was true of five sign-in flows and false the instant a sign-out arrived.
    // See FLOW_META.
    outcome: failure ? { label: failure.oauthError!, ok: false } : FLOW_META[flow].outcome,
    events,
  }
}
