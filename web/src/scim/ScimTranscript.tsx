import { useCallback, useEffect, useRef, useState } from 'react'
import { API_BASE } from '../lib/apiBase'

/**
 * What Microsoft Entra actually sent this site, newest first.
 *
 * This component is the reason the module is worth building. A name appearing on
 * a card proves nothing to anyone who provisions for a living; the traffic does.
 * Every line here is a real request from Entra's provisioning service to an
 * endpoint on this domain, recorded as it arrived.
 */

interface ScimEvent {
  at: string
  method: string
  path: string
  status: number
  requestBody: string
  responseSummary: string
}

/**
 * "Live" here means a short poll, and the page says so rather than implying
 * push. Functions on the consumption plan do not do WebSockets, and Azure
 * SignalR is a paid resource on a ten-dollar budget. Three seconds is fast
 * enough that a hire appears while you are still looking at the button.
 */
const POLL_MS = 3000

const METHOD_STYLE: Record<string, string> = {
  POST: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30',
  PATCH: 'bg-amber-500/10 text-amber-300 ring-amber-500/30',
  PUT: 'bg-amber-500/10 text-amber-300 ring-amber-500/30',
  DELETE: 'bg-rose-500/10 text-rose-300 ring-rose-500/30',
  GET: 'bg-sky-500/10 text-sky-300 ring-sky-500/30',
}

/** Pretty-print if it parses, otherwise show it exactly as it arrived. A body
 *  that is not JSON is itself information and should not be hidden. */
function pretty(raw: string): string {
  if (!raw) return ''
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

/** The deviation, detected rather than assumed: Entra capitalises `op` and sends
 *  `active` as a quoted string. Both are visible in the raw body. */
function isNonCompliantPatch(e: ScimEvent): boolean {
  if (e.method !== 'PATCH') return false
  return /"op"\s*:\s*"(Replace|Add|Remove)"/.test(e.requestBody) || /"value"\s*:\s*"(True|False)"/i.test(e.requestBody)
}

export function ScimTranscript() {
  const [events, setEvents] = useState<ScimEvent[]>([])
  const [open, setOpen] = useState<number | null>(null)
  const timer = useRef<number | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/scim-demo/events`)
      if (!res.ok) return
      const body = (await res.json()) as { events: ScimEvent[] }
      setEvents(body.events ?? [])
    } catch {
      // A missed poll is not worth a banner; the next one is three seconds away.
    }
  }, [])

  useEffect(() => {
    void load()

    // Polling stops when the tab is hidden. A background tab quietly billing
    // executions for a page nobody is looking at is the kind of thing that turns
    // a $10 budget into a surprise.
    const tick = () => {
      if (!document.hidden) void load()
    }
    timer.current = window.setInterval(tick, POLL_MS)
    document.addEventListener('visibilitychange', tick)
    return () => {
      if (timer.current) window.clearInterval(timer.current)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [load])

  const deviant = events.find(isNonCompliantPatch)

  return (
    <section className="mt-14" aria-labelledby="transcript">
      <h2 id="transcript" className="text-sm font-medium uppercase tracking-widest text-slate-500">
        What Entra sent
      </h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-400">
        Every request the provisioning service made to this endpoint, newest first. Polled every
        three seconds, not pushed. Click a line for the body.
      </p>

      {/* The headline finding, shown only once Entra has actually produced one.
          Claiming it before the evidence is on screen would be the same sin as
          the rest of this page describing traffic it never captured. */}
      {deviant && (
        <div className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
          <p className="text-sm font-medium text-amber-300">
            That PATCH does not follow the SCIM specification.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            RFC 7644 says <span className="font-mono text-slate-300">"op": "replace"</span> in
            lowercase and <span className="font-mono text-slate-300">"value": false</span> as a
            boolean. Entra sends a capitalised op and the string{' '}
            <span className="font-mono text-slate-300">"False"</span>. Microsoft's own compliance
            page still lists this as unfixed, and the flag that corrects it disables the on-demand
            provisioning this page depends on.
          </p>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            In JavaScript <span className="font-mono text-slate-300">Boolean("False")</span> is
            true. An endpoint that trusts the spec here enables every account it was asked to
            disable, returns 200, and reports a healthy cycle at both ends.
          </p>
        </div>
      )}

      <ul className="mt-5 divide-y divide-slate-800/60 overflow-hidden rounded-xl border border-slate-800">
        {events.length === 0 && (
          <li className="px-4 py-6 text-sm text-slate-500">
            Nothing yet. Hire someone and the first request appears here within a few seconds.
          </li>
        )}
        {events.map((e, i) => {
          const isOpen = open === i
          const body = pretty(e.requestBody)
          return (
            <li key={`${e.at}-${i}`}>
              <button
                onClick={() => setOpen(isOpen ? null : i)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-slate-800/40"
              >
                <span
                  className={`shrink-0 rounded px-2 py-0.5 font-mono text-[10px] font-medium uppercase ring-1 ring-inset ${
                    METHOD_STYLE[e.method] ?? 'bg-slate-500/10 text-slate-400 ring-slate-500/30'
                  }`}
                >
                  {e.method}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-slate-400">
                  {e.path}
                </span>
                <span
                  className={`shrink-0 font-mono text-xs ${
                    e.status >= 400 ? 'text-rose-300' : 'text-slate-500'
                  }`}
                >
                  {e.status}
                </span>
                <span className="hidden shrink-0 font-mono text-xs text-slate-600 sm:inline">
                  {new Date(e.at).toLocaleTimeString()}
                </span>
              </button>

              {isOpen && (
                <div className="space-y-3 border-t border-slate-800/60 bg-slate-950/60 px-4 py-3">
                  <div>
                    <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                      Request
                    </p>
                    <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-300">
                      {body || '(no body)'}
                    </pre>
                  </div>
                  {e.responseSummary && (
                    <div>
                      <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-slate-500">
                        Our response
                      </p>
                      <pre className="max-h-64 overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-xs leading-relaxed text-slate-400">
                        {e.responseSummary}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
