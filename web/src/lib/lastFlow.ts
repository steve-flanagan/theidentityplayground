import type { SsoMode } from '../auth/ssoRequest'
import type { FlowId } from './journey'

// Which flow did the visitor ACTUALLY just do?
//
// This exists because of a real credibility failure. Someone signed in via SSO
// and the timeline sat on the "Sign-in" capture — a recording of a flow they had
// not performed — with nothing on screen saying it was a recording. To an
// engineer that reads as fabricated data, and it poisons everything around it.
//
// So: only claim what we actually know, and say the rest plainly.
//
//   prompt=login was sent   → deterministic. We know. It was SSO bypassed.
//   finished impossibly fast → a safe BOUND, not a guess: nobody types an email
//                              and a password in under three seconds, so no
//                              human interaction happened, so the session was
//                              reused. That is SSO.
//   took longer              → a human interacted, but we cannot tell sign-in
//                              from sign-up from a consent screen. Say exactly
//                              that and let them pick. Guessing here would
//                              reintroduce the bug.
//
// The redirect unloads the page, so this rides through sessionStorage.

const INTENT_KEY = 'tip.flow.intent'
const START_KEY = 'tip.flow.start'

/**
 * No human completes a credential entry this fast. Anything quicker than this
 * had no interaction in it at all — that is the whole basis for the inference,
 * and it is a bound rather than a heuristic.
 */
export const HUMAN_FLOOR_MS = 3000

/** Call immediately before a redirect leaves the page. */
export function markFlowStart(mode: SsoMode): void {
  try {
    sessionStorage.setItem(INTENT_KEY, mode)
    sessionStorage.setItem(START_KEY, String(Date.now()))
  } catch {
    // Storage can be unavailable (private mode, blocked). Losing the hint is
    // fine — the timeline just doesn't preselect. It must never break sign-in.
  }
}

export type FlowMatch =
  /** We know which flow this was, and why we know. */
  | { kind: 'matched'; flow: FlowId; elapsedMs: number; because: string }
  /** A person interacted. We can't tell which flow that was, and won't pretend. */
  | { kind: 'ambiguous'; elapsedMs: number }
  /** Nothing to say. */
  | null

/** Pure so the reasoning is testable without a browser or a real sign-in. */
export function matchFlow(intent: string | null, elapsedMs: number | null): FlowMatch {
  if (!intent || elapsedMs === null || elapsedMs < 0) return null

  if (intent === 'force-credentials') {
    return {
      kind: 'matched',
      flow: 'sso-off',
      elapsedMs,
      because: 'this app sent prompt=login, so the session was deliberately ignored',
    }
  }

  if (intent === 'default') {
    if (elapsedMs < HUMAN_FLOOR_MS) {
      return {
        kind: 'matched',
        flow: 'sso-on',
        elapsedMs,
        because: 'it finished faster than anyone can type, so no prompt was shown and the session was reused',
      }
    }
    return { kind: 'ambiguous', elapsedMs }
  }

  return null
}

/** Read what the last redirect-based attempt was. Does not clear it. */
export function readLastFlow(): FlowMatch {
  try {
    const intent = sessionStorage.getItem(INTENT_KEY)
    const started = sessionStorage.getItem(START_KEY)
    if (!intent || !started) return null
    return matchFlow(intent, Date.now() - Number(started))
  } catch {
    return null
  }
}
