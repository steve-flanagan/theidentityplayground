import { useMemo, useState } from 'react'
import {
  CLAIM_CATEGORY_LABELS,
  SIGNAL_CLAIMS,
  TIME_CLAIMS,
  getAnnotation,
  type ClaimCategory,
} from '../lib/claims'
import { decodeJwt, formatClaimValue, formatTimeClaim, JwtDecodeError } from '../lib/jwt'

type Props = {
  /** A raw JWT. In Phase 1 this is the ID token MSAL just handed us. */
  token: string
  /** Shown in the header, e.g. "ID token". */
  label?: string
  /**
   * True once this is the visitor's own freshly-issued token rather than the
   * sample. It's the whole payoff of signing in, and it used to look identical
   * to the sample — same weight, same colour. Now the header says which it is.
   */
  live?: boolean
}

const CATEGORY_ORDER: ClaimCategory[] = [
  'identity',
  'issuer',
  'auth',
  'tenant',
  'timing',
  'protocol',
]

export function TokenInspector({ token, label = 'ID token', live = false }: Props) {
  const [view, setView] = useState<'annotated' | 'raw'>('annotated')
  const [expanded, setExpanded] = useState<string | null>(null)

  const decoded = useMemo(() => {
    try {
      return { ok: true as const, value: decodeJwt(token) }
    } catch (e) {
      return {
        ok: false as const,
        error: e instanceof JwtDecodeError ? e.message : 'Could not decode this token.',
      }
    }
  }, [token])

  if (!decoded.ok) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
        <h3 className="font-medium text-amber-300">Couldn't decode this token</h3>
        <p className="mt-1 text-sm text-slate-400">{decoded.error}</p>
        <p className="mt-2 text-sm text-slate-500">
          That's not necessarily a bug. Access tokens for Microsoft-owned APIs like Graph are
          deliberately opaque — they aren't yours to read, and their format can change without
          notice. Only decode ID tokens and access tokens issued for an API you registered.
        </p>
      </div>
    )
  }

  const { header, payload, signature, raw } = decoded.value

  // Group known claims by category; collect unknown ones separately rather than
  // hiding them. Pretending a claim doesn't exist because we lack a blurb would
  // undercut the entire point of this module.
  const grouped = new Map<ClaimCategory, string[]>()
  const unannotated: string[] = []
  for (const key of Object.keys(payload)) {
    const ann = getAnnotation(key)
    if (!ann) {
      unannotated.push(key)
      continue
    }
    const list = grouped.get(ann.category) ?? []
    list.push(key)
    grouped.set(ann.category, list)
  }

  return (
    <section
      className={`rounded-xl border bg-slate-900/40 ${
        live ? 'border-emerald-500/40' : 'border-slate-800'
      }`}
    >
      <header
        className={`flex flex-wrap items-center justify-between gap-3 border-b p-4 ${
          live ? 'border-emerald-500/25 bg-emerald-500/5' : 'border-slate-800'
        }`}
      >
        <div>
          <div className="flex items-center gap-2">
            {/* The signed-in tell. A steady emerald dot, not a blinking one —
                technical, not theatrical. It's the difference between "here's a
                sample" and "here's the token you were just handed". */}
            {live && (
              <span
                className="h-2 w-2 shrink-0 rounded-full bg-emerald-400"
                aria-hidden="true"
              />
            )}
            <h2 className={`text-lg font-semibold ${live ? 'text-emerald-200' : 'text-slate-200'}`}>
              {label}
            </h2>
            <span
              className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ring-1 ring-inset ${
                live
                  ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30'
                  : 'bg-slate-500/10 text-slate-400 ring-slate-500/30'
              }`}
            >
              {live ? 'yours · live' : 'sample'}
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {Object.keys(payload).length} claims · signed with {String(header.alg ?? 'unknown')}
          </p>
        </div>
        <div
          className="flex rounded-lg border border-slate-700 p-0.5"
          role="tablist"
          aria-label="Token view"
        >
          {(['annotated', 'raw'] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                view === v ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {v === 'annotated' ? 'Annotated' : 'Raw JWT'}
            </button>
          ))}
        </div>
      </header>

      {/* The teachable moment the spec asks for — stated up front, not buried. */}
      <div className="border-b border-slate-800 bg-sky-500/5 px-4 py-3">
        <p className="text-xs leading-relaxed text-sky-200/80">
          <span className="font-semibold text-sky-300">Decoded, not verified.</span> A JWT is
          base64url — anyone can read one, and anyone can forge one. This panel proves nothing about
          authenticity. Trust comes from checking the signature against the issuer's published keys,
          which belongs on a server, not in a browser the attacker controls. MSAL already validated
          this token before handing it over; we're just showing you what you were given.
        </p>
      </div>

      {view === 'raw' ? (
        <div className="space-y-4 p-4">
          <RawSegment title="Header" json={header} />
          <RawSegment title="Payload" json={payload} />
          <div>
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-slate-500">
              Signature
            </h3>
            <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 font-mono text-xs text-slate-500">
              {signature}
            </pre>
            <p className="mt-1 text-xs text-slate-600">Displayed. Never checked here. See above.</p>
          </div>
          <div>
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-slate-500">
              Full token
            </h3>
            <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 font-mono text-[10px] leading-relaxed break-all whitespace-pre-wrap text-slate-600">
              {raw}
            </pre>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-slate-800/60">
          {CATEGORY_ORDER.filter((c) => grouped.has(c)).map((category) => (
            <div key={category} className="p-4">
              <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-slate-500">
                {CLAIM_CATEGORY_LABELS[category]}
              </h3>
              <ul className="space-y-1">
                {grouped.get(category)!.map((key) => (
                  <ClaimRow
                    key={key}
                    name={key}
                    value={payload[key]}
                    isExpanded={expanded === key}
                    onToggle={() => setExpanded(expanded === key ? null : key)}
                  />
                ))}
              </ul>
            </div>
          ))}

          {unannotated.length > 0 && (
            <div className="p-4">
              <h3 className="mb-2 text-xs font-medium uppercase tracking-wider text-slate-500">
                Not yet annotated
              </h3>
              <p className="mb-3 text-xs text-slate-600">
                Present in your token but missing from the dictionary. Listed rather than hidden —
                an inspector that quietly drops what it doesn't recognise is worse than useless.
              </p>
              <ul className="space-y-1">
                {unannotated.map((key) => (
                  <li key={key} className="flex gap-3 py-1 font-mono text-xs">
                    <span className="w-36 shrink-0 text-slate-500">{key}</span>
                    <span className="min-w-0 break-all text-slate-400">
                      {formatClaimValue(payload[key])}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function RawSegment({ title, json }: { title: string; json: Record<string, unknown> }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-slate-500">{title}</h3>
      <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 font-mono text-xs text-slate-300">
        {JSON.stringify(json, null, 2)}
      </pre>
    </div>
  )
}

function ClaimRow({
  name,
  value,
  isExpanded,
  onToggle,
}: {
  name: string
  value: unknown
  isExpanded: boolean
  onToggle: () => void
}) {
  const ann = getAnnotation(name)
  const isSignal = SIGNAL_CLAIMS.has(name)
  const timeStr = TIME_CLAIMS.has(name) ? formatTimeClaim(value) : null

  return (
    <li>
      {/* Click, not hover: hover doesn't exist on a phone, and a recruiter will
          open this on a phone. */}
      <button
        onClick={onToggle}
        aria-expanded={isExpanded}
        className="flex w-full gap-3 rounded-md px-2 py-1.5 text-left transition hover:bg-slate-800/50"
      >
        <span
          className={`w-36 shrink-0 font-mono text-xs ${isSignal ? 'text-emerald-400' : 'text-slate-400'}`}
        >
          {name}
        </span>
        <span className="min-w-0 flex-1 break-all font-mono text-xs text-slate-300">
          {timeStr ?? formatClaimValue(value)}
        </span>
        <span className="shrink-0 text-xs text-slate-600" aria-hidden="true">
          {isExpanded ? '−' : '+'}
        </span>
      </button>

      {isExpanded && ann && (
        <div className="mt-1 mb-2 ml-2 space-y-2 border-l-2 border-slate-700 py-1 pl-4">
          <p className="text-sm font-medium text-slate-200">{ann.title}</p>
          <p className="text-sm leading-relaxed text-slate-400">{ann.what}</p>
          <p className="text-sm leading-relaxed text-slate-500">
            <span className="text-slate-400">Why it's here: </span>
            {ann.why}
          </p>
          {ann.gotcha && (
            <p className="rounded-md bg-amber-500/5 p-2 text-sm leading-relaxed text-amber-200/70">
              <span className="font-medium text-amber-300">Gotcha: </span>
              {ann.gotcha}
            </p>
          )}
        </div>
      )}
    </li>
  )
}
