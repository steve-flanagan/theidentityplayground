import { useEffect, useRef, useState } from 'react'

/**
 * Calls scrolling past, above the thing that made them.
 *
 * ── THE BRIEF ────────────────────────────────────────────────────────────────
 *
 * Steve: "add like disappearing text above the entra, scim and app visuals …
 * I want to see the graph calls go by on user create. I want to see the scim
 * calls while it's in the pipeline … If we need to slow it down to show the
 * calls, that's fine."
 *
 * So this is not a log. A log is the table underneath, which is where anyone who
 * wants to actually read a request goes. This is the sense that something is
 * happening, in the place it is happening, and it is allowed to be too fast to
 * read carefully.
 *
 * ── ON DELIBERATELY SLOWING IT DOWN ──────────────────────────────────────────
 *
 * The real calls finish far quicker than this plays them, and terminate is close
 * to instant. Steve's call, and it is the right one: a truthful blur communicates
 * less than a slowed-down sequence of things that genuinely happened. What would
 * NOT be acceptable is inventing a call to pad the sequence, so the queue is only
 * ever what the backend reported doing.
 *
 * 450ms per line. He said 0.2s and had no strong view; at that speed three lines
 * are gone before the eye settles, and this is meant to be glanceable rather than
 * subliminal.
 */

const LINE_MS = 450

/** Newest at the bottom, older ones dimming above it. Three is enough to read as
 *  movement and few enough to fit over an icon. */
const VISIBLE = 3

export function CallTicker({ queue }: { queue: string[] }) {
  const [shown, setShown] = useState<string[]>([])
  const timers = useRef<number[]>([])

  useEffect(() => {
    // Clear anything still scheduled: a second hire while the first is playing
    // should start over rather than interleave two sequences.
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
    setShown([])

    if (queue.length === 0) return

    queue.forEach((line, i) => {
      timers.current.push(
        window.setTimeout(() => setShown((s) => [...s, line].slice(-VISIBLE)), i * LINE_MS),
      )
    })

    // And then they go. The text disappearing is the point: a list that stayed
    // would become a second, worse copy of the table below it.
    timers.current.push(
      window.setTimeout(() => setShown([]), queue.length * LINE_MS + 1400),
    )

    return () => {
      timers.current.forEach((t) => window.clearTimeout(t))
      timers.current = []
    }
  }, [queue])

  return (
    // Fixed height, always present. Reserving the space means the icons below do
    // not jump the moment a call arrives, which on a three-column diagram reads
    // as the whole thing twitching.
    <div
      className="flex h-12 w-full flex-col justify-end overflow-hidden"
      aria-live="polite"
      aria-label="Recent calls"
    >
      {shown.map((line, i) => (
        <p
          key={`${line}-${i}`}
          className={`truncate text-center font-mono text-[10px] leading-4 ${
            i === shown.length - 1 ? 'text-slate-300' : i === shown.length - 2 ? 'text-slate-500' : 'text-slate-700'
          }`}
        >
          {line}
        </p>
      ))}
    </div>
  )
}
