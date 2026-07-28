import { SCHEMA_ENTERPRISE_USER, type ScimUser } from './types'

/**
 * Applies a SCIM PATCH to a user, tolerating Microsoft Entra's documented
 * deviations from RFC 7644 alongside the compliant form.
 *
 * ── WHY THIS FILE IS NOT JUST JSON.parse AND A SWITCH ────────────────────────
 *
 * Microsoft publishes a page listing where its provisioning service does not
 * follow the SCIM spec. One row is still open, marked "Fixed? No":
 *
 *   "Update PATCH behavior to ensure compliance (such as active as boolean and
 *    proper group membership removals)"
 *
 * [M] application-provisioning-config-problem-scim-compatibility, ms.date
 * 2025-08-25, updated 2026-02-05, read 28 July 2026.
 *
 * Compliant behaviour exists only behind a tenant-URL flag, `aadOptscim062020`,
 * and the same page says that flag "currently doesn't work with on-demand
 * provisioning". On-demand provisioning is exactly what this project's demo
 * needs, because a visitor will not wait out a forty-minute sync cycle. So we
 * are choosing the non-compliant client behaviour deliberately, and the endpoint
 * has to meet it where it is.
 *
 * The three deviations that actually reach this function:
 *
 *   op         "Replace" / "Add" / "Remove" — capitalised. RFC says lowercase.
 *   active     "False" as a STRING. RFC and the flagged form send a boolean.
 *   multi-set  the flagged form sends ONE op with no `path` and an object of
 *              path->value pairs, using DOTTED keys ("name.givenName") and full
 *              URN keys for extension attributes. The unflagged form sends one
 *              op per attribute instead.
 *
 * Both forms are handled, so this endpoint works with the flag on or off — and,
 * because the compliant form is the RFC form, with any other SCIM client.
 * THAT IS THE POINT. Coding only to what Entra emits today would produce an
 * Entra connector wearing a SCIM endpoint's URL.
 */

interface RawOperation {
  op?: unknown
  path?: unknown
  value?: unknown
}

export interface PatchOutcome {
  user: ScimUser
  /** Paths we understood and applied. Useful for the site's event feed. */
  applied: string[]
  /** Paths we recognised as attributes we do not store. NOT an error: a client
   *  may map any attribute it likes, and rejecting the whole request because one
   *  of six attributes is unmapped fails the provisioning cycle for nothing. */
  ignored: string[]
}

/**
 * Entra sends `"False"`, the RFC sends `false`, and a naive Boolean() call turns
 * the string "False" into TRUE — which silently re-enables every user the client
 * asked us to disable. This is the single highest-consequence line in the file.
 */
export function coerceBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase()
    if (v === 'true') return true
    if (v === 'false') return false
  }
  return undefined
}

/**
 * Reduces a path to the attribute we key on. Handles three shapes:
 *   active
 *   name.givenName
 *   emails[type eq "work"].value
 * plus extension URNs, which are stripped to their trailing attribute name.
 *
 * The value filter inside brackets is intentionally NOT evaluated. This resource
 * carries one email, so `emails[type eq "work"].value` and `emails[primary eq
 * true].value` address the same field. Pretending to evaluate a filter we then
 * ignore would be worse than not implementing it.
 */
export function normalisePath(path: string): string {
  let p = path.trim()
  // Extension attributes arrive as a full URN with a colon before the name.
  if (p.startsWith(SCHEMA_ENTERPRISE_USER)) p = p.slice(SCHEMA_ENTERPRISE_USER.length + 1)
  // Drop any [ ... ] filter segment, keeping what follows it.
  p = p.replace(/\[[^\]]*\]/g, '')
  return p.replace(/^\.+|\.+$/g, '')
}

function assign(user: ScimUser, rawPath: string, value: unknown, out: PatchOutcome): void {
  const path = normalisePath(rawPath)
  const lower = path.toLowerCase()

  switch (lower) {
    case 'active': {
      const b = coerceBoolean(value)
      if (b === undefined) {
        out.ignored.push(path)
        return
      }
      user.active = b
      break
    }
    case 'username':
      user.userName = String(value)
      break
    case 'externalid':
      user.externalId = String(value)
      break
    case 'displayname':
      user.displayName = String(value)
      break
    case 'name.givenname':
      user.name = { ...user.name, givenName: String(value) }
      break
    case 'name.familyname':
      user.name = { ...user.name, familyName: String(value) }
      break
    case 'name.formatted':
      user.name = { ...user.name, formatted: String(value) }
      break
    case 'emails.value':
    case 'emails':
      // The unflagged form can send the whole array; the flagged form sends the
      // single value through a filter path that normalises to `emails.value`.
      if (Array.isArray(value)) {
        const first = value[0] as { value?: unknown } | undefined
        if (first?.value) user.emails = [{ value: String(first.value), type: 'work', primary: true }]
        else out.ignored.push(path)
      } else {
        user.emails = [{ value: String(value), type: 'work', primary: true }]
      }
      break
    default:
      out.ignored.push(path)
      return
  }
  out.applied.push(path)
}

export function applyPatch(user: ScimUser, body: unknown): PatchOutcome {
  const out: PatchOutcome = { user: { ...user }, applied: [], ignored: [] }
  const operations = (body as { Operations?: unknown })?.Operations
  if (!Array.isArray(operations)) return out

  for (const raw of operations as RawOperation[]) {
    // Case-insensitive: Entra capitalises these, the RFC does not.
    const op = typeof raw.op === 'string' ? raw.op.trim().toLowerCase() : ''
    const path = typeof raw.path === 'string' ? raw.path : undefined

    if (op === 'remove') {
      // Only `active` is meaningfully removable on a resource this shape; a
      // removed attribute otherwise just goes unset, and there is nothing here
      // that a client can usefully unset. Group membership removal is the other
      // documented deviation and is out of scope: Microsoft requires only one of
      // /Users or /Groups, and this endpoint implements /Users.
      if (path) out.ignored.push(normalisePath(path))
      continue
    }

    if (op !== 'replace' && op !== 'add') {
      if (path) out.ignored.push(normalisePath(path))
      continue
    }

    if (path) {
      assign(out.user, path, raw.value, out)
      continue
    }

    // No path: the flagged multi-attribute form, where `value` is an object of
    // path -> value. Keys are dotted, and extension attributes are full URNs.
    if (raw.value && typeof raw.value === 'object' && !Array.isArray(raw.value)) {
      for (const [key, val] of Object.entries(raw.value as Record<string, unknown>)) {
        assign(out.user, key, val, out)
      }
    }
  }

  return out
}
