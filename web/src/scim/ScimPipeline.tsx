/**
 * Where the user is, right now, on its way from a directory to an application.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
 *
 * Steve's objection to the first version: "hard to tell what's happening". A
 * transcript and a table are both true and neither shows the JOURNEY. The thing
 * being demonstrated is that an object created in one system arrives in another
 * without anyone touching the second system, and that is a shape, not a list.
 *
 * ── WHAT IS REAL AND WHAT IS PRESENTATION, STATED PLAINLY ────────────────────
 *
 * Every stage is backed by evidence the page actually holds:
 *
 *   Entra          the user object Graph returned, with its real object id
 *   Provisioning   the status provisionOnDemand returned
 *   Application    the row, confirmed by POLLING THE FEED until it appears
 *
 * The third one genuinely waits. It does not light up because the first two did;
 * it lights up when the row is really there, and it stays pending if it never
 * arrives. That distinction is the whole difference between showing a pipeline
 * and drawing one.
 *
 * The first two arrive together, because the hire endpoint answers only after
 * both have happened. Revealing them a beat apart is presentation, and it is
 * honest presentation: that IS the order they occurred in. What would not be
 * honest is showing stage three from the same response.
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

const RING: Record<StageState, string> = {
  idle: 'border-slate-800 bg-slate-900/40',
  working: 'border-sky-500/40 bg-sky-500/5',
  done: 'border-emerald-500/40 bg-emerald-500/5',
  failed: 'border-amber-500/40 bg-amber-500/5',
}

const DOT: Record<StageState, string> = {
  idle: 'bg-slate-700',
  working: 'bg-sky-400 animate-pulse',
  done: 'bg-emerald-400',
  failed: 'bg-amber-400',
}

const LABEL: Record<StageState, string> = {
  idle: 'waiting',
  working: 'in flight',
  done: 'done',
  failed: 'no',
}

function Stage({
  title,
  subtitle,
  stage,
}: {
  title: string
  subtitle: string
  stage: PipelineStage
}) {
  return (
    <div className={`flex-1 rounded-xl border p-4 transition-colors duration-500 ${RING[stage.state]}`}>
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[stage.state]}`} aria-hidden="true" />
        <p className="text-sm font-medium text-slate-200">{title}</p>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-slate-500">
          {LABEL[stage.state]}
        </span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-slate-500">{subtitle}</p>
      {stage.detail && (
        <p className="mt-2 font-mono text-xs break-all text-slate-400">{stage.detail}</p>
      )}
    </div>
  )
}

/** Horizontal on desktop, stacked on a phone, and the arrow turns with it. */
function Arrow() {
  return (
    <div className="flex shrink-0 items-center justify-center text-slate-700" aria-hidden="true">
      <span className="hidden sm:inline">→</span>
      <span className="sm:hidden">↓</span>
    </div>
  )
}

export function ScimPipeline({ model }: { model: PipelineModel }) {
  return (
    <section className="mt-10" aria-label="Provisioning pipeline">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-stretch">
        <Stage
          title="Microsoft Entra ID"
          subtitle="The employee is created here, as an ordinary directory object."
          stage={model.entra}
        />
        <Arrow />
        <Stage
          title="Provisioning service"
          subtitle="Entra evaluates the scoping filter, then calls the app over SCIM."
          stage={model.provisioning}
        />
        <Arrow />
        <Stage
          title="The application"
          subtitle="This site's own SCIM endpoint. It learns about the hire from Entra, not from us."
          stage={model.application}
        />
      </div>
    </section>
  )
}
