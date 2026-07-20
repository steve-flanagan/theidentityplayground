import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { JourneyTimeline, formatElapsed } from './JourneyTimeline'
import { buildSampleToken } from '../lib/sampleToken'
import signinCapture from '../lib/captures/signin.json'
import signoutCapture from '../lib/captures/signout.json'
import signupCapture from '../lib/captures/signup.json'
import ssoOnCapture from '../lib/captures/sso-on.json'
import ssoOffCapture from '../lib/captures/sso-off.json'
import ssoProbeCapture from '../lib/captures/sso-probe.json'
import {
  ACTOR_LABELS,
  buildJourney,
  FLOW_META,
  FLOW_ONLY,
  TAB_FLOWS,
  type Actor,
  type FlowId,
  type ZoomNode,
} from '../lib/journey'
import { clearLastFlow, markFlowStart, STALE_AFTER_MS, type FlowMatch } from '../lib/lastFlow'

/**
 * Every flow that can be BUILT, which is not the same as every flow that gets a
 * tab. sso-probe has no tab any more and its data reaches the page folded into
 * the SSO flow, but the capture is still real and every guard below still has
 * to hold for it. Anything that reaches a flow by clicking its tab uses
 * TAB_FLOWS instead.
 */
const FLOWS: FlowId[] = ['signup', 'signin', 'sso-on', 'sso-off', 'sso-probe', 'signout']

// These exist because of a real outage, not for coverage.
//
// The journey timeline shipped with a deep-link feature that wrote the URL
// fragment from an effect on mount. Entra returns the authorization code in that
// fragment, so mounting the component threw the code away before MSAL could read
// it, and every sign-in on the live site silently failed. Nothing caught it:
// tsc passed, the linter passed, the build passed, and every check that was run
// exercised the timeline in isolation — never the redirect path it had broken.
//
// So the first test here mounts the component with Entra's fragment present and
// asserts it is still there afterwards. That is the whole point. If it ever goes
// red, sign-in is broken in production.

const token = buildSampleToken()

function setFragment(fragment: string) {
  history.replaceState(null, '', fragment ? `/${fragment}` : '/')
}

function mount() {
  return render(<JourneyTimeline token={token} tokenLabel="Sample ID token" />)
}

/** Mount and switch to a flow the way a visitor does — by clicking its tab. */
function mountFlow(label: string) {
  const result = mount()
  fireEvent.click(screen.getByRole('button', { name: label }))
  return result
}

const journeyFor = (flow: FlowId) => buildJourney(flow, token, 'Sample ID token')

// The fragment AND the flow marker. Both live outside React, so a test that
// seeds either one would otherwise decide what the next test opens on.
beforeEach(() => {
  setFragment('')
  clearLastFlow()
})
afterEach(cleanup)

describe('the URL fragment belongs to MSAL, not to us', () => {
  it('leaves an Entra authorization-code response completely untouched', () => {
    const authResponse = '#code=FAKE_CODE_abc123&client_info=xyz&state=st1&session_state=ss1'
    setFragment(authResponse)

    mount()

    // The regression, in one line. This was empty before the fix.
    expect(location.hash).toBe(authResponse)
  })

  it('leaves an Entra error response untouched', () => {
    const errorResponse = '#error=access_denied&error_description=user_cancelled'
    setFragment(errorResponse)

    mount()

    expect(location.hash).toBe(errorResponse)
  })

  it('does not treat an auth response as a step path', () => {
    setFragment('#code=FAKE_CODE_abc123&state=st1')

    mount()

    // Falls back to the top of the journey rather than resolving nonsense.
    expect(screen.getByText(/steps · full scale/)).toBeDefined()
  })

  it('writes nothing to a clean URL on mount', () => {
    mount()

    // The mount-time write is what destroyed the code. There must not be one.
    expect(location.hash).toBe('')
  })
})

describe('our own deep links', () => {
  it('restores a step path from a namespaced fragment', () => {
    // /authorize is the one request that pays DNS + TCP + TLS, so its phases are
    // the most interesting thing to be able to link someone straight to.
    setFragment('#step=authorize/authorize:ssl')

    mount()

    expect(screen.getByText('TLS handshake', { selector: 'h4' })).toBeDefined()
  })

  it('ignores a namespaced fragment naming steps that do not exist', () => {
    setFragment('#step=not-a-real-event/nor-this')

    mount()

    expect(screen.getByText(/steps · full scale/)).toBeDefined()
  })
})

// ── Getting back out ────────────────────────────────────────────────────────
// Escape has always backed out one level. Nothing on screen said so, and the
// control that did exist hung off the ZOOM CONTAINER rather than off the path.
// Selecting a leaf deliberately does not move the camera — there is nothing
// inside it to get closer to — so a leaf produces no zoom container, so on the
// nodes that end a branch there was no way back that a visitor could find.
// Steve, looking at one of them: "why are there still no back button in the
// bottom values? The one's that hit end of branch."

describe('getting back out', () => {
  /**
   * Every copy of the control, whatever it ends up being called. There are two
   * once anything is selected: one in the breadcrumb row at the top of the
   * timeline and one at the top of the node panel at the bottom of it. In
   * document order the breadcrumb one comes first.
   */
  const backControls = () => screen.queryAllByRole('button', { name: /back/i })
  const backControl = () => backControls()[0]

  /**
   * The node detail panel: the block the selected node's heading sits in, which
   * is also the block that carries the child cards. Scoped off the heading
   * rather than off a class name, because the heading is the thing the reader
   * is actually looking at and the thing the panel is about.
   */
  const nodePanel = (heading: string) =>
    screen.getByText(heading, { selector: 'h4' }).parentElement!

  /**
   * Two levels down a branch that ends. POST /login is a single-phase request,
   * so it keeps the CA and MFA steps as its direct children, and neither of
   * those carries a span. Nothing in this path is a zoom container, which is
   * precisely the state the old control could not render in.
   */
  const LEAF = '#step=login/inside:ca'

  it('offers no way back from the top level, where there is nowhere to go', () => {
    mount()

    expect(backControls()).toHaveLength(0)
  })

  it('renders on a leaf, which is where it used to be missing', () => {
    setFragment(LEAF)

    mount()

    // The precondition, asserted rather than assumed. "full scale" is what the
    // header reads when nothing has zoomed, so this is the proof that there is
    // no zoom container here. If it ever reads "showing N ms" instead, this
    // test has quietly stopped covering the case it was written for.
    expect(screen.getByText(/steps · full scale/)).toBeDefined()
    expect(screen.getByText('Conditional Access evaluated', { selector: 'h4' })).toBeDefined()

    // Two: the breadcrumb one at the top of the timeline and the panel one at
    // the bottom. The test below is the one that cares which.
    expect(backControls()).toHaveLength(2)
  })

  it('does exactly what Escape does, so the two cannot drift apart', () => {
    // They were written separately and did different things. Escape dropped the
    // last node; the button jumped clear of the whole zoom container. From two
    // levels deep inside one request they landed in different places, and the
    // one the visitor could see was the one that overshot.
    const from = (act: () => void) => {
      setFragment(LEAF)
      const { container } = mount()
      act()
      const landed = { html: container.innerHTML, hash: location.hash }
      cleanup()
      return landed
    }

    const viaControl = from(() => fireEvent.click(backControl()))
    const viaEscape = from(() => fireEvent.keyDown(window, { key: 'Escape' }))

    expect(viaControl).toEqual(viaEscape)
    // And they both actually moved, or the line above compares two no-ops.
    expect(viaControl.hash).toBe('#step=login')
  })

  it('climbs one level per press, and stops offering once it is out', () => {
    setFragment(LEAF)
    mount()

    fireEvent.click(backControl())
    expect(location.hash).toBe('#step=login')
    // Still one level in, so still offered, and still in both places.
    expect(backControls()).toHaveLength(2)

    fireEvent.click(backControl())
    expect(location.hash).toBe('')
    expect(backControls()).toHaveLength(0)
  })

  it('steps out of a zoomed branch one level at a time, not clear of it', () => {
    // The other half of the same divergence, on the node Steve was actually
    // looking at. Here a zoom container DOES exist (/authorize earns a phase
    // level), and the old control jumped straight past it to the top. One
    // click now lands on the phase that leaf hangs off.
    setFragment('#step=authorize/authorize:wait/inside:tenant')
    mount()

    expect(screen.getByText('Tenant + app registration resolved', { selector: 'h4' })).toBeDefined()

    fireEvent.click(backControl())

    expect(location.hash).toBe('#step=authorize/authorize:wait')
    expect(screen.getByText('Waiting: Entra thinking', { selector: 'h4' })).toBeDefined()
  })

  // ── Reachable, which is not the same as rendered ──────────────────────────
  //
  // The previous fix made the control RENDER whenever the path is non-empty,
  // and the test above asserts exactly that. It passed, and Steve reported the
  // same complaint again on the same node: "Still no back buttons on these
  // (tenant + app reg, etc)".
  //
  // Rendered is not the defect. PLACEMENT is. The breadcrumb copy lives at the
  // top of the timeline and the reader is at the bottom of it, in the node
  // panel, clicking child cards that each carry a → to go deeper. Descent is
  // offered where the content is; ascent was a scroll away.
  //
  // Measured in the browser at 1280x800, descending into inside:tenant from
  // the panel Steve named: the breadcrumb control sat 215px above the panel
  // heading and 138px off the top of the viewport. jsdom has no layout, so
  // these two assert the structural fact underneath that number — the way out
  // is inside the panel, and it is above the content rather than under it.

  it('puts a way out inside the node panel, where the reader is', () => {
    // Descend the way the complaint did: by clicking a child card in the panel,
    // not by deep link. That is the path that leaves the breadcrumb off screen.
    setFragment('#step=authorize/authorize:wait')
    mount()

    fireEvent.click(
      within(nodePanel('Waiting: Entra thinking')).getByRole('button', {
        name: /Tenant \+ app registration resolved/,
      }),
    )

    const panel = nodePanel('Tenant + app registration resolved')
    // The assertion that bites. Before the placement fix this was 0: the panel
    // held the heading, the prose and the child cards, and no way back out.
    expect(within(panel).getAllByRole('button', { name: /back/i })).toHaveLength(1)
  })

  it('puts it above the panel heading, not below the content', () => {
    setFragment('#step=authorize/authorize:wait/inside:tenant')
    mount()

    const heading = screen.getByText('Tenant + app registration resolved', { selector: 'h4' })
    const inPanel = within(heading.parentElement!).getByRole('button', { name: /back/i })

    // Reading downward, the way out comes before the thing it backs out of.
    // DOCUMENT_POSITION_FOLLOWING === 4: the heading follows the control.
    expect(inPanel.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(4)
  })

  it('the panel copy does exactly what the breadcrumb copy does', () => {
    // Same guarantee as the Escape test above, one level up. Two controls that
    // do nearly the same thing is how the button and Escape diverged the first
    // time; both of these are one component calling one back().
    const from = (pick: (all: HTMLElement[]) => HTMLElement) => {
      setFragment('#step=authorize/authorize:wait/inside:tenant')
      const { container } = mount()
      const all = backControls()
      // Or the two picks below resolve to the same element and this compares a
      // thing with itself, which is what it looked like against the old code.
      expect(all).toHaveLength(2)
      fireEvent.click(pick(all))
      const landed = { html: container.innerHTML, hash: location.hash }
      cleanup()
      return landed
    }

    const viaBreadcrumb = from((all) => all[0])
    const viaPanel = from((all) => all[all.length - 1])

    expect(viaPanel).toEqual(viaBreadcrumb)
    expect(viaPanel.hash).toBe('#step=authorize/authorize:wait')
  })
})

// The numbers on the page must come from the capture and nowhere else. If these
// ever disagree, someone has retyped a measurement by hand — which is precisely
// how a "real" figure quietly becomes a wrong one.
describe('the timeline reports what was actually measured', () => {
  it('shows the sign-in machine time from the derived capture', () => {
    mount()
    expect(screen.getByText(signinCapture.machineMs.toLocaleString())).toBeDefined()
  })

  it('plots one bar per captured request, and no more', () => {
    mount()
    expect(screen.getByText(`${signinCapture.requestCount} steps · full scale`)).toBeDefined()
  })

  it('counts requests in the breadcrumb from the capture, not from memory', () => {
    // This shipped reading "14 events" — a number typed by hand, and wrong: the
    // sign-in capture holds 8 requests. The commit that introduced it claimed
    // "no number is retyped". One was. Hence this.
    mount()
    expect(screen.getByText(`${signinCapture.requestCount} requests`)).toBeDefined()
    expect(screen.queryByText('14 events')).toBeNull()
  })

  it('gives every node a unique id, at every depth', () => {
    // .well-known is fetched twice — once at startup, once after the SPA
    // reloads. Annotations are keyed by path, so both events came out as
    // 'discovery': duplicate React keys, whose documented behaviour is to
    // duplicate and/or omit children. It rendered phantom rows in every detail
    // view, and React logged the error on every paint while the DOM assertions
    // all passed. Ids are the invariant; this is the guard.
    for (const flow of FLOWS) {
      const journey = buildJourney(flow, token, 'Sample ID token')
      const ids: string[] = []
      const walk = (nodes: ZoomNode[]) => {
        for (const n of nodes) {
          ids.push(n.id)
          if (n.children) walk(n.children)
        }
      }
      walk(journey.events)

      const dupes = ids.filter((id, i) => ids.indexOf(id) !== i)
      expect(dupes, `duplicate ids in ${flow}: ${[...new Set(dupes)].join(', ')}`).toEqual([])
    }
  })

  it('never offers a zoom level that just repeats its parent', () => {
    // A request that is 100% `wait` used to open into one row reading "waiting:
    // 146 ms" under a request labelled 146 ms. Same number, one click deeper,
    // nothing learned — "a lot of useless info and just entra waiting". Six of
    // the eight requests were like that. A level has to earn its existence.
    for (const flow of FLOWS) {
      for (const event of buildJourney(flow, token, 'Sample ID token').events) {
        const timed = (event.children ?? []).filter((c) => c.span)
        expect(
          timed.length,
          `${flow}/${event.id} opens into a single timed child that restates it`,
        ).not.toBe(1)
      }
    }
  })

  it('does not claim Entra served our own origin', () => {
    // The SPA reload is Azure Static Web Apps handing back HTML. Labelling that
    // "Entra thinking" is a small lie in the one place the site claims authority.
    mount()
    expect(screen.queryAllByText(/Entra thinking/)).toBeDefined()
    const spa = buildJourney('signin', token, 'Sample ID token').events.find(
      (e) => e.id === 'spa',
    )
    const waits = (spa?.children ?? []).filter((c) => c.label.startsWith('Waiting'))
    for (const w of waits) expect(w.label).not.toContain('Entra')
  })

  it('builds every flow, and reports failure as failure', () => {
    // The silent probe is the one flow that does NOT end in a token. Hardcoding
    // "Token issued" would turn a correct, informative failure into a lie.
    const outcomes = FLOWS.map((f) => [f, buildJourney(f, token, 'Sample ID token').outcome])
    expect(Object.fromEntries(outcomes)).toMatchObject({
      'sso-on': { ok: true },
      'sso-off': { ok: true },
      'sso-probe': { ok: false, label: 'login_required' },
      // Succeeds, and still issues nothing. Those are not the same thing, and
      // the default that assumed they were is gone — see FLOW_META.
      signout: { ok: true, label: 'Session ended' },
    })
  })

  it('marks only requests that genuinely exist in that flow', () => {
    // A typo in FLOW_ONLY would silently stop the ◆ diff marker from ever
    // rendering, and nothing else would fail. This is the guard.
    for (const flow of FLOWS) {
      const ids = new Set(buildJourney(flow, token, 'Sample ID token').events.map((e) => e.id))
      for (const marked of FLOW_ONLY[flow]) {
        expect(ids.has(marked), `${flow} marks "${marked}" but has no such request`).toBe(true)
      }
    }
  })

  it('states the sign-up/sign-in diff as the number the captures actually hold', () => {
    // Three things say what the difference between the two flows is: the
    // captures, the ◆ markers, and a sentence with a number spelled out in it.
    // Nothing tied them to each other, so the sentence would go on saying
    // "four" through any re-capture that made it five, and a wrong number in
    // the one place this page claims authority is the whole failure mode.
    const idsIn = (flow: FlowId) => new Set(journeyFor(flow).events.map((e) => e.id))
    const signup = idsIn('signup')
    const signin = idsIn('signin')

    // "Differ" here means present in one flow and absent in the other. A shared
    // request with a different duration is not a difference between the flows,
    // and every shared request has one, so counting those would make the number
    // meaningless.
    const signupOnly = [...signup].filter((id) => !signin.has(id))
    const signinOnly = [...signin].filter((id) => !signup.has(id))

    // The markers are that set exactly, not merely a subset of it. The guard
    // above this one passes happily while an entire request goes unmarked.
    expect([...FLOW_ONLY.signup].sort()).toEqual([...signupOnly].sort())
    expect([...FLOW_ONLY.signin].sort()).toEqual([...signinOnly].sort())

    const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']
    const diff = signupOnly.length + signinOnly.length

    // The total, on the request that is one of them.
    const kmsi = journeyFor('signin').events.find((e) => e.id === 'kmsi')
    expect(kmsi?.detail?.gotcha).toContain(`the ${WORDS[diff]} requests that differ`)

    // The sign-up tab carries its own side of the same number.
    expect(FLOW_META.signup.summary).toMatch(
      new RegExp(`\\b${WORDS[signupOnly.length]} requests\\b`, 'i'),
    )

    // And it names /kmsi as the one sign-up does not make. Sign-up is not
    // sign-in plus three: it is sign-in plus three, minus this. If a re-capture
    // ever puts a /kmsi in a sign-up, that sentence is wrong and this fails.
    expect(signinOnly).toContain('kmsi')
  })

  it('proves the SSO pair differs by more than noise', () => {
    // The demo's claim is that defeating SSO costs real time. If this ever
    // inverts, the claim on the page is wrong and must change with it.
    const on = buildJourney('sso-on', token, 'Sample ID token')
    const off = buildJourney('sso-off', token, 'Sample ID token')
    expect(off.wallClock).toBeGreaterThan(on.wallClock * 5)
    expect(off.events.some((e) => e.id === 'federation')).toBe(true)
    expect(on.events.some((e) => e.id === 'federation')).toBe(false)
  })

  it('never puts human thinking time on the machine axis', () => {
    // The gaps are enormous — 12.5s typing an email against 1.9s of machine.
    // If they ever leaked onto the axis, machine time would balloon toward wall.
    expect(signinCapture.machineMs).toBeLessThan(signinCapture.wallMs / 5)
  })

  it('never says "a person" without being able to say what the person did', () => {
    // The gap row reads "a person, typing a password". It renders off one field
    // and the prose off another, so a gap with no prose used to render "a
    // person," and a blank — an unsupported claim produced by an accident of
    // copy. Sign-out is where it would have bitten: its 1.1s gap is Entra's own
    // page redirecting, not anybody at a keyboard.
    for (const flow of FLOWS) {
      for (const event of journeyFor(flow).events) {
        if (event.humanGapBefore == null) continue
        expect(
          Boolean(event.humanDoing || event.idleDoing),
          `${flow}/${event.id} draws a gap it cannot describe`,
        ).toBe(true)
      }
    }
  })
})

// ── Prose that quotes a measurement belongs to the capture it measured ──────
// The TLS gotcha was one shared string, keyed by phase name alone and written
// off the sign-in capture. It named the two requests that pay for a connection
// (57 ms and 166 ms) and listed /token among the ones that reuse one. True in
// four flows. In sso-off /token opens a fresh connection — 73 ms of connect,
// 81 ms of TLS — and the string rendered as the gotcha ON that handshake row:
// the page told the reader a connection cost nothing, directly beneath the
// 81 ms it had just charged for one.
//
// Nothing caught it, because every check on this file compares the page against
// the sign-in capture, which is the one flow the sentence was true in.

/** Only the fields these assertions read. Same cast journey.ts uses on the JSON. */
type CaptureShape = {
  requests: {
    path: string
    /** Who served it. The DNS assertion below turns on two requests sharing one. */
    host: string
    total: number
    /** The idle gap before it fired. Quoted in prose, so it is a measurement. */
    idleBefore: number
    timings: Record<string, number>
  }[]
}

const CAPTURE: Record<FlowId, CaptureShape> = {
  signup: signupCapture as CaptureShape,
  signin: signinCapture as CaptureShape,
  'sso-on': ssoOnCapture as CaptureShape,
  'sso-off': ssoOffCapture as CaptureShape,
  'sso-probe': ssoProbeCapture as CaptureShape,
  signout: signoutCapture as CaptureShape,
}

describe('per-capture prose stays inside the capture it was measured from', () => {
  /**
   * Every phase row in a flow. A request's timed children ARE its phases: the
   * untimed children are the composition hanging off `wait`, which carries no
   * measurement and so nothing for these assertions to check.
   */
  const phaseRows = (flow: FlowId) =>
    journeyFor(flow).events.flatMap((e) => (e.children ?? []).filter((c) => c.span))

  it('does not tell the sso-off reader that /token paid nothing for its connection', () => {
    // The precondition, read from the capture rather than assumed. This is the
    // only flow in which /token opens a connection of its own.
    const req = CAPTURE['sso-off'].requests.find((r) => r.path.endsWith('/oauth2/v2.0/token'))
    expect(req?.timings.connect).toBeGreaterThan(0)
    expect(req?.timings.ssl).toBeGreaterThan(0)

    const node = journeyFor('sso-off').events.find((e) => e.id === 'token-request')
    // And the handshake really is on screen, or the assertion below is vacuous.
    expect(node?.children?.some((c) => c.id === 'token-request:ssl')).toBe(true)

    // Everything the page says on that request: its own detail and every phase
    // row under it. The old sentence rendered on the TLS row.
    const said = JSON.stringify([node?.detail, ...(node?.children ?? []).map((c) => c.detail)])
    expect(said).not.toMatch(/pure server time/i)
    expect(said).not.toMatch(/reuses a connection and pays nothing/i)
  })

  /**
   * Every figure a capture can support: a request total, any single phase, the
   * idle gap before it fired, and the connection setup it paid, which is what
   * the TLS gotcha is about and is a sum rather than a field.
   */
  const measuredIn = (flow: FlowId) => {
    const measured = new Set<number>()
    for (const r of CAPTURE[flow].requests) {
      measured.add(r.total)
      measured.add(r.idleBefore)
      let setup = 0
      for (const [phase, ms] of Object.entries(r.timings)) {
        measured.add(ms)
        if (phase === 'dns' || phase === 'connect' || phase === 'ssl') setup += ms
      }
      measured.add(setup)
    }
    return measured
  }

  /** Every word the page says about a node, at every depth, in one string. */
  const proseIn = (flow: FlowId) => {
    const out: { id: string; text: string }[] = []
    const walk = (nodes: ZoomNode[]) => {
      for (const n of nodes) {
        out.push({
          id: n.id,
          text: [n.summary, n.detail?.what, n.detail?.why, n.detail?.gotcha, n.absent]
            .filter(Boolean)
            .join(' '),
        })
        if (n.children) walk(n.children)
      }
    }
    walk(journeyFor(flow).events)
    return out
  }

  /**
   * The only figures a flow may quote from someone else's capture, and the
   * capture each one belongs to.
   *
   * Two sentences on the site are deliberate cross-flow comparisons, which is
   * the whole demo rather than a leak: sso-off names what /authorize costs when
   * the session IS reused, and sso-on names what the same endpoint answers when
   * the request cannot reach the session at all. Listing them here is what
   * keeps the rule strict everywhere else, and the assertion below checks that
   * the named capture really did measure the number, so an exception cannot
   * shelter one nobody measured.
   */
  const CROSS_FLOW: Partial<Record<FlowId, Record<number, FlowId>>> = {
    'sso-on': { 197: 'sso-probe' },
    'sso-off': { 190: 'sso-on' },
  }

  it('quotes no millisecond figure the flow did not measure, anywhere on the page', () => {
    // The general form, and the guard that makes a repeat impossible rather
    // than merely fixed. This used to cover phase prose only, with the request
    // level explicitly left out — and the request level is where the worst one
    // was: /authorize told four flows out of five that 166 ms of it was
    // connection setup, off the sign-in capture, on the flagship row. Extending
    // the loop is what found it.
    for (const flow of FLOWS) {
      const measured = measuredIn(flow)
      const allowed = CROSS_FLOW[flow] ?? {}

      for (const node of proseIn(flow)) {
        // Thousands separators included: "Measured at 1,673 ms" is one figure,
        // and a naive \d+ reads the tail of it as 673 and calls it invented.
        for (const [, digits] of node.text.matchAll(/([\d,]+) ms\b/g)) {
          const ms = Number(digits.replace(/,/g, ''))
          if (measured.has(ms)) continue

          const from = allowed[ms]
          expect(
            from,
            `${flow}/${node.id} quotes ${ms} ms, and nothing in that capture measured it`,
          ).toBeDefined()
          expect(
            measuredIn(from!).has(ms),
            `${flow}/${node.id} borrows ${ms} ms from ${from}, which did not measure it either`,
          ).toBe(true)
        }
      }
    }
  })

  it('does not claim only the first trip to a host pays for a lookup', () => {
    // Read from the capture, not assumed. Two requests in the sign-in pay DNS
    // and they go to the SAME host, so "Only the first trip to a host pays"
    // was false, and it rendered as the gotcha ON the second one's row: the
    // page denied the 11 ms it had just charged.
    const paidDns = CAPTURE.signin.requests.filter((r) => r.timings.dns > 0)
    expect(paidDns).toHaveLength(2)
    expect(new Set(paidDns.map((r) => r.host)).size).toBe(1)

    const said = phaseRows('signin')
      .map((row) => row.detail?.gotcha ?? '')
      .join(' ')

    expect(said).not.toMatch(/only the first trip/i)
    // And the flow says what it actually measured, both times.
    for (const r of paidDns) expect(said).toContain(`${r.timings.dns} ms`)
  })

  it('keeps a sentence written off one capture out of the other five', () => {
    // 57 ms and 166 ms belong to sign-in. Sign-up measures 66 and 49 for those
    // same two requests, and in sso-off discovery is a cache hit that pays
    // nothing at all, so the sentence is not merely imprecise there. It is wrong.
    const SIGNIN_ONLY = 'the discovery call (57 ms)'

    for (const flow of FLOWS) {
      const said = phaseRows(flow)
        .map((row) => row.detail?.gotcha ?? '')
        .join(' ')

      if (flow === 'signin') {
        expect(said, 'the sign-in sentence stopped rendering').toContain(SIGNIN_ONLY)
      } else {
        expect(said, `${flow} renders prose measured from the sign-in capture`).not.toContain(
          SIGNIN_ONLY,
        )
      }
    }
  })
})

// ── The silent probe is data, not a destination ─────────────────────────────
// It sat as a sixth tab beside five flows a visitor can actually perform, which
// implied it was a sixth thing to try. It is not: the hidden-iframe leg it
// needs cannot receive the ciamlogin.com session cookie in any browser with
// third-party cookie protection on, so no state a visitor can put their browser
// in makes it succeed. The capture is real and stays; it moved onto the request
// it is the counterfactual to.

describe('the silent probe is folded into the SSO flow, not offered as one', () => {
  /** The probe's own measurement, read from the capture rather than typed. */
  const probeAuthorize = (ssoProbeCapture as CaptureShape).requests.find((r) =>
    r.path.endsWith('/oauth2/v2.0/authorize'),
  )!

  it('renders no tab for it, and still renders one for everything else', () => {
    mount()

    for (const flow of TAB_FLOWS) {
      expect(
        screen.getByRole('button', { name: FLOW_META[flow].label }),
        `${flow} lost its tab`,
      ).toBeDefined()
    }
    expect(TAB_FLOWS).not.toContain('sso-probe')
    expect(screen.queryByRole('button', { name: FLOW_META['sso-probe'].label })).toBeNull()
  })

  it('carries the probe’s measurement onto the SSO flow’s /authorize', () => {
    // The request the probe contradicts: same endpoint, same session, one
    // parameter and one browsing context different, opposite outcomes.
    const said =
      journeyFor('sso-on').events.find((e) => e.id === 'authorize')?.detail?.gotcha ?? ''

    expect(said).toContain(`${probeAuthorize.total} ms`)
    expect(said).toContain('login_required')
  })

  it('keeps the third-party-cookie finding, which is the interesting part', () => {
    // Deleting the tab must not delete the reason. This is the strongest thing
    // in notes/findings.md and the probe was the only place it appeared.
    const said =
      journeyFor('sso-on').events.find((e) => e.id === 'authorize')?.detail?.gotcha ?? ''

    expect(said).toMatch(/AADSTS50058/)
    expect(said).toMatch(/third-party/i)
  })

  it('still builds the flow, so the capture cannot rot unnoticed', () => {
    // Every guard in this file runs over sso-probe. Dropping it from FlowId
    // would have taken the capture out from under all of them.
    const probe = journeyFor('sso-probe')
    expect(probe.events).toHaveLength(ssoProbeCapture.requestCount)
    expect(probe.outcome).toEqual({ label: 'login_required', ok: false })
  })
})

// ── The badge prints a duration, and it has to survive a long one ───────────
// STALE_AFTER_MS went from five minutes to fifteen so a sign-up waiting on an
// emailed verification code gets a badge at all. Nothing moved the formatting
// with it, so a thirteen-minute sign-up rendered "It took 786.3s." — true, and
// indistinguishable from a number nobody measured. The comment that change
// replaced named "your sign-in took 825.0s" as the exact thing that must never
// appear again.

describe('how long it took, in units a reader can hold', () => {
  /** A finished round trip of exactly this length. Same seeding lastFlow uses. */
  const seed = (intent: 'default' | 'force-credentials', elapsedMs: number) => {
    markFlowStart(intent)
    // Against performance.timeOrigin, not Date.now(): the round trip is
    // measured from the click to when the returned document began loading.
    sessionStorage.setItem('tip.flow.start', String(performance.timeOrigin - elapsedMs))
  }

  it('leaves everything under two minutes exactly as it was', () => {
    // The sub-threshold rendering is not up for revision. A sign-in is seconds
    // and 20.8s is the right way to say it.
    expect(formatElapsed(1_000)).toBe('1.0s')
    expect(formatElapsed(20_800)).toBe('20.8s')
    expect(formatElapsed(119_949)).toBe('119.9s')
  })

  it('says a long wait in minutes and seconds', () => {
    expect(formatElapsed(120_000)).toBe('2m 0s')
    expect(formatElapsed(786_300)).toBe('13m 6s')
    // The longest interval that can reach the badge at all, so the longest
    // string this ever has to produce.
    expect(formatElapsed(STALE_AFTER_MS)).toBe('15m 0s')
  })

  it('carries a remainder that rounds up to a whole minute', () => {
    // 59.6s of remainder is 60s to the nearest second, and "8m 60s" is not a
    // time. 479_600 is 7m 59.6s.
    expect(formatElapsed(479_600)).toBe('8m 0s')
  })

  it('renders the short form on a flow the visitor performed', () => {
    seed('force-credentials', 20_800)

    mount()

    expect(screen.getByText(/It took 20\.8s\./)).toBeDefined()
  })

  it('renders minutes on the sign-up that waited on an email', () => {
    seed('default', 786_300)

    mount()

    expect(screen.getByText(/Your sign-in took 13m 6s\./)).toBeDefined()
    // The number that started this. It must not be anywhere on the page.
    expect(screen.queryByText(/786/)).toBeNull()
  })
})

// ── Sign-out ────────────────────────────────────────────────────────────────
// The flow that ends a session instead of starting one, and the one that had to
// break the assumption every other flow was built on: that a journey ends in a
// token. It does not. Nothing here may say it does.

describe('sign-out issues no token, and must not claim one', () => {
  it('ends with the session, not with a token', () => {
    expect(journeyFor('signout').outcome).toEqual({ label: 'Session ended', ok: true })
  })

  it('has no /token request that could have issued one', () => {
    // The outcome above is prose. This is the check underneath it: the capture
    // genuinely contains no token request, so there is nothing to have issued.
    const ids = journeyFor('signout').events.map((e) => e.id)
    expect(ids).not.toContain('token-request')
    expect(journeyFor('signin').events.map((e) => e.id)).toContain('token-request')
  })

  it('renders "Session ended" and never "Token issued"', () => {
    mountFlow('Sign-out')
    expect(screen.getByText('Session ended')).toBeDefined()
    expect(screen.queryByText('Token issued')).toBeNull()
  })

  it('takes its numbers from the derived capture, like every other flow', () => {
    mountFlow('Sign-out')
    // getAllByText, not getByText: at 683 ms the total and the right-hand ruler
    // tick are the same number, which is not a bug — it is the axis agreeing
    // with itself.
    expect(screen.getAllByText(signoutCapture.machineMs.toLocaleString()).length).toBeGreaterThan(0)
    expect(screen.getByText(`${signoutCapture.requestCount} steps · full scale`)).toBeDefined()
    expect(screen.getByText(`${signoutCapture.requestCount} requests`)).toBeDefined()
    // And the sign-in's numbers are gone, which is what proves the switch re-read
    // the capture rather than relabelling the one already on screen.
    expect(screen.queryByText(signinCapture.machineMs.toLocaleString())).toBeNull()
  })

  it('does not call the whole thing a sign-in', () => {
    // The overview heading was hardcoded "The whole sign-in". On this flow that
    // is not a loose label, it is a wrong one.
    mountFlow('Sign-out')
    expect(screen.getByText(/The whole sign-out/i)).toBeDefined()
    expect(screen.queryByText(/The whole sign-in/i)).toBeNull()
  })

  it('does not bill Entra’s own redirect to a person', () => {
    // Wall minus machine on sign-out is 2.6s, and only 1.5s of it is anybody at
    // a keyboard — the rest is Entra's sign-out page handing the browser back.
    // The header derived the figure the loose way and printed the lot as "a
    // person", overstating the human by 43% on this flow.
    mountFlow('Sign-out')
    expect(screen.queryByText(/of it a person/)).toBeNull()
  })

  it('counts only the gaps it can actually name as a person', () => {
    // Sign-in still shows the figure — it just shows the attributed one.
    const j = journeyFor('signin')
    const attributed = j.events.reduce(
      (total, e) => total + (e.humanDoing ? (e.humanGapBefore ?? 0) : 0),
      0,
    )
    const loose = ((j.wallClock - j.duration) / 1000).toFixed(1)
    // If these ever coincide the assertion below proves nothing, so say so.
    expect(loose).not.toBe((attributed / 1000).toFixed(1))

    mount()
    expect(
      screen.getByText(new RegExp(`${(attributed / 1000).toFixed(1)}s of it a person`)),
    ).toBeDefined()
    expect(screen.queryByText(new RegExp(`${loose}s of it a person`))).toBeNull()
  })

  it('was sliced out of a longer recording, and says so in the file', () => {
    // One tab held a sign-in, two probes and a sign-out. Without the window the
    // totals would sum four unrelated actions into one fabricated flow.
    expect(signoutCapture.window).toBeDefined()
    expect(signoutCapture.window.fromMs).toBeLessThan(signoutCapture.window.toMs)
  })
})

describe('the local sign-out, which is the point of the flow', () => {
  const logoutNode = () => journeyFor('signout').events.find((e) => e.id === 'logout')

  it('plots the two requests a global sign-out makes', () => {
    const ids = journeyFor('signout').events.map((e) => e.id)
    expect(ids).toContain('logout')
    expect(ids).toContain('logoutsession')
    // And no other flow has them, which is what earns them the ◆ diff marker.
    for (const flow of FLOWS.filter((f) => f !== 'signout')) {
      const others = journeyFor(flow).events.map((e) => e.id)
      expect(others).not.toContain('logout')
      expect(others).not.toContain('logoutsession')
    }
  })

  it('annotates the local sign-out as absent rather than inventing a bar for it', () => {
    // A local sign-out makes zero requests, so there is nothing to measure and
    // no honest bar to draw. Giving it a span would be fabricating the one thing
    // this page exists to not fabricate.
    const local = logoutNode()?.children?.find((c) => c.id === 'inside:local')
    expect(local).toBeDefined()
    expect(local!.absent).toBeTruthy()
    expect(local!.span).toBeUndefined()
    expect(local!.detail).toBeUndefined()
  })

  it('does not tell a signed-out visitor they came home with a code', () => {
    // Sign-in and sign-out land on the same URL. The shared copy says the
    // browser arrives "carrying the code in the fragment", which is true of one
    // of them. Flow-specific prose exists for exactly this.
    const spa = journeyFor('signout').events.find((e) => e.id === 'spa')
    const text = JSON.stringify(spa?.detail)
    expect(text).not.toMatch(/#code/)
    expect(text).not.toMatch(/authorization code/i)

    // The sign-in copy must still carry the warning — this is the fragment bug's
    // own note, and losing it to a refactor would be worse than never writing it.
    const signinSpa = journeyFor('signin').events.find((e) => e.id === 'spa')
    expect(signinSpa?.detail?.gotcha).toMatch(/FRAGMENT/)
  })
})

// ── Signing out of this app only ────────────────────────────────────────────
// clearCache() makes no request and never navigates. Nothing unmounts, so the
// component is still here and is simply told which flow to show.
//
// It used to go through lastFlow like everything else, and that was the defect:
// lastFlow stamps a start time for a REDIRECT to come back and finish, and with
// no redirect nothing ever came back to read it. The stamp sat in storage until
// some later page load turned the idle minutes since the click into the flow's
// duration. There is no round trip here, so there is nothing to measure, so
// nothing is said about timing.

describe('a local sign-out selects the sign-out flow in the page', () => {
  const timeline = (localSignOutCount: number) => (
    <JourneyTimeline
      token={token}
      tokenLabel="Sample ID token"
      localSignOutCount={localSignOutCount}
    />
  )

  it('moves the timeline onto the sign-out flow', () => {
    const { rerender } = render(timeline(0))
    expect(screen.getByText(/The whole sign-in/i)).toBeDefined()

    rerender(timeline(1))

    expect(screen.getByText(/The whole sign-out/i)).toBeDefined()
    expect(screen.queryByText(/The whole sign-in/i)).toBeNull()
  })

  it('says nothing about how long it took, because nothing was measured', () => {
    const { rerender } = render(timeline(0))
    rerender(timeline(1))

    // The banner is the whole reason this path avoids lastFlow. An elapsed time
    // here would be idle time since the click, presented as a measurement.
    //
    // Both matchers are deliberately loose: they guard the ABSENCE of any
    // elapsed-time claim, not one phrasing of it, so a copy pass cannot quietly
    // turn either into a match against a string nothing renders any more.
    expect(screen.queryByText(/this one is yours/i)).toBeNull()
    expect(screen.queryByText(/it took/i)).toBeNull()
  })

  it('does not fire on mount, whatever the count arrives as', () => {
    // The comparison is against the prop's own first value. A remount carrying a
    // count from earlier in the session must not re-select anything.
    render(timeline(4))

    expect(screen.getByText(/The whole sign-in/i)).toBeDefined()
  })

  it('moves again on the next sign-out, after the visitor has clicked away', () => {
    const { rerender } = render(timeline(0))
    rerender(timeline(1))
    fireEvent.click(screen.getByRole('button', { name: 'Sign-up' }))
    expect(screen.getByText(/The whole sign-up/i)).toBeDefined()

    rerender(timeline(2))

    // A flag would already be raised by now and this would sit still. The count
    // is what makes the second sign-out move the timeline like the first.
    expect(screen.getByText(/The whole sign-out/i)).toBeDefined()
  })

  it('takes down the badge for the sign-in it just undid', () => {
    // The panel wipes the marker out of storage, but this component read the
    // answer into state on mount, so the banner and the "yours" tab would
    // otherwise stay on screen claiming a session that has been dropped.
    markFlowStart('default')
    // Seed against performance.timeOrigin, not Date.now(). The round trip is
    // measured from the click to when the returned document began loading, so
    // a Date.now()-relative stamp reads as negative once the test process has
    // been up longer than the interval being faked.
    sessionStorage.setItem('tip.flow.start', String(performance.timeOrigin - 1_000))

    const { rerender } = render(timeline(0))
    expect(screen.getByText(/This one is yours/)).toBeDefined()
    expect(screen.getByText('yours')).toBeDefined()

    rerender(timeline(1))

    expect(screen.queryByText(/This one is yours/)).toBeNull()
    expect(screen.queryByText('yours')).toBeNull()
  })
})

// ── The sign-up / sign-in answer, which arrives after mount ─────────────────
// Every other flow is settled before this component renders. This one costs a
// call to Entra, so it reaches a component that has already opened on
// something. Same delivery as the local sign-out above: a prop, compared during
// render.

describe('a late answer moves the timeline onto the flow it names', () => {
  const timeline = (resolvedFlow: FlowMatch) => (
    <JourneyTimeline token={token} tokenLabel="Sample ID token" resolvedFlow={resolvedFlow} />
  )

  const signedUp: FlowMatch = {
    kind: 'matched',
    flow: 'signup',
    elapsedMs: 20_000,
    because: 'the account did not exist when this flow started, so this flow created it',
  }

  it('opens on sign-in, then switches when the answer lands', () => {
    const { rerender } = render(timeline(null))
    expect(screen.getByText(/The whole sign-in/i)).toBeDefined()

    rerender(timeline(signedUp))

    expect(screen.getByText(/The whole sign-up/i)).toBeDefined()
    expect(screen.queryByText(/The whole sign-in/i)).toBeNull()
  })

  it('badges the flow it just named, so nothing else looks like theirs', () => {
    const { rerender } = render(timeline(null))
    expect(screen.queryByText('yours')).toBeNull()

    rerender(timeline(signedUp))

    expect(screen.getByText('yours')).toBeDefined()
    expect(screen.getByText(/This one is yours/)).toBeDefined()
  })

  it('warns the moment they click onto a flow they did not perform', () => {
    // The second half of the fix. That banner only renders when a flow IS
    // identified, so before this an ambiguous visitor could click through every
    // tab and never be told any of it was a recording.
    const { rerender } = render(timeline(null))
    rerender(timeline(signedUp))

    fireEvent.click(screen.getByRole('button', { name: 'SSO' }))

    expect(screen.getByText(/This one is not yours/)).toBeDefined()
    expect(screen.getByText(/recorded reference flow/)).toBeDefined()
  })

  it('does nothing at all while the answer is null', () => {
    // Null is the common case: no consent, no network, a tenant that will not
    // say. It has to be indistinguishable from the page as it is today.
    const { rerender } = render(timeline(null))
    rerender(timeline(null))

    expect(screen.getByText(/The whole sign-in/i)).toBeDefined()
    expect(screen.queryByText('yours')).toBeNull()
  })

  it('does not fire on mount, and does not need to', () => {
    // Same guard as the sign-out count: the comparison starts at the prop's own
    // first value, so arriving already-answered switches nothing. That costs
    // nothing, because settleLastFlow has written the answer into storage by
    // then and the test below is the path a remount actually takes.
    render(timeline(signedUp))
    expect(screen.getByText(/The whole sign-in/i)).toBeDefined()
  })

  it('opens straight onto a settled answer already in storage', () => {
    // A refresh, or a remount. The frozen result is what carries the answer
    // across, which is the whole reason settleLastFlow writes it back.
    sessionStorage.setItem('tip.flow.result', JSON.stringify(signedUp))

    render(timeline(null))

    expect(screen.getByText(/The whole sign-up/i)).toBeDefined()
    expect(screen.getByText('yours')).toBeDefined()
  })

  it('drops a zoom that belonged to the flow it left', () => {
    // The path holds nodes from the journey being abandoned. Carrying them into
    // a different flow would zoom the axis onto a step that is not in it.
    setFragment('#step=authorize/authorize:ssl')
    const { rerender } = render(timeline(null))
    expect(screen.getByText('TLS handshake', { selector: 'h4' })).toBeDefined()

    rerender(timeline(signedUp))

    expect(screen.queryByText('TLS handshake', { selector: 'h4' })).toBeNull()
  })

  it('leaves MSAL’s fragment alone, exactly like every other path in here', () => {
    // This runs during render, and the one absolute rule of this component is
    // that nothing during render touches location.hash. It is what broke every
    // sign-in on the live site once already.
    const authResponse = '#code=FAKE_CODE_abc123&state=st1'
    setFragment(authResponse)

    const { rerender } = render(timeline(null))
    rerender(timeline(signedUp))

    expect(location.hash).toBe(authResponse)
  })

  it('yields to a sign-out, which is something the visitor actually just did', () => {
    const withBoth = (resolvedFlow: FlowMatch, localSignOutCount: number) => (
      <JourneyTimeline
        token={token}
        tokenLabel="Sample ID token"
        resolvedFlow={resolvedFlow}
        localSignOutCount={localSignOutCount}
      />
    )
    const { rerender } = render(withBoth(null, 0))
    rerender(withBoth(signedUp, 1))

    // An answer about the session they have just left must not outrank leaving it.
    expect(screen.getByText(/The whole sign-out/i)).toBeDefined()
    expect(screen.queryByText('yours')).toBeNull()
  })
})

// ── The actor colours, which are settled ────────────────────────────────────
// Two rounds of bar treatments went into the page behind a throwaway toggle.
// This is what came back out: the solid saturated fill, with this assignment of
// hue to actor. The toggle is gone; these tests are what is left of it, and they
// exist because of the specific way this can regress.
//
// THE ASSIGNMENT MOVED. The map read browser BLUE / network GREY / entra GREEN
// for most of this component's life, and what was approved is those same three
// fills rotated one step. Nothing else in this file would notice a rotation
// back: every count, every label and every measurement would still be right, and
// the page would be wrong in the one way a reader sees immediately.

describe('the actor colours, which are settled', () => {
  const EXPECTED: Record<Actor, string> = {
    browser: 'bg-slate-400',
    network: 'bg-emerald-400',
    entra: 'bg-sky-400',
  }

  /** The overview bars, in journey order — the buttons carrying an aria-label. */
  const overviewBars = () =>
    screen.getAllByRole('button').filter((b) => b.getAttribute('aria-label'))

  it('paints every overview bar in its own actor colour, in every flow', () => {
    const covered = new Set<Actor>()

    // TAB_FLOWS, not FLOWS: this one reaches a flow by clicking its tab, and
    // the silent probe no longer has one.
    for (const flow of TAB_FLOWS) {
      cleanup()
      const events = journeyFor(flow).events
      mountFlow(FLOW_META[flow].label)

      const bars = overviewBars()
      expect(bars, `${flow} plots the wrong number of bars`).toHaveLength(events.length)

      events.forEach((event, i) => {
        // An absent node is hatched and carries no actor colour at all. That
        // rule outranks this one and keeps its own test above.
        if (event.absent) return
        expect(
          bars[i].className,
          `${flow}/${event.id} is a ${event.actor} request and is not ${EXPECTED[event.actor]}`,
        ).toContain(EXPECTED[event.actor])
        covered.add(event.actor)
      })
    }

    // Proves the loop exercised all three rather than passing because one of
    // them never appeared in any flow.
    expect([...covered].sort()).toEqual(['browser', 'entra', 'network'])
  })

  it('keys the legend to the same three colours the bars use', () => {
    // A key that disagrees with the thing it keys is worse than no key. The
    // swatches are the only 12px squares on the page, which is what makes them
    // findable without reaching for their text.
    const { container } = mount()
    const swatches = container.querySelectorAll('span.h-3.w-3.rounded-sm')
    const actors = Object.keys(ACTOR_LABELS) as Actor[]

    expect(swatches).toHaveLength(actors.length)
    actors.forEach((actor, i) => {
      expect(swatches[i].className, `the ${actor} swatch`).toContain(EXPECTED[actor])
      expect(swatches[i].nextElementSibling?.textContent).toBe(ACTOR_LABELS[actor])
    })
  })

  it('keeps the legend out of the ink the page uses for chrome', () => {
    // The report was not "the legend is small". A first-time reader did not see
    // it at all. It was 12px type in slate-600 beside an 8px square, the same
    // ink as the rules and tick numbers around it, so the whole line scanned as
    // decoration. If it is ever dimmed back this is the test that says why not.
    const { container } = mount()
    const label = container.querySelector('span.h-3.w-3.rounded-sm')?.nextElementSibling

    expect(label?.textContent).toBe(ACTOR_LABELS.browser)
    expect(label?.className).not.toContain('text-slate-600')
    expect(label?.className).not.toContain('text-xs')
  })
})

// ── The slice-label typeface. Settled, and this is what holds it there. ─────
// Six variants went into the page behind a toggle — mono, sans, a second mono,
// bigger, lighter, wider — and `sans` was picked. The toggle and its module are
// gone. What is left is one inline font-family at one call site, which is
// exactly the sort of thing a later tidy-up swaps for `font-sans` without
// noticing that Tailwind's version of that stack carries four emoji families
// the picked one does not.

describe('the slice-label typeface', () => {
  // Byte-for-byte the stack that was on screen when it was chosen.
  const SANS =
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', 'Noto Sans', Arial, sans-serif"

  /**
   * jsdom rewrites quoting on the way in, so a font stack does not read back as
   * it was written. Putting the expectation through the same parser compares
   * like with like instead of against a hand-normalised string.
   */
  const asFontFamily = (value: string) => {
    const el = document.createElement('span')
    el.style.setProperty('font-family', value)
    return el.style.getPropertyValue('font-family')
  }

  const overviewBars = () =>
    screen.getAllByRole('button').filter((b) => b.getAttribute('aria-label'))

  const firstLabel = () =>
    overviewBars()[0].querySelector<HTMLElement>('span.truncate')!

  it('sets every slice label in the sans stack, on all three actors', () => {
    const events = journeyFor('signin').events
    const covered = new Set<Actor>()
    mount()

    overviewBars().forEach((bar, i) => {
      const label = bar.querySelector<HTMLElement>('span.truncate')
      expect(label, `bar ${i} has no label span`).not.toBeNull()
      expect(
        label!.style.getPropertyValue('font-family'),
        `the ${events[i].actor} bar's label is not in the sans stack`,
      ).toBe(asFontFamily(SANS))
      covered.add(events[i].actor)
    })

    expect([...covered].sort()).toEqual(['browser', 'entra', 'network'])
  })

  it('moved the typeface and nothing else', () => {
    // One lever. Size, weight and tracking never left the baseline, so they are
    // plain utility classes and nothing inline may quietly reintroduce them.
    mount()
    const label = firstLabel()

    expect(label.className).toContain('text-sm')
    expect(label.className).toContain('font-semibold')
    expect(label.className).not.toContain('font-mono')
    expect(label.style.fontSize).toBe('')
    expect(label.style.fontWeight).toBe('')
    expect(label.style.letterSpacing).toBe('')
  })

  it('loads no webfont, which was the hard constraint on the round', () => {
    // No Google Fonts, no CDN, no self-hosted file, no new network request. A
    // stack ending in a named family rather than a generic one would also be a
    // silent dependency on one machine's font list.
    mount()
    const family = firstLabel().style.fontFamily

    expect(family).not.toMatch(/url\(|@font-face|https?:/i)
    expect(family).toMatch(/sans-serif$/)
  })

  it('leaves the bar colours alone, because that part is settled', () => {
    // Type only. An inline background would silently beat the ACTOR_BAR class
    // and break the one thing that is finished.
    mount()

    for (const bar of overviewBars()) {
      expect(bar.style.backgroundColor).toBe('')
    }
  })
})
