import { app, type InvocationContext, type Timer } from '@azure/functions'
import { expireUsers } from '../lib/scim/store'
import { expireEvents } from '../lib/scim/events'

/**
 * Expires SCIM rows on a timer. The downstream app's half of the self-destruct
 * promise.
 *
 * The site tells every visitor their demo account self-destructs. Before this,
 * that was only true of the DIRECTORY object: scripts/Remove-ExpiredDemoAccounts.ps1
 * deletes the user in The Identity Playground Workforce
 * (9e1372b0-e94f-40af-aef8-6a5fa2bfb2e4) and has no idea Table Storage exists, so
 * the row it was provisioned into lived forever. The first orphan appeared within
 * an hour of the endpoint going live: a terminated hire whose directory object was
 * gone while its SCIM row still read active.
 *
 * ── WHY A SECOND SWEEP RATHER THAN ONE THAT DOES BOTH ────────────────────────
 *
 * Decision 009 rejected one workflow spanning both tenants for the same reason
 * this stays separate: different cadence, different blast radius, and one job
 * holding delete rights over two systems at once is a wider surface for the same
 * work. This one holds no Graph permission at all. It can delete rows in one
 * table and nothing else, which is the whole of its authority.
 *
 * ── HOURLY, ON THE HOUR, MATCHING THE DIRECTORY SWEEP ────────────────────────
 *
 * Timer triggers on the consumption plan are woken by the runtime rather than by
 * a cron daemon, so a cold app can miss a tick. That is acceptable here and it is
 * why the TTL is a window rather than an instant: a missed hour delays a deletion,
 * it does not skip it.
 */

// NCRONTAB is six fields on Azure Functions, seconds first. Top of every hour.
const SCHEDULE = '0 0 * * * *'

/** Longer than the directory's 24h, on purpose. See store.ts, expireUsers. */
const TTL_HOURS = Number(process.env.SCIM_ROW_TTL_HOURS ?? '36')

/** Abort above this rather than truncating. See store.ts. */
const CEILING = Number(process.env.SCIM_EXPIRY_CEILING ?? '50')

export async function scimExpire(_timer: Timer, context: InvocationContext): Promise<void> {
  const result = await expireUsers(TTL_HOURS, CEILING)

  /**
   * The transcript expires too, and on the SAME clock as the rows it describes.
   *
   * A transcript that outlived its rows would show a hire whose employee no
   * longer exists anywhere, which is a worse lie than showing nothing. No ceiling
   * here: unlike users, an event is a log line, deleting the wrong one loses
   * nothing recoverable, and the count scales with traffic rather than with
   * anything a mistake could inflate.
   */
  const eventsDeleted = await expireEvents(TTL_HOURS)
  context.log(`scim expiry: events deleted=${eventsDeleted}`)

  // Counts, never userNames. This log is operator-facing but the rows describe
  // people who signed up on a public website, and the PowerShell sweep already
  // established the house rule: a run that finds nothing and a run whose rule
  // matches nothing produce the same zero, so print the breakdown, not the names.
  context.log(
    `scim expiry: scanned=${result.scanned} expired=${result.expired} deleted=${result.deleted} ttl=${TTL_HOURS}h`,
  )

  if (result.aborted) {
    // Loud. An unexpected number of expired rows means something upstream changed
    // — a flood of hires, a clock problem, a TTL edit — and deleting the first N
    // of a set nobody understands is how a bug becomes data loss.
    context.error(
      `scim expiry ABORTED: ${result.expired} rows over the ceiling of ${CEILING}. Nothing deleted.`,
    )
    throw new Error('scim expiry ceiling exceeded')
  }
}

app.timer('scim-expire', { schedule: SCHEDULE, handler: scimExpire })
