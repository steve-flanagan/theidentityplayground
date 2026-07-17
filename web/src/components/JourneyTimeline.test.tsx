import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { JourneyTimeline } from './JourneyTimeline'
import { buildSampleToken } from '../lib/sampleToken'
import signinCapture from '../lib/captures/signin.json'
import { buildJourney, type ZoomNode } from '../lib/journey'

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
    for (const flow of ['signin', 'signup'] as const) {
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

  it('never puts human thinking time on the machine axis', () => {
    // The gaps are enormous — 12.5s typing an email against 1.9s of machine.
    // If they ever leaked onto the axis, machine time would balloon toward wall.
    expect(signinCapture.machineMs).toBeLessThan(signinCapture.wallMs / 5)
  })
})
