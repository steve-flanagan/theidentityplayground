import { TableClient, odata } from '@azure/data-tables'
import { DefaultAzureCredential } from '@azure/identity'
import { randomUUID } from 'node:crypto'
import { SCHEMA_USER, type ScimUser } from './types'

/**
 * Table Storage persistence for the SCIM users this endpoint is provisioned.
 *
 * Same storage account and the same keyless auth as the rate limiter: the
 * Function App's SYSTEM-ASSIGNED managed identity, reached through a bare
 * DefaultAzureCredential. That is correct here and it is worth stating, because
 * the app now carries two identities — asking without a client id yields the
 * system-assigned one, which is the one holding Storage Table Data Contributor.
 * The user-assigned identity is for cross-tenant Graph and nothing else.
 * See ADR 012.
 *
 * One partition. This is a demo directory of a handful of users, and a single
 * partition keeps listing and counting cheap and consistent. It would be the
 * wrong choice for a real tenant and the right one here.
 */

const TABLE_ENDPOINT = process.env.RATE_LIMIT_TABLE_ENDPOINT ?? ''
const TABLE_NAME = process.env.SCIM_TABLE_NAME ?? 'ScimUsers'
const PARTITION = 'user'

let client: TableClient | undefined
function table(): TableClient {
  if (!client) {
    if (!TABLE_ENDPOINT) throw new Error('RATE_LIMIT_TABLE_ENDPOINT is not set')
    client = new TableClient(TABLE_ENDPOINT, TABLE_NAME, new DefaultAzureCredential())
  }
  return client
}

// Created on first use rather than by a provisioning script, so the app owns its
// own storage and a recreated account self-heals. 409 means it already exists.
// Same shape as rateLimit.ts, including clearing the memo on failure so a
// transient blip does not wedge the endpoint closed forever.
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
 * The stored row. SCIM's nested objects (name, emails) are flattened rather than
 * stored as JSON blobs, because Table Storage cannot query inside a blob and the
 * userName lookup below has to be a server-side filter — Entra issues it on
 * every single provisioning cycle, for every user, as its match step.
 */
interface UserRow {
  partitionKey: string
  rowKey: string
  userName: string
  externalId?: string
  displayName?: string
  givenName?: string
  familyName?: string
  email?: string
  active: boolean
  created: string
  lastModified: string
}

function toScim(row: UserRow, baseUrl: string): ScimUser {
  const user: ScimUser = {
    schemas: [SCHEMA_USER],
    id: row.rowKey,
    userName: row.userName,
    active: row.active,
    meta: {
      resourceType: 'User',
      created: row.created,
      lastModified: row.lastModified,
      location: `${baseUrl}/Users/${row.rowKey}`,
    },
  }
  if (row.externalId) user.externalId = row.externalId
  if (row.displayName) user.displayName = row.displayName
  if (row.givenName || row.familyName) {
    user.name = {
      ...(row.givenName ? { givenName: row.givenName } : {}),
      ...(row.familyName ? { familyName: row.familyName } : {}),
    }
  }
  if (row.email) user.emails = [{ value: row.email, type: 'work', primary: true }]
  return user
}

function toRow(user: ScimUser): UserRow {
  return {
    partitionKey: PARTITION,
    rowKey: user.id,
    userName: user.userName,
    externalId: user.externalId ?? '',
    displayName: user.displayName ?? '',
    givenName: user.name?.givenName ?? '',
    familyName: user.name?.familyName ?? '',
    email: user.emails?.[0]?.value ?? '',
    active: user.active,
    created: user.meta.created,
    lastModified: user.meta.lastModified,
  }
}

export async function createUser(
  input: Partial<ScimUser> & { userName: string },
  baseUrl: string,
): Promise<ScimUser> {
  const t = table()
  await ensureTable(t)
  const now = new Date().toISOString()
  const user: ScimUser = {
    schemas: [SCHEMA_USER],
    id: randomUUID(),
    userName: input.userName,
    externalId: input.externalId,
    displayName: input.displayName,
    name: input.name,
    emails: input.emails,
    // RFC 7643 §4.1.1 says active defaults to true when absent. Entra sends it
    // explicitly on create, but Okta and others may not.
    active: input.active ?? true,
    meta: { resourceType: 'User', created: now, lastModified: now, location: '' },
  }
  user.meta.location = `${baseUrl}/Users/${user.id}`
  await t.createEntity(toRow(user))
  return user
}

export async function getUser(id: string, baseUrl: string): Promise<ScimUser | null> {
  const t = table()
  await ensureTable(t)
  try {
    const row = (await t.getEntity(PARTITION, id)) as unknown as UserRow
    return toScim(row, baseUrl)
  } catch (err: any) {
    if (err?.statusCode === 404) return null
    throw err
  }
}

/**
 * Entra's match step, and the single hottest path in the whole endpoint. It runs
 * `GET /Users?filter=userName eq "..."` before every create to decide whether it
 * is creating or updating. A userName lookup that scanned the partition would
 * still be correct here and would stop being correct the moment this held more
 * than a demo's worth of rows, so it filters server-side.
 */
export async function findByUserName(userName: string, baseUrl: string): Promise<ScimUser | null> {
  const t = table()
  await ensureTable(t)
  const iterator = t.listEntities<UserRow>({
    queryOptions: { filter: odata`PartitionKey eq ${PARTITION} and userName eq ${userName}` },
  })
  for await (const row of iterator) return toScim(row, baseUrl)
  return null
}

export async function listUsers(
  startIndex: number,
  count: number,
  baseUrl: string,
): Promise<{ resources: ScimUser[]; total: number }> {
  const t = table()
  await ensureTable(t)
  const all: ScimUser[] = []
  const iterator = t.listEntities<UserRow>({
    queryOptions: { filter: odata`PartitionKey eq ${PARTITION}` },
  })
  for await (const row of iterator) all.push(toScim(row, baseUrl))
  // Sort so paging is stable. Table Storage returns rows in rowKey order within
  // a partition, but the rowKey is a random UUID, so "stable" is the only
  // property that matters and creation order is the one a reader expects.
  all.sort((a, b) => a.meta.created.localeCompare(b.meta.created))
  // startIndex is 1-INDEXED per RFC 7644 §3.4.2.4.
  const from = Math.max(0, startIndex - 1)
  return { resources: all.slice(from, from + count), total: all.length }
}

export async function replaceUser(user: ScimUser): Promise<ScimUser> {
  const t = table()
  await ensureTable(t)
  const updated: ScimUser = {
    ...user,
    meta: { ...user.meta, lastModified: new Date().toISOString() },
  }
  await t.updateEntity(toRow(updated) as any, 'Replace')
  return updated
}

/**
 * Which rows are old enough to delete. Pure, and separated from the storage loop
 * for exactly one reason: this function decides what gets destroyed, and a
 * decision like that should be testable without an Azure account.
 *
 * A row whose `created` will not parse is NEVER selected. That is the same
 * direction scripts/Remove-ExpiredDemoAccounts.ps1 fails in and for the same
 * argument: a row that cannot be aged is a row we do not understand, and leaking
 * one beats deleting one we were wrong about. The failure shows up as a growing
 * table, which is visible; the opposite shows up as data that used to be there.
 */
export function selectExpired(
  rows: ReadonlyArray<{ rowKey: string; created: string }>,
  cutoffMs: number,
): string[] {
  const doomed: string[] = []
  for (const row of rows) {
    const created = Date.parse(row.created ?? '')
    if (Number.isNaN(created)) continue
    if (created < cutoffMs) doomed.push(row.rowKey)
  }
  return doomed
}

export interface ExpiryResult {
  scanned: number
  expired: number
  deleted: number
  aborted: boolean
}

/**
 * Deletes rows older than the TTL. The downstream app expiring its own copy.
 *
 * ── WHY THIS EXISTS AT ALL ───────────────────────────────────────────────────
 *
 * The site promises every demo account self-destructs. Until this, that promise
 * covered only the DIRECTORY object: the PowerShell sweep deletes the user in
 * the workforce tenant and knows nothing about Table Storage, so the SCIM row it
 * was provisioned into lived forever. Rows would have accumulated indefinitely,
 * and the first orphan appeared within an hour of the endpoint going live.
 *
 * Two independent systems each expiring their own copy is also the honest shape.
 * The alternative — having terminate reach into the store and tidy up — would
 * make the demo a puppet show, since the entire point is that the downstream app
 * finds out the way any SaaS app finds out.
 *
 * ── THE TTL IS DELIBERATELY LONGER THAN THE DIRECTORY'S ──────────────────────
 *
 * The directory sweep uses a 24-hour TTL and runs hourly, so an account goes
 * between 24 and 30 hours after creation. This defaults to 36. A downstream copy
 * that outlives its upstream object is what actually happens in production, and
 * the reverse — a row vanishing while the user still exists — would show a
 * visitor a lie about their own hire.
 *
 * ── THE CEILING IS THE SAME ARGUMENT THE POWERSHELL SWEEP MAKES ──────────────
 *
 * Abort rather than truncate. A run that finds more expired rows than it expects
 * has probably misunderstood something, and deleting the first N of a set you do
 * not understand is how a bug becomes data loss. Loud beats tidy.
 */
export async function expireUsers(
  olderThanHours: number,
  ceiling: number,
): Promise<ExpiryResult> {
  const t = table()
  await ensureTable(t)
  const cutoff = Date.now() - olderThanHours * 3600_000

  const rows: Array<{ rowKey: string; created: string }> = []
  const iterator = t.listEntities<UserRow>({
    queryOptions: { filter: odata`PartitionKey eq ${PARTITION}` },
  })
  for await (const row of iterator) rows.push({ rowKey: row.rowKey, created: row.created })

  const scanned = rows.length
  const doomed = selectExpired(rows, cutoff)

  if (doomed.length > ceiling) {
    return { scanned, expired: doomed.length, deleted: 0, aborted: true }
  }

  let deleted = 0
  for (const id of doomed) {
    if (await deleteUser(id)) deleted++
  }
  return { scanned, expired: doomed.length, deleted, aborted: false }
}

export async function deleteUser(id: string): Promise<boolean> {
  const t = table()
  await ensureTable(t)
  try {
    await t.deleteEntity(PARTITION, id)
    return true
  } catch (err: any) {
    if (err?.statusCode === 404) return false
    throw err
  }
}
