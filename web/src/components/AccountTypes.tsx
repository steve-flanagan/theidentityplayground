import { useState, useRef, useLayoutEffect, useCallback } from 'react'
import { useIsAuthenticated } from '@azure/msal-react'

/*
 * Module 2: account types. Same person shown as three directory objects
 * (workforce member, B2B guest, External ID / CIAM customer), with the blast
 * radius each one could reach lit across two workforce tenants, their
 * subscriptions, and the CIAM app.
 *
 * The visual is lifted verbatim from the verified dev cut (web/src/module2.tsx,
 * an untracked localhost-only page). The triangle tenants, the key / app icons,
 * the exposure heat scale, the always-dashed RBAC keys, the blue dashed B2B
 * redemption links routed by measuring the real triangle positions, the person
 * marker in the home triangle, and the three-claim diff all carry over
 * unchanged. The design settled 21 July through rendered iteration
 * (notes/design.md section 6); it is not redesigned here.
 *
 * What the wiring adds is the picker default. A signed-in visitor leads with
 * their real account type (see AccountTypes below), read through the shared MSAL
 * instance, never a second one.
 *
 * The visitor-facing copy is PLACEHOLDER carried over from the dev cut, for
 * Steve to write. Em-dashes were removed; nothing else was polished.
 */

type Level = 'high' | 'medium' | 'possible' | 'low' | 'none'
type ScopeKey = 'A' | 'B' | 'ciam'
type ClaimKey = 'idp' | 'tid' | 'identifier' | 'email'

const SCOPES: { key: ScopeKey; tenant: string; top: string; kind: 'sub' | 'app' }[] = [
  { key: 'A', tenant: 'Workforce tenant A', top: 'Subscription A', kind: 'sub' },
  { key: 'B', tenant: 'Workforce tenant B', top: 'Subscription B', kind: 'sub' },
  { key: 'ciam', tenant: 'External ID (CIAM)', top: 'The app', kind: 'app' },
]

// The B2B redemption link. A deliberate flow, not an RBAC grant, so it is its own
// colour and not the amber of the keys.
const B2B_COLOR = '#60a5fa'

type Identity = {
  key: string
  label: string
  what: string
  summary: string
  home: ScopeKey
  exposure: Record<ScopeKey, { tenant: Level; top: Level }>
  claims: Record<ClaimKey, string>
}

const IDENTITIES: Identity[] = [
  {
    key: 'member',
    label: 'Workforce member',
    what: 'A workforce employee. The company’s own directory identity, native to one tenant.',
    summary:
      'Home is tenant B, where it can be a directory admin. Every subscription, even its home tenant’s, is a separate RBAC grant it may or may not hold, never automatic. It can also show up as a B2B guest in tenant A and in the CIAM tenant.',
    home: 'B',
    exposure: {
      A: { tenant: 'medium', top: 'possible' },
      B: { tenant: 'high', top: 'possible' },
      ciam: { tenant: 'medium', top: 'none' },
    },
    claims: {
      idp: '—  (native)',
      tid: 'workforce  9e1372b0',
      identifier: 'Member@…com  (UPN)',
      email: '—',
    },
  },
  {
    key: 'guest',
    label: 'B2B guest',
    what: 'A partner or contractor invited in from another org. An Entra tenant, a personal account, wherever.',
    summary:
      'Home is tenant A. As a B2B guest in tenant B it can reach tenant level, and even subscription level if granted the RBAC. No presence in the CIAM tenant.',
    home: 'A',
    exposure: {
      A: { tenant: 'high', top: 'possible' },
      B: { tenant: 'medium', top: 'possible' },
      ciam: { tenant: 'none', top: 'none' },
    },
    claims: {
      idp: 'sts.windows.net/9188040d…  (personal-account home)',
      tid: 'workforce  9e1372b0, same as the member',
      identifier: 'home email',
      email: 'home email',
    },
  },
  {
    key: 'customer',
    label: 'External ID customer',
    what: 'An end user of the app. Never in the company’s workforce directory at all.',
    summary:
      'The app only, and that is by design. A compromised customer can misuse the app as a customer and nothing more. No directory, no subscription, no workforce tenant.',
    home: 'ciam',
    exposure: {
      A: { tenant: 'none', top: 'none' },
      B: { tenant: 'none', top: 'none' },
      ciam: { tenant: 'none', top: 'low' },
    },
    claims: {
      idp: '—  local · google.com social',
      tid: 'External ID  7e8da8a9',
      identifier: 'their email · generated @…onmicrosoft.com',
      email: 'present',
    },
  },
]

// Signed in leads with this one today (see AccountTypes). Found by key so the
// array order stays free to change.
const CUSTOMER_IDENTITY = IDENTITIES.find((id) => id.key === 'customer')!

// Heat = blast radius if compromised. high = biggest attack surface (a trusted
// admin is the top target, not the villain); low = benign (a customer using the
// app as intended); possible = reachable only if the RBAC grant exists.
const HEAT: Record<Level, { color: string; solid: boolean; dashed: boolean; label: string }> = {
  high: { color: '#f87171', solid: true, dashed: false, label: 'High' },
  medium: { color: '#fbbf24', solid: true, dashed: false, label: 'Medium' },
  possible: { color: '#fbbf24', solid: false, dashed: true, label: 'Only if RBAC granted' },
  low: { color: '#4ade80', solid: true, dashed: false, label: 'Low' },
  none: { color: '#334155', solid: false, dashed: false, label: 'None' },
}

const CLAIM_LABEL: Record<ClaimKey, string> = {
  idp: 'idp',
  tid: 'tid',
  identifier: 'preferred_username',
  email: 'email',
}

function Triangle({ level, home }: { level: Level; home: boolean }) {
  const h = HEAT[level]
  return (
    <svg viewBox="0 0 100 90" width="120" height="106" aria-hidden="true">
      <polygon
        points="50,6 94,84 6,84"
        fill={h.solid ? h.color : 'none'}
        fillOpacity={h.solid ? 0.16 : 0}
        stroke={h.color}
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeDasharray={h.dashed ? '6 4' : undefined}
      />
      {home && (
        <g fill="#e2e8f0">
          <circle cx="50" cy="52" r="6.5" />
          <path d="M39 76 C39 65 44 61 50 61 C56 61 61 65 61 76 Z" />
        </g>
      )}
    </svg>
  )
}

function KeyIcon({ level }: { level: Level }) {
  const h = HEAT[level]
  const dash = h.dashed ? '5 3' : undefined
  return (
    <svg viewBox="0 0 100 40" width="60" height="24" aria-hidden="true">
      <circle cx="20" cy="20" r="12" fill="none" stroke={h.color} strokeWidth="4" strokeDasharray={dash} />
      <line x1="32" y1="20" x2="90" y2="20" stroke={h.color} strokeWidth="4" strokeDasharray={dash} />
      <line x1="74" y1="20" x2="74" y2="33" stroke={h.color} strokeWidth="4" />
      <line x1="86" y1="20" x2="86" y2="30" stroke={h.color} strokeWidth="4" />
    </svg>
  )
}

function AppIcon({ level }: { level: Level }) {
  const h = HEAT[level]
  return (
    <svg viewBox="0 0 60 50" width="52" height="42" aria-hidden="true">
      <rect
        x="6"
        y="6"
        width="48"
        height="38"
        rx="6"
        fill={h.solid ? h.color : 'none'}
        fillOpacity={h.solid ? 0.16 : 0}
        stroke={h.color}
        strokeWidth="3"
      />
      <line x1="6" y1="17" x2="54" y2="17" stroke={h.color} strokeWidth="3" />
    </svg>
  )
}

function Legend() {
  const items: Level[] = ['high', 'medium', 'possible', 'low', 'none']
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-500">
      {items.map((l) => (
        <span key={l} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{
              backgroundColor: HEAT[l].solid ? HEAT[l].color : 'transparent',
              border: `1px ${HEAT[l].dashed ? 'dashed' : 'solid'} ${HEAT[l].color}`,
            }}
          />
          {HEAT[l].label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-5" style={{ borderTop: `2px dashed ${B2B_COLOR}` }} />
        B2B redemption link
      </span>
      <span className="text-slate-600">blast radius if the account were compromised, not a judgement of the person</span>
    </div>
  )
}

export function AccountTypes() {
  // The picker is illustrative: any of the three types can be selected and its
  // blast radius read, signed in or not. The one live thing is which type the
  // visitor actually is. Today the only real sign-in on this site is the
  // External ID (CIAM) customer, so any authenticated visitor is the customer,
  // and the map leads with that selection. Member and guest real-type detection
  // (reading idp / tid off the account via useMsal) arrives when those sign-ins
  // exist; they do not yet, so there is nothing else to branch on.
  //
  // Read through the shared MSAL instance's hook, the same way SignInPanel does.
  // It never constructs its own PublicClientApplication: exactly one instance
  // boots per page (see main.tsx), and a second would fight it for the redirect
  // response.
  const isAuthenticated = useIsAuthenticated()
  const [sel, setSel] = useState<Identity>(() =>
    isAuthenticated ? CUSTOMER_IDENTITY : IDENTITIES[0],
  )

  const wrapRef = useRef<HTMLDivElement>(null)
  const triRefs = useRef<Partial<Record<ScopeKey, HTMLDivElement | null>>>({})
  const [links, setLinks] = useState<{ x1: number; y1: number; x2: number; y2: number }[]>([])

  const measure = useCallback(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const base = wrap.getBoundingClientRect()
    const homeIdx = SCOPES.findIndex((s) => s.key === sel.home)
    const out: { x1: number; y1: number; x2: number; y2: number }[] = []
    SCOPES.forEach((s, gi) => {
      // A link is a B2B relationship: a guest presence (medium) in a non-home tenant.
      if (s.key === sel.home || sel.exposure[s.key].tenant !== 'medium') return
      const homeP = triRefs.current[sel.home]?.querySelector('polygon')?.getBoundingClientRect()
      const guestP = triRefs.current[s.key]?.querySelector('polygon')?.getBoundingClientRect()
      if (!homeP || !guestP) return
      const toLeft = gi < homeIdx
      // Meet each triangle at mid-height on its facing slanted edge: mid level, and
      // still in the gap so it never crosses a third triangle. At half height a
      // triangle is half its base width, so the edge is a quarter-width off centre.
      const midY = (homeP.top + homeP.bottom) / 2 - base.top
      const homeCx = (homeP.left + homeP.right) / 2 - base.left
      const guestCx = (guestP.left + guestP.right) / 2 - base.left
      const homeEdge = (homeP.right - homeP.left) / 4
      const guestEdge = (guestP.right - guestP.left) / 4
      const x1 = toLeft ? homeCx - homeEdge : homeCx + homeEdge
      const x2 = toLeft ? guestCx + guestEdge : guestCx - guestEdge
      out.push({ x1, y1: midY, x2, y2: midY })
    })
    setLinks(out)
  }, [sel])

  useLayoutEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])

  return (
    <section aria-labelledby="account-types-heading" className="max-w-4xl text-slate-200">
      <h2 id="account-types-heading" className="text-lg font-medium">
        Account types, where each one can reach
      </h2>
      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-500">
        Same person, three directory objects. Pick one and watch its blast radius light up across the
        tenants, their subscriptions, and the app.
      </p>

      {/* Picker */}
      <div className="mt-5 flex flex-wrap gap-2">
        {IDENTITIES.map((id) => {
          const active = sel.key === id.key
          return (
            <button
              key={id.key}
              onClick={() => setSel(id)}
              className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                active
                  ? 'border-emerald-500 bg-emerald-500/10 text-emerald-200'
                  : 'border-slate-700 text-slate-300 hover:border-slate-500'
              }`}
            >
              {id.label}
            </button>
          )
        })}
      </div>

      {/* The map: three tenants (triangles) side by side, a key/app above each, B2B
          links routed through the gaps between the tenants they connect. */}
      <div ref={wrapRef} className="relative mt-8">
        <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
          {links.map((l, i) => (
            <line
              key={i}
              x1={l.x1}
              y1={l.y1}
              x2={l.x2}
              y2={l.y2}
              stroke={B2B_COLOR}
              strokeWidth="1.5"
              strokeDasharray="5 4"
            />
          ))}
        </svg>
        <div className="flex gap-4">
          {SCOPES.map((s) => {
            const e = sel.exposure[s.key]
            const isHome = sel.home === s.key
            return (
              <div key={s.key} className="flex flex-1 flex-col items-center gap-1.5">
                <div className="flex h-11 items-center justify-center">
                  {s.kind === 'app' ? <AppIcon level={e.top} /> : <KeyIcon level={e.top} />}
                </div>
                <p className="font-mono text-[11px]" style={{ color: HEAT[e.top].color }}>
                  {s.top}
                </p>
                <div className="h-3 w-px bg-slate-700" />
                <div ref={(el) => { triRefs.current[s.key] = el }}>
                  <Triangle level={e.tenant} home={isHome} />
                </div>
                <p className="text-sm font-medium text-slate-200">{s.tenant}</p>
              </div>
            )
          })}
        </div>
      </div>

      <Legend />

      {/* What the account is, then how far it reaches */}
      <p className="mt-6 max-w-3xl text-sm font-medium text-slate-200">{sel.what}</p>
      <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-400">{sel.summary}</p>

      {/* The measured claim diff */}
      <div className="mt-10">
        <p className="text-sm font-medium text-slate-200">What the token actually says</p>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
          The interesting claims, measured. Everything else is identical in shape. The token carries
          no roles or RBAC, which is why the map above is a separate thing from the token.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="border-b border-slate-800 py-2 pr-4 font-normal">claim</th>
                {IDENTITIES.map((id) => (
                  <th
                    key={id.key}
                    className={`border-b border-slate-800 py-2 pr-4 font-normal ${
                      sel.key === id.key ? 'text-emerald-300' : ''
                    }`}
                  >
                    {id.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="font-mono">
              {(Object.keys(CLAIM_LABEL) as ClaimKey[]).map((claim) => (
                <tr key={claim}>
                  <td className="border-b border-slate-900 py-2 pr-4 text-slate-400">
                    {CLAIM_LABEL[claim]}
                  </td>
                  {IDENTITIES.map((id) => (
                    <td
                      key={id.key}
                      className={`border-b border-slate-900 py-2 pr-4 ${
                        sel.key === id.key ? 'text-slate-200' : 'text-slate-600'
                      }`}
                    >
                      {id.claims[claim]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 max-w-2xl text-xs leading-relaxed text-slate-500">
          The tell: the member and the guest share <span className="font-mono text-slate-300">tid</span>.
          The guest’s is the tenant it is visiting, not its home. Only{' '}
          <span className="font-mono text-slate-300">idp</span> reveals the home.
        </p>
      </div>
    </section>
  )
}
