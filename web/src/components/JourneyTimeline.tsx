import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  ACTOR_LABELS,
  buildJourney,
  FLOW_META,
  FLOW_ONLY,
  TAB_FLOWS,
  codeUrl,
  spanMs,
  type Actor,
  type FlowId,
  type Journey,
  type Span,
  type ZoomNode,
} from '../lib/journey'
import { highlight, TOKEN_CLASS } from '../lib/highlight'
import { readLastFlow, type FlowMatch } from '../lib/lastFlow'

// Overview + detail. The pattern every profiler, packet capture and network
// waterfall uses, because it's the one that survives being kept open all day.
//
//   OVERVIEW — always the whole 1,400 ms. Never zooms. A brush marks the slice
//              you're looking at, so the total scale is never off screen.
//   DETAIL   — the current level, on its own axis, with readable labels in
//              their own column. Click a slice with subsections and the detail
//              rescales: 0–1400 becomes 4–18 and the bars slide into place.
//
// Both halves of this are things Steve asked for at different times and they
// were never in conflict — an earlier pass threw the readable rows away to make
// room for a big track, which was an error, not a tradeoff.
//
// This is built to be a reference someone keeps on a second monitor, not a
// spectacle: deep-linkable per step, keyboard-reachable, copyable values, dense
// by default. Desktop-first; on a phone the track scrolls rather than the
// desktop layout being compromised to fit one.

type Props = {
  token: string
  tokenLabel: string
  /**
   * Bumped by App every time the visitor signs out of this app only. See the
   * block where it is consumed for why that path bypasses lastFlow entirely.
   *
   * Optional and untouched by default, so mounting this component standalone
   * (App2, the tests) behaves exactly as it did before.
   */
  localSignOutCount?: number
  /**
   * Sign-up or sign-in, once the answer is known. There is no network call
   * behind it: the account's creation time rides in on the ID token the app is
   * already holding, as the `createddatetime` claim a claims mapping policy
   * puts there. See ACCOUNT_CREATED_CLAIM and accountCreatedAtMs in
   * lib/lastFlow. Producing the answer costs a base64 decode.
   *
   * It still arrives after mount, and that is an ordering fact rather than a
   * waiting one: this component picks its flow in a useState initialiser, which
   * runs during render, and the effect in App that decodes the token runs after
   * every render. See the block where it is consumed.
   *
   * Null when there is no token, when the claim is absent or cannot be read
   * confidently, or when the flow was never ambiguous in the first place. Null
   * is the common case and it changes nothing.
   */
  resolvedFlow?: FlowMatch
}

/**
 * Bar colour = who did the work. Carries information, or it isn't allowed.
 *
 * SETTLED. Two rounds of treatments went into the page behind a toggle and this
 * is the one that was picked: the solid saturated fill. Outline-and-tint lost.
 *
 * THE ASSIGNMENT IS PART OF THE ANSWER, not an accident of it, and it is the
 * part that moved. An earlier map read browser BLUE / network GREY / entra
 * GREEN. These are the same three fills rotated one step, and this is the
 * rotation that was on screen when it was approved. Do not rotate them back.
 */
const ACTOR_BAR: Record<Actor, string> = {
  browser: 'bg-slate-400',
  network: 'bg-emerald-400',
  entra: 'bg-sky-400',
}

/**
 * The name printed on a slice, on the overview track.
 *
 * SETTLED. Six variants went into the page behind a toggle — mono, sans, a
 * different mono, bigger, lighter, wider — and this is the one that was picked.
 * Typeface only: the size, weight and tracking never moved off the baseline, so
 * they are back on the span as the plain `text-sm font-semibold` they always
 * were. This is the whole of the change.
 *
 * Why the stack is written out rather than `font-sans`: Tailwind's --font-sans
 * ends in four emoji families, and this is the stack that was actually on screen
 * when it was picked. A request name never reaches an emoji glyph, so the two
 * would render the same — but "the same" is a judgement and the literal stack
 * needs none. Mono was buying column alignment that a bar label does not use;
 * nothing on this track lines up vertically with anything.
 */
const SLICE_LABEL_FONT: CSSProperties = {
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', 'Noto Sans', Arial, sans-serif",
}

const TICK_FRACTIONS = [0, 0.25, 0.5, 0.75, 1]

/**
 * The elapsed round trip, for the badge and nothing else.
 *
 * ── WHY THIS IS NOT JUST toFixed(1) ─────────────────────────────────────────
 *
 * It was. Under two minutes that is exactly right and nothing here changes it:
 * a sign-in is seconds, and 20.8s is a number a reader can hold.
 *
 * Past that it stops being one. STALE_AFTER_MS allows fifteen minutes, because
 * External ID mails a verification code and a sign-up genuinely waits on an
 * inbox, so a thirteen-minute sign-up is a real flow that now gets a badge. In
 * seconds to one decimal it reads "It took 786.3s." That is true, and it looks
 * fabricated, which on this page costs more than being unreadable would: the
 * comment the fifteen-minute change replaced named "your sign-in took 825.0s"
 * as the exact thing that must never appear, and the anchor moved without the
 * formatting moving with it.
 *
 * So the number stays the measurement and only its units change. Minutes and
 * seconds are how anybody says a thirteen-minute wait out loud, and the decimal
 * is dropped there because a tenth of a second is not information at that
 * scale.
 */
export function formatElapsed(ms: number): string {
  if (ms < 120_000) return `${(ms / 1000).toFixed(1)}s`

  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  // A remainder above 59.5s rounds to 60. Carry it, rather than print "13m 60s".
  return seconds === 60 ? `${minutes + 1}m 0s` : `${minutes}m ${seconds}s`
}

const actorOf = (n: ZoomNode, fallback: Actor = 'entra'): Actor =>
  (n as { actor?: Actor }).actor ?? fallback

const timedChildren = (n: ZoomNode) => (n.children ?? []).filter((c) => c.span)

/** left/width against an axis. The entire zoom, right here. */
function place(span: Span, axis: Span) {
  const w = spanMs(axis)
  return {
    left: `${((span.start - axis.start) / w) * 100}%`,
    width: `${Math.max((spanMs(span) / w) * 100, 0.3)}%`,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// THE URL FRAGMENT IS NOT OURS. IT IS MSAL'S.
//
// Entra returns the authorization code in the fragment:
//   https://theidentityplayground.com/#code=…&client_info=…&state=…
//
// An earlier version of this component wrote the fragment from an effect on
// mount, which stripped that response before MSAL could read it and silently
// broke every sign-in in production. It wasn't even a race: React runs child
// effects before parent effects, and this component is a child of MsalProvider,
// so it lost every time.
//
// Two rules keep it fixed, and both are load-bearing:
//
//   1. NAMESPACE. Only a fragment starting with `step=` or `flow=` is ours.
//      MSAL's starts with `code=` or `error=`, and neither `step` nor `flow` is
//      a parameter any OAuth or OIDC response carries. We never read or write
//      anything else.
//   2. NEVER WRITE ON MOUNT. The fragment is only written in response to a
//      click — by which time MSAL has long since consumed and cleared its own.
//
// If you are about to touch location.hash here, re-read this first.
// ─────────────────────────────────────────────────────────────────────────────

const STEP_PREFIX = 'step='
const FLOW_PREFIX = 'flow='

/** The namespace rule, in one place, so read and write cannot disagree. */
const oursToTouch = (raw: string) =>
  raw.startsWith(STEP_PREFIX) || raw.startsWith(FLOW_PREFIX)

/**
 * A deep link, parsed.
 *
 * ── WHY THE FLOW HAD TO GO IN THE FRAGMENT ──────────────────────────────────
 *
 * The fragment used to be `#step=…` alone, and step ids are only unique WITHIN
 * a flow. Everything resolved against whichever flow the page happened to open
 * on, which is sign-in, so a link to any step that does not exist in a sign-in
 * silently resolved to nothing and dumped the reader at the top of a flow they
 * did not ask for. Measured against the real captures: 47 node paths out of
 * 183 were unreachable that way, including every request unique to sign-up
 * (/validate, /createuser, /Consent/Set), the /federation leg that is the whole
 * point of the SSO comparison, and both halves of the sign-out.
 */
type StepLink = {
  /** Named explicitly by `#flow=`, and only if it is a flow with a tab. */
  flow: FlowId | null
  /** The step path, outermost first. Empty when the fragment isn't ours. */
  ids: string[]
}

/**
 * Only a flow a visitor can actually get back to by clicking. sso-probe builds
 * and is real data, but it deliberately has no tab (see TAB_FLOWS), so landing
 * a deep link on it would strand the reader on a flow the tab strip cannot
 * show as selected.
 */
const asFlowId = (value: string | null): FlowId | null =>
  value && (TAB_FLOWS as readonly string[]).includes(value) ? (value as FlowId) : null

/** Our fragment, parsed — or nothing, if the fragment isn't ours. */
function readStepHash(): StepLink {
  const raw = location.hash.replace(/^#/, '')
  if (!oursToTouch(raw)) return { flow: null, ids: [] }

  // Ids are made of word characters, ':' and '-', none of which URLSearchParams
  // touches, so a step path survives the round trip verbatim.
  const params = new URLSearchParams(raw)
  return {
    flow: asFlowId(params.get('flow')),
    ids: (params.get('step') ?? '').split('/').filter(Boolean),
  }
}

/**
 * Called from click handlers only. Never from an effect, never on mount.
 *
 * The flow is written every time, not just when it is not the default one.
 * Whatever is in the address bar is what somebody pastes into Slack, and a link
 * that only works if the reader happens to open on the same flow is the bug
 * this is fixing. An empty path still clears the fragment outright, so backing
 * out to the top leaves a clean URL exactly as it always did.
 */
function writeStepHash(flow: FlowId, path: ZoomNode[]): void {
  // Refuse to touch an auth response even if somehow called during one.
  const raw = location.hash.replace(/^#/, '')
  if (raw && !oursToTouch(raw)) return

  const ids = path.map((n) => n.id).join('/')
  history.replaceState(
    null,
    '',
    ids
      ? `#${FLOW_PREFIX}${flow}&${STEP_PREFIX}${ids}`
      : location.pathname + location.search,
  )
}

/** Resolve a deep link like #step=pkce/pkce:nonce back into real nodes. */
function resolvePath(ids: string[], roots: ZoomNode[]): ZoomNode[] {
  const out: ZoomNode[] = []
  let level = roots
  for (const id of ids) {
    const found = level.find((n) => n.id === id)
    if (!found) break
    out.push(found)
    level = found.children ?? []
  }
  return out
}

const resolvesFully = (ids: string[], roots: ZoomNode[]) =>
  resolvePath(ids, roots).length === ids.length

/**
 * Which flow a deep link opens on. Pure, and it runs during render, so it must
 * not touch location — reading the fragment already happened, and writing it on
 * a mount path is the outage above.
 *
 * The order is the compatibility rule. `#step=` links that predate `#flow=`
 * resolve in the flow the page would have opened on anyway, so every one of
 * them that works today still works; only the ones that resolved to nothing go
 * looking elsewhere. An explicit `#flow=` is an instruction and skips the
 * search entirely.
 *
 * A step that matches nothing anywhere leaves the flow alone, and resolvePath
 * then does its usual best-effort partial resolve. That is the existing
 * behaviour for a bad link and it is the right one: land at the top of the
 * journey, never error.
 */
function landingFlow(
  link: StepLink,
  current: FlowId,
  eventsFor: (flow: FlowId) => ZoomNode[],
): FlowId {
  if (link.flow) return link.flow
  if (!link.ids.length) return current
  if (resolvesFully(link.ids, eventsFor(current))) return current

  return (
    TAB_FLOWS.find((f) => f !== current && resolvesFully(link.ids, eventsFor(f))) ?? current
  )
}

export function JourneyTimeline({
  token,
  tokenLabel,
  localSignOutCount = 0,
  resolvedFlow = null,
}: Props) {
  /**
   * Which real capture we're showing. Both were measured against the live tenant
   * on 16 July; switching between them IS the demo — same app, same person, and
   * exactly four requests different.
   */
  /**
   * What the visitor actually just did, if we can honestly tell. Read once on
   * mount: landing on a recording of a flow you did not perform is what made
   * this page look fabricated, so it opens on the real one where possible.
   */
  const [lastFlow, setLastFlow] = useState(() => readLastFlow())

  /**
   * The deep link, read ONCE during the first render. Held in state rather than
   * re-read, because the fragment is rewritten on every click and the landing
   * decision below is about where the visitor arrived, not where they have got
   * to since.
   */
  const [link] = useState(readStepHash)

  /**
   * A deep link outranks the flow the page would otherwise open on, because it
   * is the more specific request: the visitor followed a link to a step. What
   * they just performed is still stated in the banner and still badged on its
   * tab, so nothing is lost by showing them what they asked for.
   *
   * Costs one extra buildJourney per candidate flow, and only when a fragment
   * is present and does not resolve where the page was already going. With no
   * fragment it short-circuits before building anything.
   */
  const [flow, setFlow] = useState<FlowId>(() =>
    landingFlow(link, lastFlow?.kind === 'matched' ? lastFlow.flow : 'signin', (f) =>
      buildJourney(f, token, tokenLabel).events,
    ),
  )

  /** The one flow we can honestly say the visitor performed, if any. */
  const yours = lastFlow?.kind === 'matched' ? lastFlow.flow : null

  const journey: Journey = useMemo(
    () => buildJourney(flow, token, tokenLabel),
    [flow, token, tokenLabel],
  )

  /**
   * The one piece of state. Everything else is derived from it.
   *
   * Seeded from the deep link during render, NOT in an effect. Reading it in an
   * effect races the effect that writes it: StrictMode double-invokes effects in
   * dev, so the write pass (path still empty) wiped the hash before the second
   * read pass saw it, and the link silently resolved to nothing.
   *
   * Resolved against the journey the line above settled on, so the nodes in the
   * path are the same objects the rest of the render is working with.
   */
  const [path, setPath] = useState<ZoomNode[]>(() => resolvePath(link.ids, journey.events))

  /**
   * Brushing and linking (Becker/Cleveland, late 1980s — canonical, not
   * invented). The bar and the rows are one dataset in two renderings, and
   * without this you're left eyeballing a stripe against a table and guessing
   * which is which. Touch either and both light up. It's the cheapest fix in
   * here and it's the one that answers "what am I even looking at".
   */
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  /**
   * ── The sign-up / sign-in answer, which arrives late ──────────────────────
   *
   * Every other flow is known before this component renders: the marker is in
   * sessionStorage and readLastFlow is synchronous. This one is decided from a
   * claim on the ID token, and it lands after mount for a structural reason
   * rather than a slow one. The flow is picked in a useState initialiser, which
   * runs during this component's render; the decode that settles it runs in an
   * effect in App, and effects run after render. So the timeline has always
   * already opened on something by the time the answer exists.
   *
   * Adopting it means moving the badge and the selected flow together. They are
   * the same fact: `yours` is derived from lastFlow, and the tab is what the
   * visitor is looking at. Move one without the other and the page either
   * badges a flow it is not showing or shows a flow it will not badge.
   *
   * Compared during render for the same reason the sign-out below is, and it
   * deliberately does not call navigate() for the same reason either — that
   * writes the URL fragment, and this runs during render. Read the block above
   * readStepHash before changing it.
   *
   * Sits ABOVE the sign-out branch so that a sign-out, which is a thing the
   * visitor just did, outranks an answer about a session they have now left.
   */
  const [seenResolved, setSeenResolved] = useState(resolvedFlow)
  if (resolvedFlow !== seenResolved) {
    setSeenResolved(resolvedFlow)
    if (resolvedFlow?.kind === 'matched') {
      setLastFlow(resolvedFlow)
      setFlow(resolvedFlow.flow)
      setPath([])
    }
  }

  /**
   * ── A local sign-out selects its flow HERE, not through lastFlow ──────────
   *
   * lastFlow measures a redirect round trip: mark a start time, let the page
   * unload, and freeze `Date.now() - started` when the browser comes back.
   * Signing out of this app only calls clearCache() and never navigates, so
   * there is no round trip, nothing to measure, and nothing to say. Routing it
   * through lastFlow would have produced an elapsed time made of idle minutes
   * and a banner announcing it.
   *
   * So the switch happens in the page and the page says nothing about timing.
   * The lastFlow reset is the same motion: the banner and the "yours" badge are
   * about a session that has just been dropped here, and clearLastFlow() has
   * already taken their storage — this takes the copy that was read on mount.
   *
   * Compared during render rather than in an effect. React re-runs the
   * component immediately on a state update from render, so the previous flow
   * is never committed; an effect would paint it for a frame first, and a click
   * registering instantly is the constraint this component is built around.
   * `seen` starts at the prop's own first value, so the branch cannot fire on
   * mount.
   *
   * It deliberately does NOT call navigate(), because navigate() writes the URL
   * fragment and this runs during render. Read the block above readStepHash
   * before changing that. The cost is a stale `#flow=…&step=…` left in the
   * address bar if the visitor had drilled into a step before signing out; the
   * next click on the timeline overwrites it.
   */
  const [seenSignOutCount, setSeenSignOutCount] = useState(localSignOutCount)
  if (localSignOutCount !== seenSignOutCount) {
    setSeenSignOutCount(localSignOutCount)
    setFlow('signout')
    // The path holds nodes from the journey being left. Carrying them into a
    // different flow would zoom the axis to a step that is not in it.
    setPath([])
    setLastFlow(null)
  }

  /**
   * The only thing that writes the fragment. A couple of places move the path
   * without it — Escape, and the local sign-out above — and they are the reason
   * to state the invariant this way round: the fragment is only ever written
   * from a real click. See the note above readStepHash for why that matters
   * more than it looks.
   */
  function navigate(next: ZoomNode[]) {
    setPath(next)
    writeStepHash(flow, next)
  }

  /**
   * Up one level, and the only definition of "back" in here.
   *
   * It is one function rather than two call sites because it used to be two and
   * they did different things: Escape dropped the last node, the button jumped
   * clear of the whole zoom container. From two levels deep inside one request
   * they landed in different places, and the one the visitor could see was the
   * one that overshot. The guard lives in here too, so neither caller can fire
   * on an empty path.
   *
   * Memoised on `path` so the Escape listener below re-subscribes when the path
   * moves and not on every hover. It does the same two things navigate() does,
   * and it is reached only from a click handler and a keydown handler, so
   * writing the fragment is allowed. Read the block above readStepHash before
   * that stops being true.
   */
  const back = useCallback(() => {
    if (!path.length) return
    const next = path.slice(0, -1)
    setPath(next)
    writeStepHash(flow, next)
  }, [flow, path])

  const selected = path[path.length - 1] ?? null

  // Zoom follows the deepest thing in the path that actually contains timed
  // things. Selecting a leaf doesn't move the camera — there's nothing inside
  // it to get closer to, and its siblings should stay put.
  const zoomContainer =
    [...path].reverse().find((n) => n.span && timedChildren(n).length > 0) ?? null

  const axis: Span = zoomContainer?.span ?? { start: 0, end: journey.duration }
  const detailNodes = zoomContainer ? timedChildren(zoomContainer) : journey.events
  const share = (spanMs(axis) / journey.duration) * 100

  /**
   * Time this page can actually attribute to a person — the sum of the gaps it
   * labels "a person, …", and nothing else.
   *
   * The header used to derive it as wall minus machine, which was fine while
   * every non-machine second was somebody typing. Sign-out broke that: 1.1s of
   * its 2.6s idle is Entra's own sign-out page redirecting, so "2.6s of it a
   * person" overstated the human by 43% on the one flow where a reader would be
   * most likely to check. Summing what is actually attributed can only ever
   * report gaps the rows themselves already name.
   */
  const attributedHumanMs = journey.events.reduce(
    (total, event) => total + (event.humanDoing ? (event.humanGapBefore ?? 0) : 0),
    0,
  )

  // Escape backs out one level. Cheap, and it's what a tool should do. Same
  // back() the control in the breadcrumb calls, which is the point.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') back()
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [back])

  /** Select a node at the current detail level. */
  function open(node: ZoomNode) {
    const prefix = zoomContainer ? path.slice(0, path.indexOf(zoomContainer) + 1) : []
    navigate([...prefix, node])
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50">
      {/* What the visitor actually just did, stated before anything else — and,
          just as importantly, that everything below is a RECORDING. Showing a
          capture of a flow they didn't perform, unlabelled, is what made this
          read as fabricated. */}
      {lastFlow && (
        <div
          className={`border-b px-5 py-3 text-sm leading-relaxed ${
            lastFlow.kind === 'matched'
              ? 'border-emerald-500/25 bg-emerald-500/5 text-emerald-200/90'
              : 'border-amber-500/25 bg-amber-500/5 text-amber-200/90'
          }`}
        >
          {lastFlow.kind === 'matched' ? (
            yours !== flow ? (
              // Looking at a flow they did NOT perform. Say so before they read a
              // single number, or the page is claiming someone else's sign-in was
              // theirs — which is exactly the confusion this banner exists to kill.
              <>
                <span className="font-medium">
                  This one is not yours. Yours is “{FLOW_META[yours!].label}”.
                </span>{' '}
                Everything below is a recorded reference flow. The badged tab switches back.
              </>
            ) : (
              <>
                <span className="font-medium">
                  This one is yours. It took {formatElapsed(lastFlow.elapsedMs)}.
                </span>{' '}
                Identified because {lastFlow.because}. The breakdown below is a recorded capture of
                the same flow, not a trace of your session.
              </>
            )
          ) : (
            <>
              {/* Short on purpose. This used to be a paragraph explaining what the
                  app cannot observe, which read as the site being confused about
                  something basic rather than being careful. State the measurement,
                  name the limit in one clause, stop. */}
              <span className="font-medium">
                Your sign-in took {formatElapsed(lastFlow.elapsedMs)}.
              </span>{' '}
              A prompt was involved, so it wasn't SSO.
            </>
          )}
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-slate-800 px-5 py-3">
        <div className="flex flex-wrap items-baseline gap-x-3">
          {/* The switch IS the demo — the diff between flows is the best content
              on the page, so the others stay reachable. But when we know which
              one the visitor actually performed, nothing else may look like it
              is theirs: yours is badged, the rest are visibly demoted to what
              they are, which is reference recordings. */}
          {/* flex-wrap is the whole of the phone fix, and it was measured, not
              chosen. The strip measured 368px of tabs when it carried six, and
              it was the only thing on the page overflowing a 375px viewport:
              422 against 375, so 47px of the page ran off the right edge on the
              width a recruiter opens it at. Letting it scroll instead was tried
              and does not work — the strip becomes internally scrollable and
              stays 368px wide, so the page still overflows by the same 47px.
              Wrapping is also free on desktop: at 1905 the tabs fit on one
              line, and every box on the page measures identical to the byte. */}
          <span className="flex flex-wrap overflow-hidden rounded border border-slate-700">
            {/* Five, not every FlowId. The silent probe is a real capture and
                its numbers are on the SSO flow; it is not a thing a visitor can
                perform, so it is not offered as though it were. See TAB_FLOWS. */}
            {TAB_FLOWS.map((f) => {
              const isYours = yours === f
              const selected = flow === f
              return (
                <button
                  key={f}
                  onClick={() => {
                    setFlow(f)
                    navigate([])
                  }}
                  title={isYours ? 'The flow you just performed' : 'A recorded reference flow'}
                  className={`flex items-center gap-1.5 px-2.5 py-1 font-mono text-sm transition-colors ${
                    selected
                      ? isYours
                        ? 'bg-emerald-500/25 text-emerald-100'
                        : 'bg-slate-700/60 text-slate-200'
                      : yours
                        ? 'text-slate-600 hover:bg-slate-800 hover:text-slate-400'
                        : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'
                  }`}
                >
                  {FLOW_META[f].label}
                  {isYours && (
                    <span className="rounded-full bg-emerald-400/20 px-1.5 text-xs text-emerald-300">
                      yours
                    </span>
                  )}
                </button>
              )
            })}
          </span>
          <p className="text-sm text-slate-500">{journey.summary}</p>
        </div>
        <div className="flex items-baseline gap-4">
          <p className="font-mono text-slate-500">
            <span className="text-3xl tabular-nums text-slate-100">
              {journey.duration.toLocaleString()}
            </span>{' '}
            <span className="text-sm">ms machine</span>
            {/* The number nobody expects: the machine is not the slow part.
                But only say "you typing" when a person actually did — on the SSO
                flows nobody types at all, and claiming otherwise would be a small
                lie on a page whose whole argument is that it doesn't tell them.
                Same reason it counts attributed gaps rather than wall minus
                machine: see attributedHumanMs. */}
            <span className="ml-2 text-xs tabular-nums text-slate-600">
              of {(journey.wallClock / 1000).toFixed(1)}s wall
              {attributedHumanMs > 2000 &&
                ` · ${(attributedHumanMs / 1000).toFixed(1)}s of it a person, in this recording`}
            </span>
          </p>
          <span
            className={`rounded-full px-2.5 py-1 font-mono text-xs uppercase tracking-wider ring-1 ring-inset ${
              journey.outcome.ok
                ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30'
                : 'bg-red-500/10 text-red-300 ring-red-500/30'
            }`}
          >
            {journey.outcome.label}
          </span>
        </div>
      </div>

      {/* ── OVERVIEW. Always the whole thing. Never zooms. ─────────────── */}
      <div className="border-b border-slate-800 px-5 py-3">
        <div className="mb-1 flex items-baseline justify-between">
          {/* Was hardcoded "The whole sign-in". That was already loose on the
              sign-up capture and became flatly untrue on the sign-out one, which
              is not a sign-in at all. The flow names itself. */}
          <span className="font-mono text-xs uppercase tracking-wider text-slate-600">
            The whole {journey.label.toLowerCase()}
          </span>
          {/* The key to the only encoding on the page. A first-time reader did
              not see it at all — not "found it small", did not find it. It was
              an 8px square next to 12px type in slate-600, which is the same
              ink the page uses for chrome it does not expect anyone to read, so
              the whole line scanned as decoration and got skipped.

              Four levers, all pointed the same way, none of them moving it: the
              swatch is 50% wider, the type is up a step, the ink is up four
              steps to the same slate-300 the request names use, and the entries
              are spaced further apart so three pairs read as three things
              rather than one strip. Contrast is doing most of the work — at
              slate-600 it was roughly 3:1 against this panel, which is fine for
              a decorative rule and not fine for the one thing that explains
              what the colours mean. */}
          <span className="flex flex-wrap items-center gap-x-4">
            {(Object.keys(ACTOR_LABELS) as Actor[]).map((actor) => (
              <span key={actor} className="flex items-center gap-1.5">
                <span className={`h-3 w-3 rounded-sm ${ACTOR_BAR[actor]}`} />
                <span className="font-mono text-sm uppercase tracking-wider text-slate-300">
                  {ACTOR_LABELS[actor]}
                </span>
              </span>
            ))}
          </span>
        </div>

        {/* Taller than it needs to be, on purpose: a bar with no writing on it is
            a stripe, and a stripe is not readable at a glance. At h-11 the wide
            segments can carry their own name. */}
        <div className="relative h-11 overflow-hidden rounded border border-slate-700 bg-slate-950">
          {journey.events.map((event) => {
            const { left, width } = place(event.span, { start: 0, end: journey.duration })
            const isSel = selected?.id === event.id || zoomContainer?.id === event.id
            const isHot = hoveredId === event.id
            return (
              <button
                key={event.id}
                onClick={() => navigate([event])}
                onMouseEnter={() => setHoveredId(event.id)}
                onMouseLeave={() => setHoveredId(null)}
                onFocus={() => setHoveredId(event.id)}
                onBlur={() => setHoveredId(null)}
                title={`${event.label} · ${spanMs(event.span)} ms`}
                aria-label={event.label}
                // A 4ms event is 0.3% of the track — three pixels. Honest, and
                // unusable. The floor buys visibility and a hit target; the row
                // below carries the exact number, so nothing is being overstated.
                style={{ left, width, minWidth: '4px' }}
                // Full colour by default. The bars were at opacity-60, which
                // muted the fill AND sank the dark label into it. The bar exists
                // to carry its name, so the name gets the contrast.
                className={`absolute inset-y-0 overflow-hidden border-r border-slate-950 ${
                  event.absent ? 'hatch' : ACTOR_BAR[event.actor]
                } ${
                  isSel
                    ? 'z-10 ring-2 ring-inset ring-white'
                    : isHot
                      ? 'z-10 ring-2 ring-inset ring-white/60'
                      : 'opacity-90'
                }`}
              >
                {/* The name, on the bar. Short form: "/authorize" fits where
                    "GET /oauth2/v2.0/authorize" never could, and the row below
                    always carries the long one. Only shown where it genuinely
                    fits — a clipped label is worse than none, which the first
                    build proved. Below the threshold you get a mark that invites
                    a click instead. */}
                <span className="pointer-events-none flex h-full items-center justify-center px-1.5">
                  {/* Sans is narrower per character than the mono it replaced,
                      so names now print on bars that used to fall under the 5%
                      gate below and show nothing. That is the point of the
                      change, not a side effect of it.

                      The ink is settled separately: near-black on the saturated
                      fill is what was approved. */}
                  <span
                    className="truncate text-sm font-semibold text-slate-950"
                    style={SLICE_LABEL_FONT}
                  >
                    {width.endsWith('%') && parseFloat(width) > 5
                      ? (event.short ?? event.label)
                      : ''}
                  </span>
                </span>
              </button>
            )
          })}

          {/* No brush overlay here any more. It was bg-white/90 at z-20, painted
              across the very bar you'd selected — which whited out the segment
              and drowned its label. The selected bar already carries a ring, so
              the brush was duplicating the marker AND destroying the thing the
              bar exists to show. The name is the point; nothing gets to cover it. */}
        </div>

        <div className="mt-1 flex justify-between font-mono text-xs tabular-nums text-slate-600">
          <span>0</span>
          <span>{journey.duration.toLocaleString()} ms</span>
        </div>
      </div>

      {/* ── DETAIL. The current level, on its own axis. ────────────────── */}
      <div className="px-5 py-3">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="flex flex-wrap items-center gap-x-2">
            <button
              onClick={() => navigate([])}
              className={`font-mono text-sm transition-colors ${
                !zoomContainer ? 'text-emerald-300' : 'text-slate-500 hover:text-slate-200'
              }`}
            >
              {/* Was hardcoded "14 events" — a typed number, and wrong: the
                  sign-in capture has 8 requests, not 14. Every count on this
                  page comes from the capture or it doesn't get shown. */}
              {journey.events.length} requests
            </button>
            {zoomContainer && (
              <>
                <span className="text-slate-700" aria-hidden="true">
                  ›
                </span>
                <span className="font-mono text-sm text-emerald-300">
                  {zoomContainer.label}
                </span>
              </>
            )}
            {/* Bound to the path, NOT to the zoom container, which is what it
                used to hang off. Selecting a leaf deliberately does not move the
                camera — there is nothing inside it to get closer to — so a leaf
                produces no zoom container, so two levels down on a branch that
                ends the way back out was an Escape key nothing on screen
                mentions. A control the visitor cannot find does not exist.

                This one is still not enough on its own, and the second copy in
                the node panel is why. See the block above NodePanel. */}
            {path.length > 0 && <BackControl onBack={back} className="ml-1" />}
          </span>
          <span className="font-mono text-sm tabular-nums text-slate-400">
            {zoomContainer ? (
              <>
                showing {spanMs(axis)} ms ·{' '}
                {share < 1 ? share.toFixed(1) : Math.round(share)}% of the {journey.label.toLowerCase()}
              </>
            ) : (
              <>{detailNodes.length} steps · full scale</>
            )}
          </span>
        </div>

        {/* Ruler for THIS axis. The numbers are the zoom. */}
        <div className="grid grid-cols-[13rem_1fr_3rem] items-center gap-3">
          <span />
          <div className="relative h-4">
            {TICK_FRACTIONS.map((t) => (
              <span
                key={t}
                className="absolute top-0 font-mono text-xs tabular-nums text-slate-600"
                style={{ left: `${t * 100}%`, transform: 'translateX(-50%)' }}
              >
                {Math.round(axis.start + t * spanMs(axis))}
              </span>
            ))}
          </div>
          <span className="text-right font-mono text-xs uppercase tracking-wider text-slate-600">
            ms
          </span>
        </div>

        <ul className="border-t border-slate-800/60">
          {detailNodes.map((node) => {
            const { left, width } = place(node.span!, axis)
            const isSel = selected?.id === node.id
            const openable = timedChildren(node).length > 0 || Boolean(node.children?.length)
            const ev = node as {
              humanGapBefore?: number
              humanDoing?: string
              idleDoing?: string
            }
            const onlyHere =
              (FLOW_ONLY[flow] as readonly string[]).includes(node.id)
            const barClass = node.absent
              ? 'hatch'
              : ACTOR_BAR[actorOf(node, zoomContainer ? actorOf(zoomContainer) : 'entra')]

            return (
              <li key={node.id}>
                {/* A gap between two requests — off the machine axis, which
                    doesn't advance for it.

                    NO DURATION HERE, deliberately. It is a real measurement, but
                    it is one person's on one recording, and printing "20.5s
                    typing an email" next to a visitor who just autofilled reads
                    as invented data. The aggregate up top still carries the
                    magnitude honestly; the per-gap seconds only pretended to be
                    about the reader.

                    NOT EVERY GAP IS A PERSON. Sign-out has a 1.1s one that is
                    Entra's own page finishing before it redirects back. "a
                    person," over that would be a claim nothing supports, so the
                    label follows the data: humanDoing says a person, idleDoing
                    says what else was going on, and a gap that can be described
                    neither way is not labelled at all (journey.ts declines to
                    set humanGapBefore in that case). */}
                {ev.humanGapBefore != null && (
                  <div className="grid grid-cols-[13rem_1fr_3rem] items-center gap-3 px-1 py-0.5">
                    <span />
                    <span className="flex items-center gap-2">
                      <span className="h-px flex-1 bg-slate-800" />
                      <span className="font-mono text-xs uppercase tracking-wider text-slate-600">
                        {ev.humanDoing ? `a person, ${ev.humanDoing}` : ev.idleDoing}
                      </span>
                      <span className="h-px flex-1 bg-slate-800" />
                    </span>
                    <span />
                  </div>
                )}
                <button
                  onClick={() => open(node)}
                  onMouseEnter={() => setHoveredId(node.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onFocus={() => setHoveredId(node.id)}
                  onBlur={() => setHoveredId(null)}
                  // A tint was too quiet to answer "did I just click that?".
                  // A solid left edge plus a filled row is unambiguous at a glance.
                  className={`grid w-full grid-cols-[13rem_1fr_3rem] items-center gap-3 border-b border-l-2 border-slate-800/60 py-1.5 pr-1 pl-1.5 text-left transition-colors ${
                    isSel
                      ? 'border-l-emerald-400 bg-emerald-500/15'
                      : hoveredId === node.id
                        ? 'border-l-slate-500 bg-slate-800'
                        : 'border-l-transparent'
                  }`}
                >
                  <span className="flex items-baseline gap-1.5 truncate">
                    {/* One of the four that differ between the flows. Switch
                        above and this row appears or vanishes — that's the diff. */}
                    {onlyHere && (
                      <span
                        title="Only happens in this flow"
                        className="shrink-0 font-mono text-xs text-amber-400"
                      >
                        ◆
                      </span>
                    )}
                    <span
                      className={`truncate text-sm ${
                        isSel ? 'font-medium text-emerald-200' : 'text-slate-300'
                      }`}
                    >
                      {node.label}
                    </span>
                    {openable && <span className="shrink-0 text-xs text-emerald-400">→</span>}
                  </span>

                  <span className="relative block h-4">
                    <span
                      style={{ left, width, minWidth: '4px' }}
                      className={`zoom-bar absolute top-0.5 h-3 rounded-sm ${
                        barClass
                      } ${
                        isSel
                          ? 'shadow-[0_0_0_2px] shadow-emerald-400/60'
                          : hoveredId === node.id
                            ? 'shadow-[0_0_0_2px] shadow-white/70'
                            : ''
                      }`}
                    />
                  </span>

                  <span
                    className={`text-right font-mono text-xs tabular-nums ${
                      isSel ? 'text-emerald-300' : 'text-slate-600'
                    }`}
                  >
                    {spanMs(node.span!)}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      {/* ── Composition, not time ──────────────────────────────────────── */}
      {selected && (
        <div key={selected.id} className="zoom-in border-t border-slate-800 px-5 py-4">
          <NodePanel
            node={selected}
            hideChildren={timedChildren(selected).length > 0}
            onDescend={(child) => navigate([...path, child])}
            onBack={back}
          />
        </div>
      )}
    </div>
  )
}

/**
 * Up one level. ONE component, rendered in two places, and that is the whole
 * point of it being a component: the button and the Escape key were written
 * separately once and did different things, and this is the same failure mode
 * one level up. Both copies call the same back(), and both are this markup, so
 * neither the behaviour nor the label can drift from the other.
 */
function BackControl({ onBack, className = '' }: { onBack: () => void; className?: string }) {
  return (
    <button
      onClick={onBack}
      className={`rounded border border-slate-700 px-1.5 py-0.5 font-mono text-sm text-slate-300 hover:border-emerald-500/50 hover:text-emerald-300 ${className}`}
    >
      ↑ back <span className="text-slate-600">esc</span>
    </button>
  )
}

function CopyButton({ value }: { value: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(value)
        setDone(true)
        setTimeout(() => setDone(false), 1200)
      }}
      className="font-mono text-xs uppercase tracking-wider text-slate-500 hover:text-emerald-300"
    >
      {done ? 'copied' : 'copy'}
    </button>
  )
}

/**
 * ── The way out has to be where the reader is ────────────────────────────────
 *
 * The breadcrumb copy of the back control renders correctly and is still not
 * findable: it sits at the top of the timeline, and this panel is the bottom of
 * it. Measured at 1280x800, on the node Steve was looking at, the breadcrumb
 * control sat 215px ABOVE the panel heading and 138px off the top of the
 * viewport — so at the moment a reader wants out, the only way out is off
 * screen. Descent has no such problem: every child card below carries a → and
 * offers itself right here.
 *
 * That asymmetry is the defect, not a missing control, which is why the fix is
 * a second copy rather than a moved one. Both are BackControl and both call the
 * same back(). Above the heading rather than beside it: on a 1265px-wide panel
 * the right-hand edge is a thousand pixels from the words being read.
 */
function NodePanel({
  node,
  hideChildren,
  onDescend,
  onBack,
}: {
  node: ZoomNode
  hideChildren?: boolean
  onDescend: (child: ZoomNode) => void
  onBack: () => void
}) {
  const showChildren = Boolean(node.children?.length) && !hideChildren

  return (
    <div>
      {/* Unconditional: this panel only renders when something is selected, and
          something is selected only when the path is non-empty, so there is
          always a level to go back to. */}
      <BackControl onBack={onBack} />
      <h4 className="mt-2 text-lg font-medium text-slate-100">{node.label}</h4>
      {node.summary && <p className="mt-1 text-sm text-slate-500">{node.summary}</p>}

      {node.literal && (
        <div className="mt-3 rounded border border-slate-800 bg-slate-950">
          <div className="flex items-center justify-between border-b border-slate-800 px-3 py-1">
            <span className="font-mono text-xs uppercase tracking-wider text-slate-600">
              Value
            </span>
            <CopyButton value={node.literal} />
          </div>
          <pre className="overflow-x-auto px-3 py-2 font-mono text-sm text-emerald-300">
            {node.literal}
          </pre>
        </div>
      )}

      {node.detail && (
        <dl className="mt-3 space-y-2 text-sm">
          <Row term="What" text={node.detail.what} />
          {node.detail.why && <Row term="Why" text={node.detail.why} />}
          {/* TIP, not GOTCHA — Steve's, and the initials are the site's. The
              content is mostly traps, so "tip" undersells it slightly; the pun
              is worth more than the half-shade of accuracy. */}
          {node.detail.gotcha && <Row term="Tip" text={node.detail.gotcha} accent />}
        </dl>
      )}

      {/* An artifact that annotates its own gaps is more credible than a
          complete one. An empty node says why it's empty. */}
      {node.absent && (
        <div className="mt-3 rounded border border-dashed border-slate-700 bg-slate-950/50 px-3 py-2">
          {/* Was "Nothing here. That's the finding". It fires on all four absent
              nodes, and awarding the content its own significance is the page
              talking about itself. The sign-out node is the one that earned it,
              and its paragraph makes the case without the header claiming it. */}
          <p className="font-mono text-xs uppercase tracking-wider text-slate-500">
            Nothing here
          </p>
          <p className="mt-1 text-sm leading-relaxed text-slate-400">{node.absent}</p>
        </div>
      )}

      {node.code && <CodeSection node={node} />}

      {showChildren && (
        <ul className="mt-4 grid gap-1 sm:grid-cols-2">
          {node.children!.map((child) => (
            <li key={child.id}>
              <button
                onClick={() => onDescend(child)}
                className="flex w-full items-baseline gap-3 rounded border border-slate-800 bg-slate-900 px-3 py-2 text-left transition-colors hover:border-emerald-500/40 hover:bg-slate-800/50"
              >
                <span className="font-mono text-sm text-slate-200">{child.label}</span>
                {child.summary && <span className="text-sm text-slate-500">{child.summary}</span>}
                {child.absent ? (
                  <span className="ml-auto font-mono text-xs uppercase tracking-wider text-amber-300/70">
                    absent
                  </span>
                ) : (
                  <span className="ml-auto text-xs text-emerald-400">→</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* It stops when it stops. */}
      {!node.children?.length && !node.absent && (
        <p className="mt-4 font-mono text-xs uppercase tracking-wider text-slate-700">
          ── end of this branch
        </p>
      )}
    </div>
  )
}

/**
 * The real source that does this step. Collapsed by default so it costs no
 * space until asked for. The content is the actual file, embedded at build time
 * — not a hand-copied snippet, which would rot silently the first time the
 * config changed.
 */
function CodeSection({ node }: { node: ZoomNode }) {
  const code = node.code!
  return (
    // This is the strongest thing on the page — the actual file that ran, one
    // click from the request it produced. It was styled like a footnote.
    <details className="mt-5 rounded-lg border border-emerald-500/25 bg-slate-950/70">
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2.5 text-sm text-emerald-300 hover:bg-emerald-500/5">
        <span className="font-medium">How this is actually done</span>
        <span className="font-mono text-sm text-slate-500">{code.file}</span>
        <span className="ml-auto font-mono text-sm text-slate-600">source ↓</span>
      </summary>
      <div className="border-t border-emerald-500/20 px-3 py-3">
        <p className="mb-3 text-sm leading-relaxed text-slate-300">{code.note}</p>
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-sm text-slate-600">
            the file that runs, embedded at build time, so it can't drift
          </span>
          <CopyButton value={code.source} />
        </div>
        <pre className="max-h-[32rem] overflow-auto rounded border border-slate-800 bg-slate-950 p-4 font-mono text-sm leading-relaxed">
          <Highlighted source={code.source} file={code.file} />
        </pre>
        <a
          href={codeUrl(code)}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-block font-mono text-sm text-slate-400 hover:text-emerald-300"
        >
          View on GitHub ↗
        </a>
      </div>
    </details>
  )
}

/** Tokens → spans. React escapes, so no dangerouslySetInnerHTML on a security site. */
function Highlighted({ source, file }: { source: string; file: string }) {
  const tokens = useMemo(() => highlight(source, file), [source, file])
  return (
    <>
      {tokens.map((t, i) => (
        <span key={i} className={TOKEN_CLASS[t.kind]}>
          {t.text}
        </span>
      ))}
    </>
  )
}

function Row({ term, text, accent }: { term: string; text: string; accent?: boolean }) {
  return (
    <div className="flex gap-3">
      <dt
        className={`w-12 shrink-0 font-mono text-sm uppercase tracking-wider ${
          accent ? 'text-amber-400/80' : 'text-slate-500'
        }`}
      >
        {term}
      </dt>
      <dd className={`leading-relaxed ${accent ? 'text-amber-200/80' : 'text-slate-300'}`}>
        {text}
      </dd>
    </div>
  )
}
