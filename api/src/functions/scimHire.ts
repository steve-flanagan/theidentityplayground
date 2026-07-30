import { app, type HttpRequest, type HttpResponseInit, type InvocationContext } from '@azure/functions'
import { withRateLimit } from '../lib/rateLimit'
import { hireEmployee, provisionNow, terminateEmployee } from '../lib/scim/hire'

/**
 * The visitor-facing half of Module 5. Two buttons: hire someone, then let them
 * go, and watch both land in a downstream app through real Entra provisioning.
 *
 * ── THIS ENDPOINT CREATES REAL DIRECTORY OBJECTS FROM AN ANONYMOUS REQUEST ────
 *
 * That is the whole demo and it is also the most dangerous surface on the site,
 * so the controls are stated here rather than left to be inferred:
 *
 *   1. RATE LIMIT, per IP, and hire is tighter than terminate. Every hire
 *      writes to a real tenant, and unlike the SCIM endpoint there is no bearer
 *      token upstream of it: the caller is the public internet. See the limits
 *      below for why the two are not the same number.
 *   2. THE SWEEP. Every hire carries employeeType 'scim-demo', so the workforce
 *      cleanup deletes it within 24-30 hours whatever happens here. That is the
 *      backstop that makes an anonymous create acceptable at all.
 *   3. THE CEILING. The sweep aborts rather than truncating when it finds more
 *      candidates than its limit, so a flood is loud rather than quietly
 *      absorbed.
 *   4. NO CALLER INPUT REACHES THE DIRECTORY. Names come from a fixed list in
 *      hire.ts. The only thing the caller supplies on terminate is an object id,
 *      and that is checked against a hire this endpoint actually made.
 *
 * Terminate takes an id, and an id from a request is exactly how delete-me
 * becomes delete-anyone. It is constrained below.
 */

/**
 * ── TWO BUDGETS, NOT ONE, AND THEY ARE NOT THE SAME SIZE ─────────────────────
 *
 * These shared one allowance of 5/hour and it was wrong twice over.
 *
 * A hire-then-terminate cycle costs TWO, so a visitor could not complete three
 * cycles before being cut off. Found the way these things are always found: an
 * automated test run and Steve's own browser share an egress IP, and the demo
 * locked its author out.
 *
 * WHICH IS THE SMALLER HALF OF THE PROBLEM. This site is aimed at enterprise
 * identity people, and an office egresses from one address. Under a per-IP limit,
 * the first person at a company to try the demo spends the budget for everyone
 * behind that NAT. A limit tuned for one abusive visitor punishes exactly the
 * audience the module was built for.
 *
 * So: hire is raised, and terminate is loosened much further, because the two
 * directions are not equally risky. Creating writes a real directory object.
 * Deleting removes one, is bounded by what already exists, and cannot touch
 * anything that is not a scim-demo hire (terminateEmployee reads employeeType
 * before it deletes). Throttling cleanup as hard as creation is backwards.
 *
 * The real backstops are unchanged and they are not this limiter: every hire
 * self-destructs within 30 hours, and the sweep aborts rather than truncating if
 * it ever finds more than it expects.
 */
const HIRE_LIMIT = 20
const HIRE_WINDOW_SECONDS = 3600

const TERMINATE_LIMIT = 60
const TERMINATE_WINDOW_SECONDS = 3600

async function hire(_request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> {
  const result = await hireEmployee()

  if (!result.ok || !result.employee) {
    context.error(`hire failed: graph ${result.status} ${result.error}`)
    // 403 almost certainly means the writer app registration is not consented in
    // the workforce tenant. Said plainly in the log; never echoed to the caller,
    // because Graph error bodies name tenants, apps and object ids.
    return { status: 502, jsonBody: { error: 'could not hire, see function logs' } }
  }

  // Fire the on-demand cycle, but never let its failure undo a successful hire.
  // The scheduled cycle picks the user up within forty minutes regardless; only
  // the immediacy is lost, and immediacy is not worth deleting a real object for.
  let provisioned = false
  /**
   * The push's own outcome, returned to the caller.
   *
   * It was a bare boolean and that was a mistake worth naming: when the first
   * live run came back false, there was nothing to go on. This app has no
   * Application Insights, so "check the logs" is not a two-minute operation, and
   * two hires were burned guessing. A status code and Graph's error code are not
   * sensitive — they are the same things Graph would tell any caller holding the
   * token — and the front end wants them anyway to say WHY a push did not land.
   */
  let pushStatus: number | null = null
  let pushError: string | null = null

  try {
    const push = await provisionNow(result.employee.id)
    if (push === null) {
      pushError = 'not configured'
    } else {
      pushStatus = push.status
      provisioned = push.status >= 200 && push.status < 300
      if (!provisioned) {
        pushError = (push.body as any)?.error?.code ?? 'unknown'
        context.warn(
          `provisionOnDemand returned ${push.status} ${pushError}: ${JSON.stringify(push.body)}`,
        )
      }
    }
  } catch (err: any) {
    pushError = err?.message ?? 'threw'
    context.warn('provisionOnDemand threw; the scheduled cycle will catch it', err)
  }

  context.log(`hired ${result.employee.id} provisioned=${provisioned} status=${pushStatus}`)
  return {
    status: 201,
    jsonBody: {
      // The UPN is a directory object this site just created on purpose and is
      // about to show in its own feed, not a visitor's personal data.
      employee: result.employee,
      provisionedOnDemand: provisioned,
      provisionStatus: pushStatus,
      provisionError: pushError,
      // Said out loud so the page can say it out loud. The self-destruct is a
      // feature of the demo, not a footnote.
      selfDestructsWithinHours: 30,
    },
  }
}

async function terminate(
  request: HttpRequest,
  context: InvocationContext,
): Promise<HttpResponseInit> {
  const id = request.params.id ?? ''

  /**
   * An object id off the URL, used to delete a user, is the shape of
   * delete-anyone. Two things keep it honest:
   *
   *   - The id must be a uuid. A path segment that is not one never reaches
   *     Graph.
   *   - The WRITER app registration holds User.ReadWrite.All in the workforce
   *     tenant ONLY, and is not provisioned into External ID at all. So the
   *     worst a crafted id can do is delete an object in the throwaway demo
   *     workforce tenant.
   *
   *   - terminateEmployee() READS THE OBJECT FIRST and refuses anything whose
   *     employeeType is not 'scim-demo'. A uuid-shaped path segment is a format
   *     check, not an authorisation check; that read is the authorisation check.
   *     Without it this is an unauthenticated delete-any-user-in-the-tenant
   *     bounded only by a rate limit, and it would happily take Steve's demo
   *     Member.
   */
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return { status: 400, jsonBody: { error: 'not an object id' } }
  }

  const result = await terminateEmployee(id)
  if (result.delete.status !== 204) {
    context.error(`terminate failed: graph ${result.delete.status}`)
    return { status: 502, jsonBody: { error: 'could not terminate, see function logs' } }
  }

  /**
   * The push's outcome comes back with the answer.
   *
   * This used to report a bare success, and it lied twice: terminate returned 200
   * while the SCIM row it was meant to deactivate was never touched, and there was
   * nothing in the response to say so. The hire path had already been fixed for
   * precisely this and the same mistake was left standing here.
   *
   * A 200 with deprovisioned:false is the honest answer to "I deleted the user
   * but the downstream app has not heard about it yet", which is a real state a
   * provisioning demo should be able to show rather than paper over.
   */
  const pushStatus = result.push?.status ?? null
  const deprovisioned = pushStatus !== null && pushStatus >= 200 && pushStatus < 300

  /**
   * ALWAYS log the push body, not only on failure.
   *
   * A 200 from provisionOnDemand means "I evaluated this user", not "I sent
   * something". Observed 29 July: a 200 that transmitted nothing, twice, for two
   * different reasons. The body is a key/value description of what the engine
   * actually did, and throwing it away on the success path is how both of those
   * were missed. It is the only place the difference is written down.
   */
  context.log(
    `terminate ${id}: push status=${pushStatus} body=${JSON.stringify(result.push?.body ?? null)}`,
  )

  context.log(`terminated ${id} deprovisioned=${deprovisioned}`)
  return {
    status: 200,
    jsonBody: {
      terminated: id,
      deprovisioned,
      deprovisionStatus: pushStatus,
      deprovisionError: deprovisioned
        ? null
        : ((result.push?.body as any)?.error?.code ?? 'no push attempted'),
      // Returned so the next diagnosis does not need a log dive. It is Entra's
      // own account of what it did, and it is the difference between a 200 that
      // sent a PATCH and a 200 that decided nothing had changed.
      deprovisionDetail: result.push?.body ?? null,
    },
  }
}

app.http('scim-hire', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'scim-demo/hire',
  handler: withRateLimit(hire, { limit: HIRE_LIMIT, windowSeconds: HIRE_WINDOW_SECONDS }),
})

app.http('scim-terminate', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'scim-demo/terminate/{id}',
  handler: withRateLimit(terminate, { limit: TERMINATE_LIMIT, windowSeconds: TERMINATE_WINDOW_SECONDS }),
})
