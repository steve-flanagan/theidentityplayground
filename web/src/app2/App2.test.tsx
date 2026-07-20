import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
 *
 * The token the silent call comes back with is a parameter, because it is not
 * the same token the gate in front of that call looks at. `holdsTokenForThisApp`
 * reads the ACCOUNT's ID token; the result's is never re-checked there, and the
 * page's own audience check is what catches it. That gap is the cache and
 * renewal route into the refusal, and it is mounted below.
 */
function fakeInstanceReturning(idToken: string, fromCache: boolean): IPublicClientApplication {
  return {
    getActiveAccount: () => accountHoldingApp2Token(),
    getAllAccounts: () => [accountHoldingApp2Token()],
    acquireTokenSilent: vi.fn(() =>
      Promise.resolve({ idToken, fromCache } as AuthenticationResult),
    ),
    loginRedirect: vi.fn(() => Promise.resolve()),
  } as unknown as IPublicClientApplication
}

/** The ordinary case: the silent call hands back this app's own token. */
function fakeInstance(fromCache: boolean): IPublicClientApplication {
  return fakeInstanceReturning(APP2_TOKEN, fromCache)
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

/**
 * The action button, scoped to the state panel it sits in.
 *
 * Scoped rather than taken from the whole document because the claims section
 * renders a `<summary>` for the raw token, and that carries the button role
 * too. An unscoped `getByRole('button')` therefore matches two elements in
 * exactly the states where a token is on screen, which is where these
 * assertions need to be sharpest.
 *
 * Reached through the section's own `aria-labelledby` target for the same
 * reason as `mechanismHeading`: the label is what is under test, so finding
 * the button by its text would make every assertion circular.
 */
function actionButton(): HTMLElement {
  const panel = document.getElementById('state')?.closest('section')
  if (!panel) throw new Error('the state panel never rendered')
  return within(panel).getByRole('button')
}

type State = { name: string; panelSays: string; enter: () => Promise<void> }

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
const FOREIGN_AUDIENCE_STATES: State[] = [
  {
    name: 'a token addressed to another client id, off the redirect',
    panelSays: 'Refusing to show this token.',
    enter: async () => {
      mount({ idToken: idTokenFor(MAIN_CLIENT_ID_FOR_DISPLAY), elapsedMs: 12 })
    },
  },
  {
    name: 'a token addressed to another client id, out of the cache',
    panelSays: 'Refusing to show this token.',
    enter: async () => {
      mount({ instance: fakeInstanceReturning(idTokenFor(MAIN_CLIENT_ID_FOR_DISPLAY), true) })
      await pressAndWaitFor('Refusing to show this token.')
    },
  },
  {
    name: 'a token addressed to another client id, off a renewal',
    panelSays: 'Refusing to show this token.',
    enter: async () => {
      mount({ instance: fakeInstanceReturning(idTokenFor(MAIN_CLIENT_ID_FOR_DISPLAY), false) })
      await pressAndWaitFor('Refusing to show this token.')
    },
  },
]

const STATES: State[] = [
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
    panelSays: 'Token issued. The round trip does not prove SSO.',
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
  // Three of them, not one. The refusal is keyed on the classified kind alone,
  // and `held.source` is independent of it, so a token addressed elsewhere
  // reaches the refusal from the redirect, from the cache, and from a renewal.
  // All three hold a token, which is the thing the button's label was reading.
  ...FOREIGN_AUDIENCE_STATES,
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

    expect(screen.getByText('Token issued. The round trip does not prove SSO.')).toBeTruthy()
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

describe('the button never offers what the page has just refused', () => {
  // The panel refuses a token addressed to another client and suppresses the
  // claims table under it, while the button read "Show the token this app
  // holds". The label branched on `held` being truthy, and a refused token is
  // still held, so the page offered to show what it had refused a line above.
  //
  // THE BUTTON STAYS. Pressing it in that state does something: `getToken`
  // never reads `held`. It goes to `acquireHeldToken`, which reads MSAL's
  // account cache and falls through to a top-level redirect, and every branch
  // ends at a token issued to this client ID. The refusal is not sticky, so
  // the label was the wrong half of it.

  it('offers to fetch a token rather than to show the one it refused', async () => {
    for (const state of FOREIGN_AUDIENCE_STATES) {
      await state.enter()

      // Proof the refusal is the branch on screen, and that the claims table
      // it suppresses really is absent.
      expect(screen.getByText('Refusing to show this token.')).toBeTruthy()
      expect(document.getElementById('claims')).toBeNull()

      // Matched on the offer, not on the exact wording, so rewording the label
      // is free and dropping the action is not.
      expect(actionButton().textContent).not.toMatch(/\bshow\b/i)
      expect(actionButton().textContent).toMatch(/get a token/i)

      cleanup()
    }
  })

  it('offers to show a token only in the states that show one', async () => {
    // The defect in its general form, and the reason it is worth a second
    // test. The label asks whether a token is HELD; the claims table asks
    // whether it will be SHOWN. Those are different questions, and the first
    // one answering for the second is what broke. Any future label keyed on
    // holding can drift from showing the same way.
    const offering: string[] = []

    for (const state of STATES) {
      await state.enter()

      const label = actionButton().textContent ?? ''
      // The claims section's own heading id. Present exactly when the token is
      // on screen, so this reads the render structurally rather than matching
      // the copy that is under test.
      const tokenOnScreen = document.getElementById('claims') !== null

      if (/\bshow\b/i.test(label) && !tokenOnScreen) offering.push(`${state.name}: "${label}"`)

      cleanup()
    }

    expect(offering).toEqual([])
  })
})
