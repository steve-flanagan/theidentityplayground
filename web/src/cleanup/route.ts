// Module 7 · self-destructing accounts, on its own page.
//
// Same rules as ACCOUNTS_PATH: no app registration knows this string, and
// navigationFallback means public/staticwebapp.config.json needs no entry.

export const CLEANUP_PATH = '/cleanup'

export function isCleanupPath(pathname: string): boolean {
  return pathname === CLEANUP_PATH || pathname === `${CLEANUP_PATH}/`
}
