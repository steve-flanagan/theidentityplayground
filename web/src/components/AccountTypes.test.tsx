import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { AccountTypes } from './AccountTypes'

// AccountTypes no longer reads MSAL — App drives it through activeKey — so there
// is nothing to mock. The one behaviour worth pinning is the one that regressed:
// the map follows activeKey, and returns to the customer default when it clears.
// Exiting a member or guest view must move the map off the type it was showing,
// not leave it stuck there.

afterEach(cleanup)

/** The picker button currently selected — the one carrying the active ring. */
const selected = () =>
  screen
    .getAllByRole('button')
    .find(
      (b) =>
        /border-emerald-500/.test(b.className) &&
        ['CIAM Customer', 'Workforce member', 'B2B guest'].includes(b.textContent!.trim()),
    )
    ?.textContent?.trim()

describe('the account-types map follows the active identity', () => {
  it('leads with the customer by default', () => {
    render(<AccountTypes />)
    expect(selected()).toBe('CIAM Customer')
  })

  it('switches to the identity activeKey names', () => {
    render(<AccountTypes activeKey="member" />)
    expect(selected()).toBe('Workforce member')
  })

  it('returns to the customer when activeKey clears', () => {
    // The regression: exiting the member sample (activeKey member -> undefined)
    // left the map on "Workforce member" because the sync only moved it when the
    // new key matched an identity.
    const { rerender } = render(<AccountTypes activeKey="member" />)
    expect(selected()).toBe('Workforce member')

    rerender(<AccountTypes activeKey={undefined} />)
    expect(selected()).toBe('CIAM Customer')
  })
})
