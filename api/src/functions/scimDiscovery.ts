import { app, type HttpRequest, type HttpResponseInit } from '@azure/functions'
import { isAuthorised } from '../lib/scim/auth'
import { SCHEMA_USER, scimResponse } from '../lib/scim/types'

/**
 * SCIM discovery endpoints: /Schemas, /ServiceProviderConfig, /ResourceTypes.
 *
 * /Schemas is MANDATORY. Microsoft lists "Support the /Schemas endpoint" in the
 * must-support table [M] use-scim-to-provision-users-and-groups, ms.date
 * 2025-10-06, updated 2026-07-24. It is easy to read as optional discovery
 * sugar — it is not, and an earlier estimate on this project called it
 * "cheap-but-optional" and was wrong.
 *
 * /ServiceProviderConfig and /ResourceTypes are described on that page but are
 * absent from the must-support table, so they are optional. They are here anyway
 * because they cost a static object each and they are how a client discovers
 * that this endpoint does NOT do filtering beyond eq, does not do sorting, and
 * does not do bulk. Announcing a limitation is better than a client discovering
 * it as a 400 mid-cycle.
 */

function unauthorised(): HttpResponseInit {
  return {
    status: 401,
    headers: { 'www-authenticate': 'Bearer', 'content-type': 'application/scim+json' },
    jsonBody: { schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'], status: '401' },
  }
}

// Only the attributes this endpoint genuinely stores. A schema that advertises
// fields the store drops is a lie a client will map against.
const USER_SCHEMA = {
  id: SCHEMA_USER,
  name: 'User',
  description: 'SCIM core user',
  attributes: [
    { name: 'userName', type: 'string', multiValued: false, required: true, uniqueness: 'server', mutability: 'readWrite', returned: 'default', caseExact: false },
    { name: 'externalId', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', caseExact: false },
    { name: 'displayName', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', caseExact: false },
    {
      name: 'name', type: 'complex', multiValued: false, required: false, mutability: 'readWrite', returned: 'default',
      subAttributes: [
        { name: 'givenName', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', caseExact: false },
        { name: 'familyName', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', caseExact: false },
        { name: 'formatted', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', caseExact: false },
      ],
    },
    {
      name: 'emails', type: 'complex', multiValued: true, required: false, mutability: 'readWrite', returned: 'default',
      subAttributes: [
        { name: 'value', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', caseExact: false },
        { name: 'type', type: 'string', multiValued: false, required: false, mutability: 'readWrite', returned: 'default', caseExact: false },
        { name: 'primary', type: 'boolean', multiValued: false, required: false, mutability: 'readWrite', returned: 'default' },
      ],
    },
    { name: 'active', type: 'boolean', multiValued: false, required: false, mutability: 'readWrite', returned: 'default' },
  ],
  meta: { resourceType: 'Schema', location: `/scim/Schemas/${SCHEMA_USER}` },
}

const SERVICE_PROVIDER_CONFIG = {
  schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
  documentationUri: 'https://theidentityplayground.com',
  patch: { supported: true },
  bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
  // Announced honestly: parseFilter in scimUsers.ts handles `eq` on userName and
  // externalId and nothing else.
  filter: { supported: true, maxResults: 1000 },
  changePassword: { supported: false },
  sort: { supported: false },
  etag: { supported: false },
  authenticationSchemes: [
    {
      type: 'oauthbearertoken',
      name: 'OAuth Bearer Token',
      description: 'Authentication via the OAuth Bearer Token Standard',
      specUri: 'https://www.rfc-editor.org/rfc/rfc6750',
      primary: true,
    },
  ],
  meta: { resourceType: 'ServiceProviderConfig', location: '/scim/ServiceProviderConfig' },
}

const RESOURCE_TYPES = [
  {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
    id: 'User',
    name: 'User',
    endpoint: '/Users',
    description: 'SCIM core user',
    schema: SCHEMA_USER,
    meta: { resourceType: 'ResourceType', location: '/scim/ResourceTypes/User' },
  },
]

function listOf(resources: unknown[]) {
  return {
    schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
    totalResults: resources.length,
    itemsPerPage: resources.length,
    startIndex: 1,
    Resources: resources,
  }
}

app.http('scim-schemas', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'scim/Schemas',
  handler: async (request: HttpRequest): Promise<HttpResponseInit> =>
    (await isAuthorised(request)) ? scimResponse(200, listOf([USER_SCHEMA])) : unauthorised(),
})

app.http('scim-service-provider-config', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'scim/ServiceProviderConfig',
  handler: async (request: HttpRequest): Promise<HttpResponseInit> =>
    (await isAuthorised(request)) ? scimResponse(200, SERVICE_PROVIDER_CONFIG) : unauthorised(),
})

app.http('scim-resource-types', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'scim/ResourceTypes',
  handler: async (request: HttpRequest): Promise<HttpResponseInit> =>
    (await isAuthorised(request)) ? scimResponse(200, listOf(RESOURCE_TYPES)) : unauthorised(),
})
