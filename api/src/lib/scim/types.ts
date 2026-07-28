/**
 * SCIM 2.0 resource shapes and the error envelope, per RFC 7643 and RFC 7644.
 *
 * Written to the RFC, not to what Microsoft Entra happens to send. That is
 * deliberate and it is the whole reason this endpoint also works with Okta:
 * a SCIM endpoint that encodes one client's quirks as its contract is a
 * connector for that client, not a SCIM endpoint. Entra's deviations are
 * absorbed at the edges (see patch.ts), never in these types.
 */

export const SCHEMA_USER = 'urn:ietf:params:scim:schemas:core:2.0:User'
export const SCHEMA_ENTERPRISE_USER = 'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User'
export const SCHEMA_LIST_RESPONSE = 'urn:ietf:params:scim:api:messages:2.0:ListResponse'
export const SCHEMA_PATCH_OP = 'urn:ietf:params:scim:api:messages:2.0:PatchOp'
export const SCHEMA_ERROR = 'urn:ietf:params:scim:api:messages:2.0:Error'

export interface ScimName {
  givenName?: string
  familyName?: string
  formatted?: string
}

export interface ScimEmail {
  value: string
  type?: string
  primary?: boolean
}

export interface ScimMeta {
  resourceType: 'User'
  created: string
  lastModified: string
  location: string
}

export interface ScimUser {
  schemas: string[]
  id: string
  externalId?: string
  userName: string
  displayName?: string
  name?: ScimName
  emails?: ScimEmail[]
  /**
   * Never optional in what we STORE, even though the RFC allows it to be
   * absent. Entra's whole deprovisioning story is `active: false`, and a user
   * whose active state is undefined is a user whose disabled state is a guess.
   */
  active: boolean
  meta: ScimMeta
}

export interface ScimListResponse {
  schemas: string[]
  totalResults: number
  itemsPerPage: number
  /** 1-INDEXED, per RFC 7644 §3.4.2.4. Not zero. Getting this wrong silently
   *  reprovisions or skips the first user of every page. */
  startIndex: number
  Resources: ScimUser[]
}

export interface ScimError {
  schemas: string[]
  status: string
  scimType?: string
  detail?: string
}

/**
 * RFC 7644 §3.12: `status` is a STRING in the body even though it mirrors the
 * HTTP status code. Clients that parse it strictly reject a number.
 */
export function scimError(status: number, detail: string, scimType?: string) {
  const body: ScimError = {
    schemas: [SCHEMA_ERROR],
    status: String(status),
    ...(scimType ? { scimType } : {}),
    detail,
  }
  return {
    status,
    headers: { 'content-type': 'application/scim+json' },
    jsonBody: body,
  }
}

export function scimResponse(status: number, body: unknown, location?: string) {
  return {
    status,
    headers: {
      'content-type': 'application/scim+json',
      ...(location ? { location } : {}),
    },
    jsonBody: body,
  }
}
