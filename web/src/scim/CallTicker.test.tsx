import { render, screen, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CallTicker } from './CallTicker'

/**
 * The ticker plays a queue on timers, which makes it exactly the kind of thing
 * that looks fine in a screenshot and is wrong in motion. It could not be
 * exercised end to end when it was written — the field feeding it was not
 * deployed and the hire endpoint's rate limit was spent — so the behaviour is
 * pinned here instead of assumed.
 */

const LINE_MS = 450

describe('CallTicker', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  it('shows nothing before anything has happened', () => {
    render(<CallTicker queue={[]} />)
    expect(screen.queryByText(/POST/)).toBeNull()
  })

  it('reveals lines one at a time, in order', () => {
    render(<CallTicker queue={['POST /users 201', 'POST /provisionOnDemand 200']} />)

    act(() => { vi.advanceTimersByTime(10) })
    expect(screen.getByText('POST /users 201')).toBeTruthy()
    expect(screen.queryByText('POST /provisionOnDemand 200')).toBeNull()

    act(() => { vi.advanceTimersByTime(LINE_MS) })
    expect(screen.getByText('POST /provisionOnDemand 200')).toBeTruthy()
  })

  it('keeps at most three on screen, dropping the oldest', () => {
    const queue = ['one', 'two', 'three', 'four']
    render(<CallTicker queue={queue} />)

    act(() => { vi.advanceTimersByTime(LINE_MS * 4) })
    expect(screen.queryByText('one')).toBeNull()
    for (const line of ['two', 'three', 'four']) {
      expect(screen.getByText(line)).toBeTruthy()
    }
  })

  it('clears itself afterwards, because the table below is the durable copy', () => {
    render(<CallTicker queue={['POST /users 201']} />)
    act(() => { vi.advanceTimersByTime(LINE_MS) })
    expect(screen.getByText('POST /users 201')).toBeTruthy()

    act(() => { vi.advanceTimersByTime(3000) })
    expect(screen.queryByText('POST /users 201')).toBeNull()
  })

  it('starts over on a new queue instead of interleaving two sequences', () => {
    // A visitor hiring again while the first sequence is still playing. Without
    // the timer cleanup the two runs would tangle and show calls that never
    // happened together.
    const { rerender } = render(<CallTicker queue={['first call']} />)
    act(() => { vi.advanceTimersByTime(10) })
    expect(screen.getByText('first call')).toBeTruthy()

    rerender(<CallTicker queue={['second call']} />)
    act(() => { vi.advanceTimersByTime(10) })
    expect(screen.queryByText('first call')).toBeNull()
    expect(screen.getByText('second call')).toBeTruthy()
  })

  it('reserves its height whether or not anything is playing', () => {
    // The icons sit under this. If the box collapsed when empty, every call would
    // make the whole diagram jump.
    const { container } = render(<CallTicker queue={[]} />)
    expect(container.querySelector('.h-12')).toBeTruthy()
  })
})
