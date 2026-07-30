import { randomBytes, randomUUID } from 'node:crypto'
import { graphRequest, type GraphResult } from '../graphToken'

/**
 * The joiner and leaver half of Module 5: create a demo employee in the workforce
 * tenant, then push it to the SCIM endpoint immediately rather than waiting out a
 * sync cycle.
 *
 * The SCIM endpoint in this same app is the DOWNSTREAM app. So a hire travels:
 *
 *   here -> Graph creates a Member in the workforce tenant
 *        -> Graph provisionOnDemand runs the sync rule for just that user
 *        -> Entra calls POST /api/scim/Users, as any SaaS app would be called
 *        -> the row lands in Table Storage
 *
 * Nothing about the SCIM side is special-cased for this. Entra is a real client
 * of a real endpoint, which is the only reason the demo proves anything.
 *
 * ── THE STAMP IS NOT OPTIONAL ────────────────────────────────────────────────
 *
 * Every user created here MUST carry employeeType = 'scim-demo'. The workforce
 * cleanup sweep identifies hires by that marker paired with userType Member
 * (scripts/Remove-ExpiredDemoAccounts.ps1). A hire created without it is
 * invisible to the sweep and lives in the tenant forever, silently breaking the
 * promise the site makes to every visitor. The sweep deliberately fails toward a
 * leak rather than an over-delete, which means this file is the thing standing
 * between the demo and an accumulating directory.
 */

/** Must match $hireEmployeeType in scripts/Remove-ExpiredDemoAccounts.ps1. */
export const HIRE_EMPLOYEE_TYPE = 'scim-demo'

const WORKFORCE_DOMAIN = process.env.WORKFORCE_UPN_DOMAIN ?? ''
/** The enterprise app's service principal and its provisioning job, both in the
 *  workforce tenant. Identifiers, so they live in app settings. */
const SYNC_SP_ID = process.env.SCIM_SYNC_SP_ID ?? ''
const SYNC_JOB_ID = process.env.SCIM_SYNC_JOB_ID ?? ''
/** Optional. Names which synchronization rule to run; absent, Entra picks. */
const SYNC_RULE_ID = process.env.SCIM_SYNC_RULE_ID ?? ''

/**
 * The Graph calls an operation actually made, in order, for the page's ticker.
 *
 * ── WHY COLLECTED RATHER THAN WRITTEN OUT ON THE FRONT END ───────────────────
 *
 * The sequence is deterministic, so the page could hardcode it and nobody would
 * notice. That would be a lie of exactly the kind this module has spent three
 * rounds removing: a caption describing traffic nobody captured. If the
 * read-back loop runs four times, the ticker shows four reads. If terminate
 * refuses, the ticker stops where the code stopped.
 *
 * Method, path and status. No bodies: these go to a public page and a Graph body
 * names tenants, object ids and error detail.
 */
export type CallLog = string[]

function note(log: CallLog, method: string, path: string, status: number): void {
  // The query string is dropped except for $select, which is the interesting
  // part of the read-before-delete and is short enough to read going past.
  const shown = path.includes('$select') ? path : path.split('?')[0]
  log.push(`${method} ${shown} ${status}`)
}

export interface HiredEmployee {
  id: string
  displayName: string
  userPrincipalName: string
}

/**
 * A password nobody will ever use or see.
 *
 * Graph requires a passwordProfile to create a user. This account exists to be
 * provisioned and then deleted; no human signs in as it. So the password is
 * generated, sent once, and dropped on the floor — never returned to the caller,
 * never logged, never stored. A demo that handed a visitor working credentials to
 * a real directory object would be a very different kind of demo.
 *
 * 32 bytes of CSPRNG, base64, plus a fixed suffix so it always satisfies a
 * complexity policy regardless of what base64 happens to produce.
 */
function throwawayPassword(): string {
  return `${randomBytes(32).toString('base64')}aA1!`
}

/**
 * Display names come from a fixed list rather than from the request. A visitor
 * naming their own demo employee is a stored-XSS vector aimed at the provisioning
 * feed, and an abuse vector aimed at a real directory: whatever string is typed
 * here ends up as a displayName in Steve's tenant and in the sweep's logs.
 * The visitor picks nothing; the site hires "someone".
 */
const FIRST_NAMES = ['Avery', 'Jordan', 'Riley', 'Casey', 'Rowan', 'Quinn', 'Sasha', 'Devon']
const LAST_NAMES = ['Okafor', 'Lindqvist', 'Marchetti', 'Nakamura', 'Delacroix', 'Halvorsen']

function pick<T>(list: readonly T[]): T {
  // randomBytes rather than Math.random: not because this needs to be
  // unguessable, but because a demo that collides its names constantly looks
  // broken, and the cost of doing it properly is one syscall.
  return list[randomBytes(1)[0] % list.length]
}

export interface HireResult {
  ok: boolean
  employee?: HiredEmployee
  /** What Graph was actually asked, in order. */
  calls: CallLog
  /** Graph's status, kept because a 403 here names a missing consent and that is
   *  the single most likely thing to be wrong on first run. */
  status: number
  error?: string
}

export async function hireEmployee(): Promise<HireResult> {
  const calls: CallLog = []
  if (!WORKFORCE_DOMAIN)
    return { ok: false, status: 0, error: 'WORKFORCE_UPN_DOMAIN is not set', calls }

  const given = pick(FIRST_NAMES)
  const family = pick(LAST_NAMES)
  // The UPN carries a uuid, so two visitors hiring at the same moment cannot
  // collide, and so no hire is ever addressable by guessing.
  const mailNickname = `demo.${given.toLowerCase()}.${randomUUID().slice(0, 8)}`

  const created: GraphResult = await graphRequest(
    'POST',
    'workforce',
    '/users',
    {
      accountEnabled: true,
      displayName: `${given} ${family}`,
      mailNickname,
      userPrincipalName: `${mailNickname}@${WORKFORCE_DOMAIN}`,
      // THE STAMP. See the header. Without this the sweep cannot see the account.
      employeeType: HIRE_EMPLOYEE_TYPE,
      passwordProfile: {
        forceChangePasswordNextSignIn: true,
        password: throwawayPassword(),
      },
    },
    'writer',
  )

  note(calls, 'POST', '/users', created.status)

  if (created.status !== 201) {
    return {
      ok: false,
      status: created.status,
      error: (created.body as any)?.error?.code ?? 'user creation failed',
      calls,
    }
  }

  const body = created.body as { id: string; displayName: string; userPrincipalName: string }
  return {
    ok: true,
    status: 201,
    calls,
    employee: {
      id: body.id,
      displayName: body.displayName,
      userPrincipalName: body.userPrincipalName,
    },
  }
}

/**
 * Runs the provisioning rule for one user, now, instead of on the next cycle.
 *
 * [M] synchronization-synchronizationjob-provisionondemand, graph-rest-1.0,
 * ms.date 2024-04-04, updated 2026-07-03. App-only needs
 * Synchronization.ReadWrite.All (or Application.ReadWrite.OwnedBy, which is
 * broader in a direction we do not want). Returns 200 with a key/value pair
 * describing what happened.
 *
 * NOT fatal if it fails. The user exists and the scheduled cycle will provision
 * it within forty minutes; only the immediacy is lost. A demo that erased a real
 * directory object because a convenience call 500'd would be trading a correct
 * outcome for a tidy one.
 */
export async function provisionNow(objectId: string, log?: CallLog): Promise<GraphResult | null> {
  if (!SYNC_SP_ID || !SYNC_JOB_ID) return null
  const result = await graphRequest(
    'POST',
    'workforce',
    `/servicePrincipals/${SYNC_SP_ID}/synchronization/jobs/${SYNC_JOB_ID}/provisionOnDemand`,
    {
      parameters: [
        {
          subjects: [{ objectId, objectTypeName: 'User' }],
          ...(SYNC_RULE_ID ? { ruleId: SYNC_RULE_ID } : {}),
        },
      ],
    },
    'writer',
  )
  if (log) note(log, 'POST', '/synchronization/jobs/../provisionOnDemand', result.status)
  return result
}

/**
 * The leaver. Deletes the directory object, which is what makes Entra deprovision
 * the SCIM row on its next cycle — the same path a real termination takes.
 *
 * Deliberately NOT touching the SCIM store directly. Reaching into the downstream
 * app's database to tidy up would make the demo a puppet show: the whole point is
 * that the downstream app finds out the way any SaaS app finds out.
 *
 * ── READ BEFORE DELETE, AND THE READ IS THE SECURITY CONTROL ─────────────────
 *
 * The object id arrives from a public request. A uuid-shaped path segment is a
 * format check, not an authorisation check — it happily describes Steve's demo
 * Member, or any other object in the workforce tenant.
 *
 * So this refuses to delete anything it did not create. It reads employeeType
 * first and requires the same marker the hire flow stamps and the cleanup sweep
 * matches on. Three independent things now agree on that one string, which is
 * the point: an object without it is not ours, by definition, in all three
 * places.
 *
 * The extra Graph call is the cost. It is worth it — without it the endpoint is
 * an unauthenticated delete-any-user-in-the-tenant, bounded only by a rate limit.
 */
export interface TerminateResult {
  /** The final Graph call's outcome. 204 means the object is gone. */
  delete: GraphResult
  /** What Graph was actually asked, in order. */
  calls: CallLog
  /** The on-demand push, or null if it was never attempted. Reported so a
   *  terminate that "succeeded" while deactivating nothing is visible. */
  push?: GraphResult | null
}

export async function terminateEmployee(objectId: string): Promise<TerminateResult> {
  const calls: CallLog = []
  const lookup = await graphRequest(
    'GET',
    'workforce',
    `/users/${objectId}?$select=id,employeeType`,
    undefined,
    'writer',
  )

  note(calls, 'GET', '/users/{id}?$select=employeeType', lookup.status)
  if (lookup.status !== 200) return { delete: lookup, calls }

  if ((lookup.body as any)?.employeeType !== HIRE_EMPLOYEE_TYPE) {
    // 403 rather than 404: it exists, and we are refusing. Distinguishing the two
    // in the LOG matters for debugging; the handler above collapses both into one
    // opaque answer to the caller, so this leaks nothing outward.
    return {
      delete: {
        status: 403,
        body: { error: { code: 'notADemoHire', message: 'object is not a scim-demo hire' } },
      },
      calls,
    }
  }

  /**
   * ── DISABLE, PUSH, THEN DELETE — AND THE ORDER IS THE WHOLE POINT ──────────
   *
   * The first version deleted the directory object and stopped. That does not
   * work, and Steve caught it: on-demand provisioning names a SUBJECT, and a
   * deleted user cannot be one. Deprovisioning would only ever have happened on
   * the scheduled cycle, which is stopped, so the leaver half of the demo would
   * have silently done nothing at all.
   *
   * Disabling first fixes it and is more faithful anyway. SCIM deprovisioning IS
   * `active: false` — Microsoft's own must-support list requires soft-delete via
   * that flag with the user still returned on GET, and a hard DELETE is the
   * exception rather than the rule. So the row goes inactive where a visitor can
   * see it, which is also the more legible thing to watch: a row changing state
   * says more than a row vanishing.
   *
   * The directory object is deleted last, because by then it has served its
   * purpose and leaving it would lean on the sweep for something we can do now.
   */
  const disabled = await graphRequest(
    'PATCH',
    'workforce',
    `/users/${objectId}`,
    { accountEnabled: false },
    'writer',
  )
  note(calls, 'PATCH', '/users/{id} accountEnabled:false', disabled.status)
  if (disabled.status !== 204) return { delete: disabled, calls }

  /**
   * ── READ THE DISABLE BACK BEFORE PUSHING IT ──────────────────────────────
   *
   * Observed 29 July: a terminate issued seconds after the hire returned
   * `provisionOnDemand` 200 and changed nothing. The row's lastModified never
   * moved. A terminate driven through the page, with a few more seconds between
   * the two calls, worked.
   *
   * The provisioning engine compares mapped values and sends nothing when they
   * match. If it reads the user before the disable is visible to it, it computes
   * active:true, finds active:true already in the target, and reports success
   * having transmitted nothing. Same silent no-op as the IsSoftDeleted mapping
   * bug, arriving by a different road.
   *
   * Reading it back is not a proof — Graph may serve this from a replica the
   * provisioning engine does not read — but it is cheap, it is principled, and it
   * beats a magic sleep. If it never settles we push anyway and report what
   * happened rather than pretending.
   */
  for (let attempt = 0; attempt < 4; attempt++) {
    const check = await graphRequest(
      'GET',
      'workforce',
      `/users/${objectId}?$select=id,accountEnabled`,
      undefined,
      'writer',
    )
    note(calls, 'GET', '/users/{id}?$select=accountEnabled', check.status)
    if (check.status === 200 && (check.body as any)?.accountEnabled === false) break
    await new Promise((r) => setTimeout(r, 750))
  }

  /**
   * Push the disable downstream before the object stops existing.
   *
   * THE RESULT IS REPORTED, NOT SWALLOWED. This was `.catch(() => null)` and that
   * cost two rounds of diagnosis: terminate reported success while the row it was
   * meant to deactivate was never touched, and there was nothing to look at. The
   * hire path had already been fixed for exactly this and the same mistake was
   * left standing here.
   *
   * Still not fatal. The account is already disabled, the scheduled cycle would
   * catch it, and the sweep deletes the object regardless.
   */
  let push: GraphResult | null = null
  try {
    push = await provisionNow(objectId, calls)
  } catch (err: any) {
    push = { status: 0, body: { error: { code: err?.message ?? 'threw' } } }
  }

  const deleted = await graphRequest(
    'DELETE',
    'workforce',
    `/users/${objectId}`,
    undefined,
    'writer',
  )
  note(calls, 'DELETE', '/users/{id}', deleted.status)
  return { delete: deleted, push, calls }
}
