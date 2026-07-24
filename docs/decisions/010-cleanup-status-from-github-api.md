# 010. Module 7 reads GitHub's API instead of publishing its own stats

**Status:** decided 24 July 2026, built and live the same day. Supersedes the
"Not built: publishing run stats to the front end" scoping in
[003](003-cross-tenant-graph.md), which recommended the opposite and deferred the
call to "when Module 7's page is built". This is that call.

Every factual claim is marked **[M]** if it was measured or read in current
documentation, **[A]** if it is assumed.

---

## Context

The site tells every visitor their demo account is deleted within 24 hours. Two sweeps
make that true ([003](003-cross-tenant-graph.md), [009](009-workforce-guest-cleanup.md)),
both proven end to end. Until Module 7 there was no way to see it from the site: the only
evidence was a GitHub Actions log an operator had to go and read.

That is also the project's one unmonitored failure. **A scheduled run that never starts
produces no error.** A disabled schedule, a lapsed credential and a deleted workflow all
look identical to silence, and scheduled workflows on public repos are disabled
automatically after 60 days without repository activity **[M]**
([events that trigger workflows](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)).
Both sweeps share this repo, so one quiet stretch takes out both at once.

003 scoped the fix as: the script writes a counts-only JSON, a workflow commits it to
`main`, the page renders it. It flagged the `contents: write` grant as "worth its own
think" and left it there.

## Decision

**The page reads the public GitHub workflow-runs API directly from the visitor's browser.**
No stats file, no commit-back, no backend, no stored credential.

Verified 24 July **[M]**: the endpoint is readable on a public repo with no token and
returns `Access-Control-Allow-Origin: *`, so a browser can call it cross-origin. It gives
`conclusion`, `status`, `event`, `run_started_at` and a link to each run.

The page shows, per sweep: when it last ran, whether it passed, whether the run was
scheduled or hand-started, the last eight runs as links, and a staleness warning when a
sweep has gone quiet for longer than its cadence explains.

### Why not commit the stats back

**The security reason is specific, and it is not the one 003 named.** 003 worried that a
job which can delete users would also be able to push to the branch its own credential
trusts. True, but the sharper version is this: the cleanup job runs
`Install-Module Microsoft.Graph.*` from PSGallery at runtime. A supply-chain compromise
there today costs one run's worth of `User.ReadWrite.All` in two tenants. **With
`contents: write` it also costs `main`, which is the trust root for both tenants'
federated credentials, so transient access becomes permanent.** Pinning the version
narrows that window; it does not close it, and a pinned version is not a verified artifact.

003's own mitigation (a second `workflow_run` workflow holding `contents: write` while the
cleanup holds only `id-token: write`) reduces this but does not remove it: the second job
still commits content the first job produced.

**The honest reason is better than the security one.** A stats file this site publishes
about itself is a **claim**. A link to GitHub's record of the run is **evidence**. The
site's entire argument is that its numbers are measured and its sources are linked
(design.md §2, "never replace the real artifact with a metaphor"). Publishing our own
number about our own reliability, on the page whose job is to prove we are reliable, is
the one place that argument should not be weakened.

## Rejected alternatives

**Commit a stats JSON back to `main`** (003's recommendation). Gives real counts on the
page, which is the thing this design gives up. Rejected on the escalation path above, and
because a self-published number is the weaker artifact. Given up: **the counts.**

**A Function App endpoint over Table Storage.** No `contents: write`, keeps the counts, and
would finally give the deployed-but-unused `func-theidentityplayground` ([006](006-standalone-function-app.md))
a job. Rejected as disproportionate for a status line: it needs a second federated
credential into Azure, adds the first runtime dependency the front end has ever had on our
own backend, and the page must then degrade around an endpoint that can be cold or down.
**Kept as the upgrade path** if the counts ever turn out to matter. Given up: nothing yet.

**Nothing at all.** The status quo. Rejected because the promise is load-bearing and the
monitor is the only thing standing between a stopped sweep and a false sentence on a
public page.

## Consequences

**The counts are not on the page.** How many accounts a run removed is in its log, one
click away, and cannot be read from the API without a token. The page links rather than
restates. Anyone who wants the number gets it from the log, which is the artifact anyway.

**A visitor's browser now depends on GitHub being up.** When it is not, the section says
so and links to the workflow. It never invents a status, and it never renders a stale
cached answer as a live one.

**Unauthenticated GitHub API is 60 requests per hour per IP [M]**, and the page makes two.
That is ~30 loads per visitor per hour before throttling, far beyond this site's traffic.
A five-minute `sessionStorage` cache makes repeat navigation free. If it ever throttles,
the visitor sees a plain sentence saying so.

**The staleness thresholds are deliberately loose.** GitHub's scheduler is best effort:
the hourly guest sweep was observed delivering at 08:03, 10:53 and 13:14 on 23 July, about
every 2.5 hours **[M]**. Thresholds are set to 5 hours (hourly sweep) and 14 hours
(six-hourly sweep), well above the cron interval, because **a monitor that cries wolf on
ordinary lateness gets ignored, which is the failure it exists to prevent.**

**This does not close the 60-day disable risk, it makes it visible.** If both sweeps stop,
the page says so to anyone looking, including Steve. That is the whole mechanism: there is
still no alert, but the failure is no longer silent.

**It is the first thing on the site that reads live data from a third party.** Everything
else is either the visitor's own token or a recorded capture. Worth knowing when the next
module wants a live source.
