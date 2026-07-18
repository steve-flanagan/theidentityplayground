import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { JourneyTimeline } from './JourneyTimeline'
import { buildSampleToken } from '../lib/sampleToken'
import signinCapture from '../lib/captures/signin.json'
import signoutCapture from '../lib/captures/signout.json'
import {
  ACTOR_LABELS,
  buildJourney,
  FLOW_META,
  FLOW_ONLY,
  type Actor,
  type FlowId,
  type ZoomNode,
} from '../lib/journey'
import { clearLastFlow, markFlowStart, type FlowMatch } from '../lib/lastFlow'

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
  /** The control, whatever it ends up being called. There is only ever one. */
  const backControls = () => screen.queryAllByRole('button', { name: /back/i })
  const backControl = () => backControls()[0]

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

    expect(backControls()).toHaveLength(1)
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
    // Still one level in, so still offered.
    expect(backControls()).toHaveLength(1)

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

    for (const flow of FLOWS) {
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
