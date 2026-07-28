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
 *   1. RATE LIMIT, hard. Five per hour per IP. Every call writes to a real
 *      tenant, and unlike the SCIM endpoint there is no bearer token upstream of
 *      it — the caller is the public internet.
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

// Deliberately mean. A visitor needs one or two goes to see the demo, not fifty.
const LIMIT = 5
const WINDOW_SECONDS = 3600

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
  try {
    const push = await provisionNow(result.employee.id)
    provisioned = push !== null && push.status >= 200 && push.status < 300
    if (push && !provisioned) {
      context.warn(`provisionOnDemand returned ${push.status}; the scheduled cycle will catch it`)
    }
  } catch (err) {
    context.warn('provisionOnDemand threw; the scheduled cycle will catch it', err)
  }

  context.log(`hired ${result.employee.id} provisioned=${provisioned}`)
  return {
    status: 201,
    jsonBody: {
      // The UPN is a directory object this site just created on purpose and is
      // about to show in its own feed, not a visitor's personal data.
      employee: result.employee,
      provisionedOnDemand: provisioned,
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
  if (result.status !== 204) {
    context.error(`terminate failed: graph ${result.status}`)
    return { status: 502, jsonBody: { error: 'could not terminate, see function logs' } }
  }

  context.log(`terminated ${id}`)
  // Deprovisioning is Entra's job now, and it happens on its own cycle. Saying
  // so is the honest version; pretending it is instant would be the demo lying
  // about the thing it exists to show.
  return { status: 200, jsonBody: { terminated: id, deprovisioningIsAsync: true } }
}

app.http('scim-hire', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'scim-demo/hire',
  handler: withRateLimit(hire, { limit: LIMIT, windowSeconds: WINDOW_SECONDS }),
})

app.http('scim-terminate', {
  methods: ['POST'],
  authLevel: 'anonymous',
  route: 'scim-demo/terminate/{id}',
  handler: withRateLimit(terminate, { limit: LIMIT, windowSeconds: WINDOW_SECONDS }),
})
