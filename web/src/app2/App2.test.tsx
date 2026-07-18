import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { AccountInfo, AuthenticationResult, IPublicClientApplication } from '@azure/msal-browser'
import { App2 } from './App2'
import { APP2_CLIENT_ID, MAIN_CLIENT_ID_FOR_DISPLAY } from '../auth/app2MsalConfig'
import { HUMAN_FLOOR_MS } from '../lib/lastFlow'

// The heading of the closing section used to read "Why there was no prompt",
// and it renders in EVERY state this page has. In the interactive branch the
// page says the round trip was long enough for a person to have typed, so it
// will not call the result SSO — and a prompt very likely did appear. The
// heading asserted an outcome the text beneath it contradicted.
//
// On a site whose argument is that it never claims more than it measured, that
// is the same class of fault as a wrong number, so it is fenced with a test
// rather than just fixed.
//
// WHAT DECIDES A BRANCH IS NOT `classifyAcquisition` ALONE. The page keys its
// state panel on `held.source` as well as the classified kind, and the two do
// not line up one-to-one: a cache hit and a silent renewal are BOTH classified
// `untimed`, because the round-trip measurement describes the redirect and
// neither of them made that trip. So `untimed` reaches three different blocks
// depending on where the token came from. Every one of them is mounted below;
// a table keyed on the union alone would silently miss two.

/** A JWT-shaped string with a readable payload. No signature is ever checked. */
function idTokenFor(audience: string): string {
  const seg = (value: object) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `${seg({ alg: 'RS256', typ: 'JWT' })}.${seg({ aud: audience, sub: 'demo' })}.not-a-signature`
}

const APP2_TOKEN = idTokenFor(APP2_CLIENT_ID)

/** Enough of an AccountInfo for the silent path, which reads `idToken`. */
function accountHoldingApp2Token(): AccountInfo {
  return {
    homeAccountId: 'home-account-id',
    environment: 'theidentityplayground.ciamlogin.com',
    tenantId: '7e8da8a9-67bc-4d53-bfc7-fe3e13128382',
    username: 'demo@theidentityplayground.com',
    localAccountId: 'local-account-id',
    idToken: APP2_TOKEN,
  }
}

/**
 * Only what the button touches. `acquireHeldToken` reads three methods, and
 * `loginRedirect` is stubbed so a fall-through cannot navigate jsdom.
 */
function fakeInstance(fromCache: boolean): IPublicClientApplication {
  return {
    getActiveAccount: () => accountHoldingApp2Token(),
    getAllAccounts: () => [accountHoldingApp2Token()],
    acquireTokenSilent: vi.fn(() =>
      Promise.resolve({ idToken: APP2_TOKEN, fromCache } as AuthenticationResult),
    ),
    loginRedirect: vi.fn(() => Promise.resolve()),
  } as unknown as IPublicClientApplication
}

type Props = Parameters<typeof App2>[0]

function mount(overrides: Partial<Props> = {}) {
  return render(
    <App2
      instance={fakeInstance(true)}
      idToken={null}
      elapsedMs={null}
      redirectError={null}
      sharedAccountName={null}
      {...overrides}
    />,
  )
}

/**
 * The closing section's heading, read structurally rather than by its text.
 *
 * Found through the `id` the section's own `aria-labelledby` points at, so this
 * keeps working when the wording changes and throws if the section stops
 * rendering. A text query would make every assertion below circular.
 */
function mechanismHeading(): string {
  const heading = document.getElementById('how')
  if (!heading) throw new Error('the closing section never rendered')
  return heading.textContent?.trim() ?? ''
}

/** Presses the button and waits for the silent path to land a token. */
async function pressAndWaitFor(text: string) {
  fireEvent.click(screen.getByRole('button'))
  await screen.findByText(text)
}

/**
 * Every state the page can be in, and the line the state panel prints in it.
 *
 * The panel assertion is not decoration. Without it a heading check passes
 * just as happily against a branch that never rendered.
 */
const STATES: { name: string; panelSays: string; enter: () => Promise<void> }[] = [
  {
    name: 'no token yet',
    panelSays: 'This application has no token.',
    enter: async () => {
      mount()
    },
  },
  {
    name: 'redirect, faster than anyone can type',
    panelSays: 'Token issued. No prompt appeared.',
    enter: async () => {
      mount({ idToken: APP2_TOKEN, elapsedMs: HUMAN_FLOOR_MS - 1 })
    },
  },
  {
    name: 'redirect, slow enough that someone may have typed',
    panelSays: 'Token issued, but this page will not call it SSO.',
    enter: async () => {
      mount({ idToken: APP2_TOKEN, elapsedMs: HUMAN_FLOOR_MS })
    },
  },
  {
    name: 'redirect, no measurement available',
    panelSays: 'Token issued. Timing unknown.',
    enter: async () => {
      mount({ idToken: APP2_TOKEN, elapsedMs: null })
    },
  },
  {
    name: 'served from this app cache, no request at all',
    panelSays: 'Token read from the cache.',
    enter: async () => {
      mount({ instance: fakeInstance(true) })
      await pressAndWaitFor('Token read from the cache.')
    },
  },
  {
    name: 'renewed silently over the network',
    panelSays: 'Token renewed silently.',
    enter: async () => {
      mount({ instance: fakeInstance(false) })
      await pressAndWaitFor('Token renewed silently.')
    },
  },
  {
    name: 'a token addressed to another client id',
    panelSays: 'Refusing to show this token.',
    enter: async () => {
      mount({ idToken: idTokenFor(MAIN_CLIENT_ID_FOR_DISPLAY), elapsedMs: 12 })
    },
  },
]

/**
 * The heading as shipped. One constant, so deciding to word it differently is
 * one edit here rather than seven.
 */
const MECHANISM_HEADING = 'Why Entra can skip the prompt'

afterEach(cleanup)

describe('the closing heading describes the mechanism, not what just happened', () => {
  it.each(STATES)('holds in: $name', async ({ panelSays, enter }) => {
    await enter()

    // Proof the branch under test is the one on screen.
    expect(screen.getByText(panelSays)).toBeTruthy()
    expect(mechanismHeading()).toBe(MECHANISM_HEADING)
  })

  it('never asserts an outcome, in any state the page can reach', async () => {
    // The defect in its general form, and the assertion that survives a change
    // of wording. A heading in the past tense is a claim about this run, and
    // this section renders in states where the page has measured nothing,
    // refused to conclude, or refused the token outright.
    for (const state of STATES) {
      await state.enter()
      expect(mechanismHeading()).not.toMatch(/there was no prompt/i)
      cleanup()
    }
  })

  it('does not tell the reader no prompt appeared while the page is saying one might have', () => {
    // The exact contradiction that existed. Written as a constraint on the
    // interactive branch rather than as "both branches match", so that giving
    // the SSO branch a stronger heading of its own would still pass.
    mount({ idToken: APP2_TOKEN, elapsedMs: HUMAN_FLOOR_MS })

    expect(screen.getByText('Token issued, but this page will not call it SSO.')).toBeTruthy()
    expect(mechanismHeading()).not.toMatch(/no prompt|was no|did not appear/i)
  })
})

describe('the state panel keeps its own claims straight', () => {
  // Guards the other half of the fix: the outcome claim was left where it is
  // measured, so it must still be there, and still only there.

  it('claims no prompt appeared only where the clock rules one out', () => {
    mount({ idToken: APP2_TOKEN, elapsedMs: HUMAN_FLOOR_MS - 1 })
    expect(screen.getByText('Token issued. No prompt appeared.')).toBeTruthy()
  })

  it('makes no such claim once there was time for someone to interact', () => {
    mount({ idToken: APP2_TOKEN, elapsedMs: HUMAN_FLOOR_MS })
    expect(screen.queryByText('Token issued. No prompt appeared.')).toBeNull()
  })

  it('makes no such claim when the round trip could not be measured', () => {
    mount({ idToken: APP2_TOKEN, elapsedMs: null })
    expect(screen.queryByText('Token issued. No prompt appeared.')).toBeNull()
  })
})
