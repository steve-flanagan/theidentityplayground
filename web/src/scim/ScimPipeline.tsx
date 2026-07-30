/**
 * Where the user is, right now, on its way from a directory to an application.
 *
 * ── THE BRIEF, IN STEVE'S WORDS ──────────────────────────────────────────────
 *
 * "entra tenant triangle shows the user creation stuff. scim calls over the scim
 * pipeline, then app verification over the app. I don't want it to be crowded,
 * unclear and clunky."
 *
 * The last sentence is the governing constraint and it killed the first attempt.
 * That version was three bordered cards, each with a title, a subtitle AND a
 * detail line — nine lines of prose to say what a diagram says with three
 * labels. It was exactly the crowding an old colleague had just complained about
 * elsewhere on the site.
 *
 * So: one short label per element, and each label sits ON the thing it describes.
 * The tenant carries the user, the pipeline carries the SCIM call, the app
 * carries what it now believes. Nothing explains itself in a paragraph.
 *
 * Icons are Module 2's, not new ones. AccountTypes.tsx already draws a tenant as
 * a triangle and an app as a rounded rect with a title bar, and inventing a
 * second visual language for the same two concepts on the same site is how a
 * thing starts feeling unclear.
 *
 * ── WHAT IS REAL AND WHAT IS PRESENTATION ────────────────────────────────────
 *
 * Every state is backed by evidence the page holds: the object Graph returned,
 * the status provisionOnDemand returned, and the row CONFIRMED BY POLLING THE
 * FEED. The app stage genuinely waits and says so if the row never arrives. It
 * does not light because the others did — that difference is the whole point,
 * on a module that has produced three separate silent no-ops.
 */

export type StageState = 'idle' | 'working' | 'done' | 'failed'

export interface PipelineStage {
  state: StageState
  detail?: string
}

export interface PipelineModel {
  entra: PipelineStage
  provisioning: PipelineStage
  application: PipelineStage
}

export const IDLE_PIPELINE: PipelineModel = {
  entra: { state: 'idle' },
  provisioning: { state: 'idle' },
  application: { state: 'idle' },
}

/** Module 2's palette, deliberately. Same site, same meanings. */
const COLOR: Record<StageState, string> = {
  idle: '#334155',
  working: '#38bdf8',
  done: '#4ade80',
  failed: '#fbbf24',
}

const TEXT: Record<StageState, string> = {
  idle: 'text-slate-600',
  working: 'text-sky-300',
  done: 'text-emerald-300',
  failed: 'text-amber-300',
}

/** The tenant. Same polygon as AccountTypes.tsx, and the figure inside appears
 *  once the user actually exists in it. */
function Tenant({ state }: { state: StageState }) {
  const c = COLOR[state]
  const filled = state !== 'idle'
  return (
    <svg viewBox="0 0 100 90" className="h-auto w-[76px] sm:w-[96px]" aria-hidden="true">
      <polygon
        points="50,6 94,84 6,84"
        fill={filled ? c : 'none'}
        fillOpacity={filled ? 0.16 : 0}
        stroke={c}
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {state !== 'idle' && (
        <g fill="#e2e8f0">
          <circle cx="50" cy="52" r="6.5" />
          <path d="M39 76 C39 65 44 61 50 61 C56 61 61 65 61 76 Z" />
        </g>
      )}
    </svg>
  )
}

/** The app. Module 2's rounded rect with a title bar. */
function AppBox({ state }: { state: StageState }) {
  const c = COLOR[state]
  const filled = state !== 'idle'
  return (
    <svg viewBox="0 0 60 50" className="h-auto w-[58px] sm:w-[72px]" aria-hidden="true">
      <rect
        x="6"
        y="6"
        width="48"
        height="38"
        rx="6"
        fill={filled ? c : 'none'}
        fillOpacity={filled ? 0.16 : 0}
        stroke={c}
        strokeWidth="3"
      />
      <line x1="6" y1="17" x2="54" y2="17" stroke={c} strokeWidth="3" />
    </svg>
  )
}

/**
 * The pipeline itself, and the SCIM call rides on it rather than sitting in a box
 * beside it. Horizontal on desktop, vertical on a phone, so the arrow always
 * points the way the eye is already travelling.
 */
function Pipe({ state }: { state: StageState }) {
  const c = COLOR[state]
  const moving = state === 'working'
  return (
    <>
      <svg viewBox="0 0 100 12" className="hidden h-3 w-full sm:block" aria-hidden="true">
        <line x1="0" y1="6" x2="92" y2="6" stroke={c} strokeWidth="2.5"
          strokeDasharray={moving ? '6 5' : undefined}>
          {/* The only motion on the page, and only while something is in flight.
              A dashed line that never stops moving is decoration; one that moves
              exactly when a request is open is information. */}
          {moving && (
            <animate attributeName="stroke-dashoffset" from="22" to="0" dur="0.9s" repeatCount="indefinite" />
          )}
        </line>
        <polygon points="92,1 100,6 92,11" fill={c} />
      </svg>
      <svg viewBox="0 0 12 60" className="h-12 w-3 sm:hidden" aria-hidden="true">
        <line x1="6" y1="0" x2="6" y2="52" stroke={c} strokeWidth="2.5"
          strokeDasharray={moving ? '6 5' : undefined}>
          {moving && (
            <animate attributeName="stroke-dashoffset" from="22" to="0" dur="0.9s" repeatCount="indefinite" />
          )}
        </line>
        <polygon points="1,52 6,60 11,52" fill={c} />
      </svg>
    </>
  )
}

/** One label. Never two. */
function Label({ title, stage }: { title: string; stage: PipelineStage }) {
  return (
    <div className="mt-2 text-center">
      <p className="text-xs font-medium text-slate-300">{title}</p>
      <p className={`mt-0.5 font-mono text-[11px] break-all ${TEXT[stage.state]}`}>
        {stage.detail ?? ' '}
      </p>
    </div>
  )
}

export function ScimPipeline({ model }: { model: PipelineModel }) {
  return (
    /**
     * Every column gets the SAME fixed-height icon slot, contents centred. The
     * three shapes are different heights by nature — a triangle is tall, an
     * arrow is a line — and letting them sit where they fall put the three
     * labels at three different heights, which reads as an accident rather than
     * a diagram. One shared baseline is the difference.
     *
     * The middle column is capped rather than flex-1 for the same reason: at
     * full width the arrow floated in the middle of a lot of nothing.
     */
    <section className="mt-10" aria-label="Provisioning pipeline">
      <div className="flex flex-col items-center gap-1 sm:flex-row sm:items-start sm:justify-center sm:gap-2">
        <div className="flex flex-col items-center sm:w-40">
          <div className="flex h-20 items-center justify-center sm:h-24">
            <Tenant state={model.entra.state} />
          </div>
          <Label title="Entra tenant" stage={model.entra} />
        </div>

        {/* Shorter on a phone: the vertical connector is a short line, and a slot
            sized for a triangle left it floating in a column of nothing. */}
        <div className="flex flex-col items-center sm:w-40">
          <div className="flex h-14 w-full items-center justify-center sm:h-24">
            <Pipe state={model.provisioning.state} />
          </div>
          <Label title="SCIM" stage={model.provisioning} />
        </div>

        <div className="flex flex-col items-center sm:w-40">
          <div className="flex h-20 items-center justify-center sm:h-24">
            <AppBox state={model.application.state} />
          </div>
          <Label title="The application" stage={model.application} />
        </div>
      </div>
    </section>
  )
}
