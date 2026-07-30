import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { CleanupStatus } from '../components/CleanupStatus'

/**
 * Module 7 on its own page.
 *
 * The easiest of the three to lift: CleanupStatus takes no props and reads
 * GitHub's public API in the browser, so it holds no credential and needs no
 * backend or session. It was only on the homepage because that is where things
 * went before there were pages.
 */
export function mountCleanup(rootElement: HTMLElement): void {
  createRoot(rootElement).render(
    <StrictMode>
      <main className="min-h-screen bg-slate-950 text-slate-300">
        <div className="mx-auto max-w-4xl px-6 pt-16 pb-24">
          <p className="font-mono text-xs uppercase tracking-widest text-emerald-400">
            Self-destructing accounts
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white">
            Every demo account deletes itself
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-relaxed text-slate-400">
            The site promises it on every page that creates an account. This is the job that keeps
            the promise, and its real run history, read from GitHub as you load the page.
          </p>

          <div className="mt-12">
            <CleanupStatus />
          </div>

          <footer className="mt-14 border-t border-slate-800 pt-6 text-sm text-slate-600">
            <a
              href="/"
              className="underline decoration-slate-700 underline-offset-4 hover:text-slate-400"
            >
              Back to the playground
            </a>
          </footer>
        </div>
      </main>
    </StrictMode>,
  )
}
