import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { JourneyTimeline } from './JourneyTimeline'
import { buildSampleToken } from '../lib/sampleToken'

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
    expect(screen.getByText('14 events')).toBeDefined()
  })

  it('writes nothing to a clean URL on mount', () => {
    mount()

    // The mount-time write is what destroyed the code. There must not be one.
    expect(location.hash).toBe('')
  })
})

describe('our own deep links', () => {
  it('restores a step path from a namespaced fragment', () => {
    setFragment('#step=pkce/pkce:nonce')

    mount()

    // Zoomed into the PKCE slice, with the nonce leaf selected.
    expect(screen.getByText('nonce', { selector: 'h4' })).toBeDefined()
    expect(screen.getByText(/1% of the sign-in/)).toBeDefined()
  })

  it('ignores a namespaced fragment naming steps that do not exist', () => {
    setFragment('#step=not-a-real-event/nor-this')

    mount()

    expect(screen.getByText('14 events')).toBeDefined()
  })
})
