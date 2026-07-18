import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { JourneyTimeline } from './JourneyTimeline'
import { buildSampleToken } from '../lib/sampleToken'
import signinCapture from '../lib/captures/signin.json'
import signoutCapture from '../lib/captures/signout.json'
import { buildJourney, FLOW_ONLY, type FlowId, type ZoomNode } from '../lib/journey'

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

beforeEach(() => setFragment(''))
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
