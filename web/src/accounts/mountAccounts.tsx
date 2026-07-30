import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AccountTypes } from '../components/AccountTypes'
import { SiteNav } from '../components/SiteNav'
import { activeKeyFrom } from './route'

/**
 * Module 2 on its own page.
 *
 * NO MSAL, like /scim and unlike /app2 and /guest. The map takes one optional
 * prop and reads no session; whoever the visitor is arrives in the URL. That is
 * the whole reason this could be lifted off the homepage without dragging the
 * auth machinery with it.
 */
export function mountAccounts(rootElement: HTMLElement): void {
  const activeKey = activeKeyFrom(window.location.search)
  createRoot(rootElement).render(
    <StrictMode>
      <main className="min-h-screen bg-slate-950 text-slate-300">
        <SiteNav current="/accounts" />
        <div className="mx-auto max-w-5xl px-6 pt-12 pb-24">
          <p className="font-mono text-xs uppercase tracking-widest text-emerald-400">
            Account types
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-white">
            One person, three directory objects
          </h1>
          <p className="mt-6 max-w-3xl text-lg leading-relaxed text-slate-400">
            A customer, an employee and a business guest. Pick one and its reach lights up across
            the tenants, their subscriptions and the app. The text is identical in all three; only
            what it can touch moves.
          </p>

          <div className="mt-12">
            <AccountTypes activeKey={activeKey} />
          </div>

          {/* No "back to the playground" here any more. The nav at the top is
              the way back, and a second one at the bottom is the kind of thing
              that accumulates until a page has three. */}
          <footer className="mt-14 border-t border-slate-800 pt-6 text-sm text-slate-600">
            Demo tenants only. Every account created here self-destructs.
          </footer>
        </div>
      </main>
    </StrictMode>,
  )
}
