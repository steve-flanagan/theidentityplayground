import { describe, expect, it } from 'vitest'
import { applyPatch, coerceBoolean, normalisePath } from './patch'
import { SCHEMA_USER, type ScimUser } from './types'

/**
 * These tests exist because of one specific failure mode.
 *
 * Microsoft Entra's provisioning service disables a user by sending
 * `{"op":"Replace","path":"active","value":"False"}` — the string "False", not
 * the boolean. In JavaScript, `Boolean("False")` is `true`. A naive
 * implementation therefore ENABLES every account it was asked to disable, and
 * does so while returning 200 to a client that will report the cycle as
 * successful.
 *
 * That is a security bug that looks like a working integration from both ends.
 * It is the reason api/ has a test runner at all.
 */

const base: ScimUser = {
  schemas: [SCHEMA_USER],
  id: '11111111-1111-1111-1111-111111111111',
  userName: 'demo@example.com',
  displayName: 'Demo Person',
  active: true,
  meta: {
    resourceType: 'User',
    created: '2026-07-28T00:00:00.000Z',
    lastModified: '2026-07-28T00:00:00.000Z',
    location: 'https://example.test/api/scim/Users/11111111-1111-1111-1111-111111111111',
  },
}

const patchOp = (operations: unknown[]) => ({
  schemas: ['urn:ietf:params:scim:api:messages:2.0:PatchOp'],
  Operations: operations,
})

describe('coerceBoolean', () => {
  it('reads the string "False" as false, not as a truthy string', () => {
    expect(coerceBoolean('False')).toBe(false)
  })

  it('accepts every casing both vendors send', () => {
    for (const v of ['False', 'false', 'FALSE']) expect(coerceBoolean(v)).toBe(false)
    for (const v of ['True', 'true', 'TRUE']) expect(coerceBoolean(v)).toBe(true)
  })

  it('passes real booleans through', () => {
    expect(coerceBoolean(true)).toBe(true)
    expect(coerceBoolean(false)).toBe(false)
  })

  it('returns undefined for anything else rather than guessing', () => {
    for (const v of ['yes', '', '0', 1, null, undefined, {}]) {
      expect(coerceBoolean(v)).toBeUndefined()
    }
  })
})

describe('applyPatch — Entra without the compliance flag', () => {
  it('disables a user sent as capitalised op and stringified false', () => {
    const out = applyPatch(base, patchOp([{ op: 'Replace', path: 'active', value: 'False' }]))
    expect(out.user.active).toBe(false)
    expect(out.applied).toContain('active')
  })

  it('re-enables a user sent the same way', () => {
    const disabled = { ...base, active: false }
    const out = applyPatch(disabled, patchOp([{ op: 'Replace', path: 'active', value: 'True' }]))
    expect(out.user.active).toBe(true)
  })

  it('handles one operation per attribute, which is the unflagged shape', () => {
    const out = applyPatch(
      base,
      patchOp([
        { op: 'Replace', path: 'displayName', value: 'Pvlo' },
        { op: 'Replace', path: 'name.givenName', value: 'Gtfd' },
        { op: 'Replace', path: 'name.familyName', value: 'Pkqf' },
        { op: 'Replace', path: 'externalId', value: 'Eqpj' },
        { op: 'Replace', path: 'emails[type eq "work"].value', value: 'a@test.example' },
      ]),
    )
    expect(out.user.displayName).toBe('Pvlo')
    expect(out.user.name).toEqual({ givenName: 'Gtfd', familyName: 'Pkqf' })
    expect(out.user.externalId).toBe('Eqpj')
    expect(out.user.emails?.[0]?.value).toBe('a@test.example')
  })

  it('accepts capitalised Add', () => {
    const out = applyPatch(base, patchOp([{ op: 'Add', path: 'displayName', value: 'Babs' }]))
    expect(out.user.displayName).toBe('Babs')
  })
})

describe('applyPatch — the compliant shape, which is what Okta sends', () => {
  it('disables with a real boolean and a lowercase op', () => {
    const out = applyPatch(base, patchOp([{ op: 'replace', path: 'active', value: false }]))
    expect(out.user.active).toBe(false)
  })

  it('handles the no-path multi-attribute form with dotted keys', () => {
    const out = applyPatch(
      base,
      patchOp([
        {
          op: 'replace',
          value: {
            displayName: 'Bjfe',
            'name.givenName': 'Kkom',
            'name.familyName': 'Unua',
          },
        },
      ]),
    )
    expect(out.user.displayName).toBe('Bjfe')
    expect(out.user.name).toEqual({ givenName: 'Kkom', familyName: 'Unua' })
  })

  it('strips the enterprise extension URN off a key it does not store', () => {
    const out = applyPatch(
      base,
      patchOp([
        {
          op: 'replace',
          value: {
            'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:employeeNumber': 'Aklq',
          },
        },
      ]),
    )
    // Not stored, so ignored — but ignored under its BARE name, which is how a
    // reader of the log can tell an unmapped attribute from a mangled path.
    expect(out.ignored).toContain('employeeNumber')
    expect(out.applied).toHaveLength(0)
  })
})

describe('applyPatch — robustness', () => {
  it('ignores an unknown attribute instead of failing the whole cycle', () => {
    const out = applyPatch(base, patchOp([{ op: 'replace', path: 'nickName', value: 'Babs' }]))
    expect(out.ignored).toContain('nickName')
    expect(out.user.displayName).toBe('Demo Person')
  })

  it('ignores a value that is neither boolean nor a boolean string for active', () => {
    const out = applyPatch(base, patchOp([{ op: 'Replace', path: 'active', value: 'maybe' }]))
    expect(out.user.active).toBe(true) // unchanged, not coerced
    expect(out.ignored).toContain('active')
  })

  it('survives a remove op and a malformed body without throwing', () => {
    expect(() => applyPatch(base, patchOp([{ op: 'Remove', path: 'members' }]))).not.toThrow()
    expect(applyPatch(base, null).user).toEqual(base)
    expect(applyPatch(base, { Operations: 'nope' }).user).toEqual(base)
  })

  it('does not mutate the user it was given', () => {
    const before = JSON.stringify(base)
    applyPatch(base, patchOp([{ op: 'Replace', path: 'active', value: 'False' }]))
    expect(JSON.stringify(base)).toBe(before)
  })
})

describe('normalisePath', () => {
  it('drops filter segments and keeps the trailing attribute', () => {
    expect(normalisePath('emails[type eq "work"].value')).toBe('emails.value')
    expect(normalisePath('members[value eq "abc"]')).toBe('members')
  })

  it('leaves plain and dotted paths alone', () => {
    expect(normalisePath('active')).toBe('active')
    expect(normalisePath('name.givenName')).toBe('name.givenName')
  })
})
