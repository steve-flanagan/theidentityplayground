import { useEffect, useMemo, useState } from 'react'
import {
  ACTOR_LABELS,
  buildSisuJourney,
  codeUrl,
  spanMs,
  type Actor,
  type Journey,
  type Span,
  type ZoomNode,
} from '../lib/journey'

// Overview + detail. The pattern every profiler, packet capture and network
// waterfall uses, because it's the one that survives being kept open all day.
//
//   OVERVIEW — always the whole 1,400 ms. Never zooms. A brush marks the slice
//              you're looking at, so the total scale is never off screen.
//   DETAIL   — the current level, on its own axis, with readable labels in
//              their own column. Click a slice with subsections and the detail
//              rescales: 0–1400 becomes 4–18 and the bars slide into place.
//
// Both halves of this are things Steve asked for at different times and they
// were never in conflict — an earlier pass threw the readable rows away to make
// room for a big track, which was an error, not a tradeoff.
//
// This is built to be a reference someone keeps on a second monitor, not a
// spectacle: deep-linkable per step, keyboard-reachable, copyable values, dense
// by default. Desktop-first; on a phone the track scrolls rather than the
// desktop layout being compromised to fit one.

type Props = {
  token: string
  tokenLabel: string
}

/** Bar colour = who did the work. Carries information, or it isn't allowed. */
const ACTOR_BAR: Record<Actor, string> = {
  browser: 'bg-sky-400',
  network: 'bg-slate-400',
  entra: 'bg-emerald-400',
}

const TICK_FRACTIONS = [0, 0.25, 0.5, 0.75, 1]

const actorOf = (n: ZoomNode, fallback: Actor = 'entra'): Actor =>
  (n as { actor?: Actor }).actor ?? fallback

const timedChildren = (n: ZoomNode) => (n.children ?? []).filter((c) => c.span)

/** left/width against an axis. The entire zoom, right here. */
function place(span: Span, axis: Span) {
  const w = spanMs(axis)
  return {
    left: `${((span.start - axis.start) / w) * 100}%`,
    width: `${Math.max((spanMs(span) / w) * 100, 0.3)}%`,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// THE URL FRAGMENT IS NOT OURS. IT IS MSAL'S.
//
// Entra returns the authorization code in the fragment:
//   https://theidentityplayground.com/#code=…&client_info=…&state=…
//
// An earlier version of this component wrote the fragment from an effect on
// mount, which stripped that response before MSAL could read it and silently
// broke every sign-in in production. It wasn't even a race: React runs child
// effects before parent effects, and this component is a child of MsalProvider,
// so it lost every time.
//
// Two rules keep it fixed, and both are load-bearing:
//
//   1. NAMESPACE. Only a fragment starting with `step=` is ours. MSAL's starts
//      with `code=` or `error=`. We never read or write anything else.
//   2. NEVER WRITE ON MOUNT. The fragment is only written in response to a
//      click — by which time MSAL has long since consumed and cleared its own.
//
// If you are about to touch location.hash here, re-read this first.
// ─────────────────────────────────────────────────────────────────────────────

const HASH_PREFIX = 'step='

/** Our ids out of the fragment — or nothing, if the fragment isn't ours. */
function readStepHash(): string[] {
  const raw = location.hash.replace(/^#/, '')
  if (!raw.startsWith(HASH_PREFIX)) return []
  return raw.slice(HASH_PREFIX.length).split('/').filter(Boolean)
}

/** Called from click handlers only. Never from an effect, never on mount. */
function writeStepHash(path: ZoomNode[]): void {
  // Refuse to touch an auth response even if somehow called during one.
  const raw = location.hash.replace(/^#/, '')
  if (raw && !raw.startsWith(HASH_PREFIX)) return

  const ids = path.map((n) => n.id).join('/')
  history.replaceState(
    null,
    '',
    ids ? `#${HASH_PREFIX}${ids}` : location.pathname + location.search,
  )
}

/** Resolve a deep link like #step=pkce/pkce:nonce back into real nodes. */
function resolvePath(ids: string[], roots: ZoomNode[]): ZoomNode[] {
  const out: ZoomNode[] = []
  let level = roots
  for (const id of ids) {
    const found = level.find((n) => n.id === id)
    if (!found) break
    out.push(found)
    level = found.children ?? []
  }
  return out
}

export function JourneyTimeline({ token, tokenLabel }: Props) {
  const journey: Journey = useMemo(
    () => buildSisuJourney(token, tokenLabel),
    [token, tokenLabel],
  )

  /**
   * The one piece of state. Everything else is derived from it.
   *
   * Seeded from the deep link during render, NOT in an effect. Reading it in an
   * effect races the effect that writes it: StrictMode double-invokes effects in
   * dev, so the write pass (path still empty) wiped the hash before the second
   * read pass saw it, and the link silently resolved to nothing.
   */
  const [path, setPath] = useState<ZoomNode[]>(() =>
    resolvePath(readStepHash(), journey.events),
  )

  /**
   * The only way this component changes state. setPath is never called directly,
   * so the fragment can only ever be written from a real click — see the note
   * above readStepHash for why that matters more than it looks.
   */
  function navigate(next: ZoomNode[]) {
    setPath(next)
    writeStepHash(next)
  }

  const selected = path[path.length - 1] ?? null

  // Zoom follows the deepest thing in the path that actually contains timed
  // things. Selecting a leaf doesn't move the camera — there's nothing inside
  // it to get closer to, and its siblings should stay put.
  const zoomContainer =
    [...path].reverse().find((n) => n.span && timedChildren(n).length > 0) ?? null

  const axis: Span = zoomContainer?.span ?? { start: 0, end: journey.duration }
  const detailNodes = zoomContainer ? timedChildren(zoomContainer) : journey.events
  const share = (spanMs(axis) / journey.duration) * 100

  // Escape backs out one level. Cheap, and it's what a tool should do.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && path.length) {
        setPath(path.slice(0, -1))
        writeStepHash(path.slice(0, -1))
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [path])

  /** Select a node at the current detail level. */
  function open(node: ZoomNode) {
    const prefix = zoomContainer ? path.slice(0, path.indexOf(zoomContainer) + 1) : []
    navigate([...prefix, node])
  }

  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/50">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-slate-800 px-5 py-3">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h3 className="font-mono text-sm text-slate-200">{journey.label}</h3>
          <p className="text-xs text-slate-500">{journey.summary}</p>
        </div>
        <div className="flex items-baseline gap-4">
          <p className="font-mono text-slate-500">
            <span className="text-2xl tabular-nums text-slate-100">
              {journey.duration.toLocaleString()}
            </span>{' '}
            <span className="text-xs">ms total</span>
          </p>
          <span
            className={`rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ring-1 ring-inset ${
              journey.outcome.ok
                ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30'
                : 'bg-red-500/10 text-red-300 ring-red-500/30'
            }`}
          >
            {journey.outcome.label}
          </span>
        </div>
      </div>

      {/* ── OVERVIEW. Always the whole thing. Never zooms. ─────────────── */}
      <div className="border-b border-slate-800 px-5 py-3">
        <div className="mb-1 flex items-baseline justify-between">
          <span className="font-mono text-[10px] uppercase tracking-wider text-slate-600">
            The whole sign-in
          </span>
          <span className="flex flex-wrap items-center gap-x-3">
            {(Object.keys(ACTOR_LABELS) as Actor[]).map((actor) => (
              <span key={actor} className="flex items-center gap-1">
                <span className={`h-2 w-2 rounded-sm ${ACTOR_BAR[actor]}`} />
                <span className="font-mono text-[10px] uppercase tracking-wider text-slate-600">
                  {ACTOR_LABELS[actor]}
                </span>
              </span>
            ))}
          </span>
        </div>

        <div className="relative h-9 overflow-hidden rounded border border-slate-700 bg-slate-950">
          {journey.events.map((event) => {
            const { left, width } = place(event.span, { start: 0, end: journey.duration })
            const isSel = selected?.id === event.id || zoomContainer?.id === event.id
            return (
              <button
                key={event.id}
                onClick={() => navigate([event])}
                title={`${event.label} · ${spanMs(event.span)} ms`}
                aria-label={event.label}
                style={{ left, width }}
                className={`absolute inset-y-0 border-r border-slate-950 ${
                  event.absent ? 'hatch' : ACTOR_BAR[event.actor]
                } ${isSel ? 'z-10 opacity-100 ring-2 ring-inset ring-white' : 'opacity-60 hover:opacity-95'}`}
              />
            )
          })}

          {/* The brush: which slice the detail below is showing. */}
          {zoomContainer && (
            <span
              aria-hidden="true"
              style={place(axis, { start: 0, end: journey.duration })}
              className="zoom-bar pointer-events-none absolute inset-y-0 z-20 min-w-[2px] bg-white/90"
            />
          )}
        </div>

        <div className="mt-1 flex justify-between font-mono text-[10px] tabular-nums text-slate-600">
          <span>0</span>
          <span>{journey.duration.toLocaleString()} ms</span>
        </div>
      </div>

      {/* ── DETAIL. The current level, on its own axis. ────────────────── */}
      <div className="px-5 py-3">
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="flex flex-wrap items-center gap-x-2">
            <button
              onClick={() => navigate([])}
              className={`font-mono text-xs transition-colors ${
                !zoomContainer ? 'text-emerald-300' : 'text-slate-500 hover:text-slate-200'
              }`}
            >
              14 events
            </button>
            {zoomContainer && (
              <>
                <span className="text-slate-700" aria-hidden="true">
                  ›
                </span>
                <span className="font-mono text-xs text-emerald-300">
                  {zoomContainer.label}
                </span>
                <button
                  onClick={() => navigate(path.slice(0, path.indexOf(zoomContainer)))}
                  className="ml-1 font-mono text-[10px] uppercase tracking-wider text-slate-500 hover:text-emerald-300"
                >
                  ↑ back <span className="text-slate-700">(esc)</span>
                </button>
              </>
            )}
          </span>
          <span className="font-mono text-[10px] tabular-nums text-slate-500">
            {zoomContainer ? (
              <>
                showing {spanMs(axis)} ms ·{' '}
                {share < 1 ? share.toFixed(1) : Math.round(share)}% of the sign-in
              </>
            ) : (
              <>{detailNodes.length} steps · full scale</>
            )}
          </span>
        </div>

        {/* Ruler for THIS axis. The numbers are the zoom. */}
        <div className="grid grid-cols-[13rem_1fr_3rem] items-center gap-3">
          <span />
          <div className="relative h-4">
            {TICK_FRACTIONS.map((t) => (
              <span
                key={t}
                className="absolute top-0 font-mono text-[10px] tabular-nums text-slate-600"
                style={{ left: `${t * 100}%`, transform: 'translateX(-50%)' }}
              >
                {Math.round(axis.start + t * spanMs(axis))}
              </span>
            ))}
          </div>
          <span className="text-right font-mono text-[10px] uppercase tracking-wider text-slate-600">
            ms
          </span>
        </div>

        <ul className="border-t border-slate-800/60">
          {detailNodes.map((node) => {
            const { left, width } = place(node.span!, axis)
            const isSel = selected?.id === node.id
            const openable = timedChildren(node).length > 0 || Boolean(node.children?.length)

            return (
              <li key={node.id}>
                <button
                  onClick={() => open(node)}
                  className={`grid w-full grid-cols-[13rem_1fr_3rem] items-center gap-3 border-b border-slate-800/60 px-1 py-1 text-left transition-colors ${
                    isSel ? 'bg-emerald-500/10' : 'hover:bg-slate-800/60'
                  }`}
                >
                  <span className="flex items-baseline gap-1.5 truncate">
                    <span
                      className={`truncate text-xs ${
                        isSel ? 'font-medium text-emerald-200' : 'text-slate-300'
                      }`}
                    >
                      {node.label}
                    </span>
                    {openable && <span className="shrink-0 text-[10px] text-emerald-400">→</span>}
                  </span>

                  <span className="relative block h-4">
                    <span
                      style={{ left, width }}
                      className={`zoom-bar absolute top-1 h-2 rounded-sm ${
                        node.absent ? 'hatch' : ACTOR_BAR[actorOf(node, zoomContainer ? actorOf(zoomContainer) : 'entra')]
                      } ${isSel ? 'shadow-[0_0_0_2px] shadow-emerald-400/60' : ''}`}
                    />
                  </span>

                  <span
                    className={`text-right font-mono text-[10px] tabular-nums ${
                      isSel ? 'text-emerald-300' : 'text-slate-600'
                    }`}
                  >
                    {spanMs(node.span!)}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>

      {/* ── Composition, not time ──────────────────────────────────────── */}
      {selected && (
        <div key={selected.id} className="zoom-in border-t border-slate-800 px-5 py-4">
          <NodePanel
            node={selected}
            hideChildren={timedChildren(selected).length > 0}
            onDescend={(child) => navigate([...path, child])}
          />
        </div>
      )}
    </div>
  )
}

function CopyButton({ value }: { value: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(value)
        setDone(true)
        setTimeout(() => setDone(false), 1200)
      }}
      className="font-mono text-[10px] uppercase tracking-wider text-slate-500 hover:text-emerald-300"
    >
      {done ? 'copied' : 'copy'}
    </button>
  )
}

function NodePanel({
  node,
  hideChildren,
  onDescend,
}: {
  node: ZoomNode
  hideChildren?: boolean
  onDescend: (child: ZoomNode) => void
}) {
  const showChildren = Boolean(node.children?.length) && !hideChildren

  return (
    <div>
      <h4 className="font-medium text-slate-100">{node.label}</h4>
      {node.summary && <p className="mt-1 text-sm text-slate-500">{node.summary}</p>}

      {node.literal && (
        <div className="mt-3 rounded border border-slate-800 bg-slate-950">
          <div className="flex items-center justify-between border-b border-slate-800 px-3 py-1">
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-600">
              Value
            </span>
            <CopyButton value={node.literal} />
          </div>
          <pre className="overflow-x-auto px-3 py-2 font-mono text-xs text-emerald-300">
            {node.literal}
          </pre>
        </div>
      )}

      {node.detail && (
        <dl className="mt-3 space-y-2 text-sm">
          <Row term="What" text={node.detail.what} />
          {node.detail.why && <Row term="Why" text={node.detail.why} />}
          {node.detail.gotcha && <Row term="Gotcha" text={node.detail.gotcha} accent />}
        </dl>
      )}

      {/* An artifact that annotates its own gaps is more credible than a
          complete one. An empty node says why it's empty. */}
      {node.absent && (
        <div className="mt-3 rounded border border-dashed border-slate-700 bg-slate-950/50 px-3 py-2">
          <p className="font-mono text-[10px] uppercase tracking-wider text-slate-500">
            Nothing here — and that's the finding
          </p>
          <p className="mt-1 text-sm leading-relaxed text-slate-400">{node.absent}</p>
        </div>
      )}

      {node.code && <CodeSection node={node} />}

      {showChildren && (
        <ul className="mt-4 grid gap-1 sm:grid-cols-2">
          {node.children!.map((child) => (
            <li key={child.id}>
              <button
                onClick={() => onDescend(child)}
                className="flex w-full items-baseline gap-3 rounded border border-slate-800 bg-slate-900 px-3 py-2 text-left transition-colors hover:border-emerald-500/40 hover:bg-slate-800/50"
              >
                <span className="font-mono text-xs text-slate-200">{child.label}</span>
                {child.summary && <span className="text-xs text-slate-500">{child.summary}</span>}
                {child.absent ? (
                  <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-amber-300/70">
                    absent
                  </span>
                ) : (
                  <span className="ml-auto text-[10px] text-emerald-400">→</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* It stops when it stops. */}
      {!node.children?.length && !node.absent && (
        <p className="mt-4 font-mono text-[10px] uppercase tracking-wider text-slate-700">
          ── end of this branch
        </p>
      )}
    </div>
  )
}

/**
 * The real source that does this step. Collapsed by default so it costs no
 * space until asked for. The content is the actual file, embedded at build time
 * — not a hand-copied snippet, which would rot silently the first time the
 * config changed.
 */
function CodeSection({ node }: { node: ZoomNode }) {
  const code = node.code!
  return (
    <details className="mt-4 rounded border border-slate-800 bg-slate-950/60">
      <summary className="cursor-pointer px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-slate-500 hover:text-emerald-300">
        How this is done here — {code.file}
      </summary>
      <div className="border-t border-slate-800 px-3 py-3">
        <p className="mb-3 text-xs leading-relaxed text-slate-400">{code.note}</p>
        <div className="mb-2 flex justify-end">
          <CopyButton value={code.source} />
        </div>
        <pre className="max-h-96 overflow-auto rounded border border-slate-800 bg-slate-950 p-3 font-mono text-[11px] leading-relaxed text-slate-300">
          {code.source}
        </pre>
        <a
          href={codeUrl(code)}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-block font-mono text-[10px] uppercase tracking-wider text-slate-500 hover:text-emerald-300"
        >
          View on GitHub ↗
        </a>
      </div>
    </details>
  )
}

function Row({ term, text, accent }: { term: string; text: string; accent?: boolean }) {
  return (
    <div className="flex gap-3">
      <dt className="w-14 shrink-0 font-mono text-[10px] uppercase tracking-wider text-slate-600">
        {term}
      </dt>
      <dd className={`leading-relaxed ${accent ? 'text-amber-200/70' : 'text-slate-400'}`}>
        {text}
      </dd>
    </div>
  )
}
