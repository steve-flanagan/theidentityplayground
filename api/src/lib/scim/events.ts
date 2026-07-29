import { TableClient, odata } from '@azure/data-tables'
import { DefaultAzureCredential } from '@azure/identity'
import { randomUUID } from 'node:crypto'

/**
 * Every SCIM exchange this endpoint handles, recorded so the page can show them.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 *
 * Without it the module is a button that produces a name, and an IAM engineer has
 * no reason to believe anything happened. The interesting thing about SCIM
 * provisioning is not that a row appears — it is the traffic: the match query
 * Entra issues before every create, the shape of the PATCH it sends to disable
 * someone, and the fact that that PATCH does not follow the specification
 * Microsoft asks you to implement.
 *
 * We are the server. Those requests arrive here. Throwing them away and then
 * describing them in prose would be a diagram of a demo rather than a demo.
 *
 * ── WHAT IS AND IS NOT RECORDED ──────────────────────────────────────────────
 *
 * Method, path, status, request body, and a short response summary. **No
 * headers, ever.** The Authorization header on these requests carries the bearer
 * token Entra presents; recording headers "for completeness" would write that
 * credential into a table that a public endpoint reads out. It is not filtered,
 * it is not collected.
 *
 * Bodies are safe to show for the same specific reason the feed is: every SCIM
 * resource here describes an employee this backend invented, from a fixed list of
 * names, with no visitor input anywhere in the path. That argument does not
 * transfer to anything carrying real visitor data.
 */

const TABLE_ENDPOINT = process.env.RATE_LIMIT_TABLE_ENDPOINT ?? ''
const TABLE_NAME = process.env.SCIM_EVENTS_TABLE_NAME ?? 'ScimEvents'
const PARTITION = 'event'

/** Table Storage caps a string property well above this. The cap is about the
 *  page staying readable, not about the store. */
const MAX_BODY = 4000

let client: TableClient | undefined
function table(): TableClient {
  if (!client) {
    if (!TABLE_ENDPOINT) throw new Error('RATE_LIMIT_TABLE_ENDPOINT is not set')
    client = new TableClient(TABLE_ENDPOINT, TABLE_NAME, new DefaultAzureCredential())
  }
  return client
}

let ensured: Promise<void> | undefined
function ensureTable(t: TableClient): Promise<void> {
  if (!ensured) {
    ensured = t.createTable().then(
      () => undefined,
      (err: any) => {
        if (err?.statusCode === 409) return
        ensured = undefined
        throw err
      },
    )
  }
  return ensured
}

/**
 * Newest first, for free.
 *
 * Table Storage returns rows in ascending rowKey order within a partition, and
 * there is no descending sort. Storing an INVERTED timestamp means the natural
 * order is already the order the page wants, so reading the latest twenty is a
 * top-20 query rather than a full scan and a sort in memory.
 *
 * The uuid suffix is not decoration: two requests inside the same millisecond
 * would otherwise collide on the row key, and Entra's match-then-create is
 * exactly the pattern that fires two requests back to back.
 */
function descendingKey(atMs: number): string {
  const inverted = (9_999_999_999_999 - atMs).toString().padStart(13, '0')
  return `${inverted}-${randomUUID()}`
}

export interface ScimEvent {
  at: string
  method: string
  path: string
  status: number
  requestBody: string
  responseSummary: string
}

interface EventRow extends ScimEvent {
  partitionKey: string
  rowKey: string
}

/**
 * Records one exchange. NEVER throws.
 *
 * This runs on the response path of a live provisioning endpoint. A failure to
 * record is a cosmetic problem — the page misses a line — while a failure to
 * respond breaks Entra's cycle and quarantines the job. The demo is not allowed
 * to endanger the thing it demonstrates.
 */
export async function recordEvent(event: ScimEvent): Promise<void> {
  try {
    const t = table()
    await ensureTable(t)
    await t.createEntity<EventRow>({
      partitionKey: PARTITION,
      rowKey: descendingKey(Date.parse(event.at) || Date.now()),
      ...event,
      requestBody: event.requestBody.slice(0, MAX_BODY),
      responseSummary: event.responseSummary.slice(0, MAX_BODY),
    })
  } catch {
    // Deliberately swallowed, and this is the one place in this codebase where
    // that is right. See above.
  }
}

export async function listEvents(limit: number): Promise<ScimEvent[]> {
  const t = table()
  await ensureTable(t)
  const out: ScimEvent[] = []
  const iterator = t.listEntities<EventRow>({
    queryOptions: { filter: odata`PartitionKey eq ${PARTITION}` },
  })
  for await (const row of iterator) {
    out.push({
      at: row.at,
      method: row.method,
      path: row.path,
      status: row.status,
      requestBody: row.requestBody ?? '',
      responseSummary: row.responseSummary ?? '',
    })
    if (out.length >= limit) break
  }
  return out
}

/**
 * Expires old events. Same contract and the same failure direction as
 * store.ts's selectExpired: a row whose stamp will not parse is never selected,
 * because a row we cannot age is a row we do not understand.
 */
export async function expireEvents(olderThanHours: number): Promise<number> {
  const t = table()
  await ensureTable(t)
  const cutoff = Date.now() - olderThanHours * 3600_000
  let deleted = 0
  const iterator = t.listEntities<EventRow>({
    queryOptions: { filter: odata`PartitionKey eq ${PARTITION}` },
  })
  const doomed: string[] = []
  for await (const row of iterator) {
    const at = Date.parse(row.at ?? '')
    if (Number.isNaN(at)) continue
    if (at < cutoff) doomed.push(row.rowKey)
  }
  for (const rowKey of doomed) {
    try {
      await t.deleteEntity(PARTITION, rowKey)
      deleted++
    } catch {
      // A row that vanished between the scan and the delete is fine.
    }
  }
  return deleted
}
