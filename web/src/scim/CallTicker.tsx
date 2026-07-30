import { useEffect, useRef, useState } from 'react'

/**
 * Calls scrolling past, above the thing that made them.
 *
 * ── THE BRIEF, IN STEVE'S WORDS ──────────────────────────────────────────────
 *
 * First: "add like disappearing text above the entra, scim and app visuals …
 * I want to see the graph calls go by on user create … If we need to slow it
 * down to show the calls, that's fine."
 *
 * Then, after watching it: "The highlights happen instantly sometimes. I'd rather
 * it sit highlighted on entra, run thru the cmds to build the user (slower I
 * think), then highlight scim, go thru all those, then highlight the app. And the
 * app should hold the name of the user above it until they delete it or navigate
 * off page."
 *
 * So this is not three independent tickers any more. It is one sequence, and the
 * stage highlight waits for the calls above it to finish. ScimDemo owns that
 * choreography and uses LINE_MS to know how long a queue takes; this component
 * owns one column of it.
 *
 * ── WHY IT IS SLOWER THAN THE TRUTH ──────────────────────────────────────────
 *
 * The real calls finish far quicker than this plays them. Steve's call and the
 * right one: a truthful blur communicates less than a slowed sequence of things
 * that genuinely happened. What is not acceptable is inventing a call to pad it,
 * so the queue is only ever what the backend reported doing.
 */

/** Per line. Was 450 and Steve asked for slower after watching it run. */
export const LINE_MS = 700

/** How long the last line lingers before a queue is considered finished. */
export const TAIL_MS = 600

/** Newest at the bottom, older ones dimming above it. Three reads as movement
 *  and fits over an icon. */
const VISIBLE = 3

export function CallTicker({ queue, hold }: { queue: string[]; hold?: string | null }) {
  const [shown, setShown] = useState<string[]>([])
  const timers = useRef<number[]>([])

  useEffect(() => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
    setShown([])

    if (queue.length === 0) return

    queue.forEach((line, i) => {
      timers.current.push(
        window.setTimeout(() => setShown((s) => [...s, line].slice(-VISIBLE)), i * LINE_MS),
      )
    })

    // And then they go, unless something is being held. The text disappearing is
    // the point: a list that stayed would become a second, worse copy of the
    // table below it.
    timers.current.push(window.setTimeout(() => setShown([]), queue.length * LINE_MS + TAIL_MS))

    return () => {
      timers.current.forEach((t) => window.clearTimeout(t))
      timers.current = []
    }
  }, [queue])

  /**
   * The held line outlives the queue. On the application column this is the
   * employee's name, and it stays until they are let go or the page is left —
   * because "who does this app currently know about" is a standing fact, not an
   * event, and the rest of this component is built for events.
   */
  const lines = shown.length > 0 ? shown : hold ? [hold] : []
  const isHeld = shown.length === 0 && Boolean(hold)

  return (
    // Fixed height, always present. Reserving the space means the icons below do
    // not jump the moment a call arrives, which on a three-column diagram reads
    // as the whole thing twitching.
    <div
      className="flex h-12 w-full flex-col justify-end overflow-hidden"
      aria-live="polite"
      aria-label="Recent calls"
    >
      {lines.map((line, i) => (
        <p
          key={`${line}-${i}`}
          className={`truncate text-center font-mono text-[10px] leading-4 ${
            isHeld
              ? 'text-emerald-300'
              : i === lines.length - 1
                ? 'text-slate-300'
                : i === lines.length - 2
                  ? 'text-slate-500'
                  : 'text-slate-700'
          }`}
        >
          {line}
        </p>
      ))}
    </div>
  )
}
