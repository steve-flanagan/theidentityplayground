import { describe, it, expect } from 'vitest'

import {
  SWEEPS,
  formatAge,
  isStale,
  parseRuns,
  runsUrl,
  workflowUrl,
  type CleanupRun,
} from './cleanupRuns'

/*
 * Module 7 reads a third-party API at runtime, in a visitor's browser, with no
 * ability to make GitHub behave for a test. So the split under test is: every
 * decision the page makes is a pure function over data, and the only thing that
 * touches the network is a thin wrapper around fetch.
 *
 * These cover the decisions. The wrapper takes an injectable fetch precisely so
 * nothing here needs a network.
 */

const run = (over: Partial<CleanupRun> = {}): CleanupRun => ({
  id: 1,
  conclusion: 'success',
  status: 'completed',
  event: 'schedule',
  startedAt: '2026-07-24T12:00:00Z',
  url: 'https://github.com/example/run/1',
  ...over,
})

describe('parseRuns', () => {
  it('pulls the fields the page uses', () => {
    const parsed = parseRuns({
      workflow_runs: [
        {
          id: 30010314397,
          conclusion: 'success',
          status: 'completed',
          event: 'schedule',
          run_started_at: '2026-07-23T13:14:02Z',
          created_at: '2026-07-23T13:13:00Z',
          html_url: 'https://github.com/x/actions/runs/30010314397',
        },
      ],
    })

    expect(parsed).toHaveLength(1)
    expect(parsed[0].id).toBe(30010314397)
    expect(parsed[0].conclusion).toBe('success')
    expect(parsed[0].url).toBe('https://github.com/x/actions/runs/30010314397')
  })

  it('prefers run_started_at over created_at', () => {
    // On a delayed schedule these differ, and "when did it last run" is the
    // honest one. GitHub queued the 23 July guest runs well before they ran.
    const parsed = parseRuns({
      workflow_runs: [
        { id: 1, run_started_at: '2026-07-23T13:14:02Z', created_at: '2026-07-23T11:00:00Z' },
      ],
    })
    expect(parsed[0].startedAt).toBe('2026-07-23T13:14:02Z')
  })

  it('falls back to created_at when run_started_at is absent', () => {
    const parsed = parseRuns({ workflow_runs: [{ id: 1, created_at: '2026-07-23T11:00:00Z' }] })
    expect(parsed[0].startedAt).toBe('2026-07-23T11:00:00Z')
  })

  it('keeps a run that is still going, with a null conclusion', () => {
    // An in-progress run has conclusion null. Dropping it would make a sweep
    // that is running RIGHT NOW look like one that has not run.
    const parsed = parseRuns({
      workflow_runs: [
        { id: 1, conclusion: null, status: 'in_progress', created_at: '2026-07-24T12:00:00Z' },
      ],
    })
    expect(parsed).toHaveLength(1)
    expect(parsed[0].conclusion).toBeNull()
  })

  it('survives every shape a third-party API can hand back', () => {
    // The page must not throw because GitHub moved a field. A section that
    // reports it could not read the runs is fine; a blank page is not.
    expect(parseRuns(null)).toEqual([])
    expect(parseRuns(undefined)).toEqual([])
    expect(parseRuns('nope')).toEqual([])
    expect(parseRuns({})).toEqual([])
    expect(parseRuns({ workflow_runs: 'not an array' })).toEqual([])
    expect(parseRuns({ workflow_runs: [null, 42, 'x'] })).toEqual([])
    // Individually malformed entries drop out; valid neighbours survive.
    expect(
      parseRuns({ workflow_runs: [{ nope: true }, { id: 2, created_at: '2026-07-24T12:00:00Z' }] }),
    ).toHaveLength(1)
  })
})

describe('isStale', () => {
  const guest = SWEEPS.find((s) => s.id === 'guest')!
  const now = new Date('2026-07-24T12:00:00Z')

  it('is not stale inside the threshold', () => {
    expect(isStale(run({ startedAt: '2026-07-24T09:00:00Z' }), guest, now)).toBe(false)
  })

  it('is stale past it', () => {
    expect(isStale(run({ startedAt: '2026-07-24T02:00:00Z' }), guest, now)).toBe(true)
  })

  it('treats no runs at all as stale', () => {
    // A workflow that has never run is exactly the failure this module exists
    // to surface, so "no data" must not read as "fine".
    expect(isStale(undefined, guest, now)).toBe(true)
  })

  it('tolerates ordinary GitHub lateness on the hourly sweep', () => {
    // Observed 23 July: the hourly guest cron delivered at 08:03, 10:53, 13:14.
    // Roughly every 2.5 hours. A threshold at the cron interval would call that
    // broken, and a monitor that cries wolf gets ignored.
    const lateButNormal = new Date('2026-07-24T14:30:00Z')
    expect(isStale(run({ startedAt: '2026-07-24T12:00:00Z' }), guest, lateButNormal)).toBe(false)
  })

  it('gives the six-hourly sweep a longer leash than the hourly one', () => {
    const customer = SWEEPS.find((s) => s.id === 'customer')!
    expect(customer.staleAfterHours).toBeGreaterThan(guest.staleAfterHours)

    // 8 hours: fine for the six-hourly sweep, wrong for the hourly one.
    const eightHoursAgo = run({ startedAt: '2026-07-24T04:00:00Z' })
    expect(isStale(eightHoursAgo, customer, now)).toBe(false)
    expect(isStale(eightHoursAgo, guest, now)).toBe(true)
  })
})

describe('formatAge', () => {
  const now = new Date('2026-07-24T12:00:00Z')

  it('reads coarsely', () => {
    expect(formatAge('2026-07-24T11:59:40Z', now)).toBe('just now')
    expect(formatAge('2026-07-24T11:20:00Z', now)).toBe('40 min ago')
    expect(formatAge('2026-07-24T11:00:00Z', now)).toBe('1 hour ago')
    expect(formatAge('2026-07-24T09:00:00Z', now)).toBe('3 hours ago')
    expect(formatAge('2026-07-22T12:00:00Z', now)).toBe('2 days ago')
  })

  it('singularises', () => {
    expect(formatAge('2026-07-23T12:00:00Z', now)).toBe('1 day ago')
  })

  it('does not throw on an unparseable timestamp', () => {
    expect(formatAge('not a date', now)).toBe('unknown')
  })
})

describe('urls', () => {
  it('points at the real repository and workflows', () => {
    // These are the whole evidence claim: if they drift, the page links to
    // nothing and the section is decoration.
    for (const sweep of SWEEPS) {
      expect(runsUrl(sweep)).toContain('api.github.com/repos/steve-flanagan/theidentityplayground')
      expect(runsUrl(sweep)).toContain(sweep.workflow)
      expect(workflowUrl(sweep)).toContain(`/actions/workflows/${sweep.workflow}`)
    }
  })

  it('covers both tenants', () => {
    // One sweep per tenant holding demo accounts. Dropping one would leave a
    // whole tenant unmonitored while the page implied otherwise.
    expect(SWEEPS.map((s) => s.workflow).sort()).toEqual([
      'cleanup-demo-accounts.yml',
      'cleanup-guest-accounts.yml',
    ])
  })
})
