// Records a scrolling MP4 tour of the whole site: inspector, timeline, map.
//
// ─────────────────────────────────────────────────────────────────────────────
// TWO CLIPS, TWO JOBS. This is the sibling of capture-demo.mjs and they are not
// redundant.
//
//   capture-demo.mjs  -> docs/demo.gif    the account-types map, 5s, loops,
//                                          ~1.5 MB, for the README above the fold
//   capture-tour.mjs  -> docs/tour.mp4    the whole page, ~18s, scrolls, sound-
//                                          less, for a LinkedIn post
//
// The split is not stylistic. A GIF stores whole frames with no motion
// compression, so scrolling -- where every pixel changes every frame -- is its
// worst case: a scrolling GIF is either enormous or unreadable. Video codecs
// were built for exactly that. Conversely a 20-second MP4 is the wrong thing to
// put above the fold in a README, where a short silent loop reads better and
// costs less.
//
// So: the map loops as a GIF, the tour scrolls as a video. Neither is trying to
// be the other.
//
//   npm run tour --prefix web
//   npm run tour --prefix web -- --url http://localhost:5173
//
// Needs the browser binary once, and ffmpeg on PATH for the webm -> mp4 step:
//
//   npx playwright install chromium
//
// ── WHY IT SCROLLS THE WAY IT DOES ───────────────────────────────────────────
//
// Smooth scrolling is done by stepping the scroll position on a timer rather
// than with CSS `behavior: 'smooth'`. The browser's own smooth scroll has an
// easing curve and a duration it will not tell you about, so the recording
// cannot know when it has finished, and a fixed sleep afterwards is either a
// stall or a truncation. Stepping it manually means the clip's pacing is a
// number in this file.
// ─────────────────────────────────────────────────────────────────────────────

import { mkdir, rm, readdir, rename } from 'node:fs/promises'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

import { chromium } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))

const defaults = {
  url: 'https://theidentityplayground.com',
  out: resolve(here, '../../docs/tour.mp4'),
  // 16:9. LinkedIn autoplays video in-feed and this is the shape it expects.
  width: 1280,
  height: 720,
  // Pixels per scroll step and milliseconds between steps. Together these are
  // the scroll speed: 24px every 16ms is about 1500px/second, which is fast
  // enough not to bore and slow enough to read headings on the way past.
  step: 24,
  stepDelay: 16,
}

const argv = process.argv.slice(2)
const options = { ...defaults }
for (let i = 0; i < argv.length; i += 2) {
  const key = argv[i].replace(/^--/, '')
  if (!(key in defaults)) {
    console.error(`Unknown option: ${argv[i]}`)
    console.error(`Known: ${Object.keys(defaults).map((k) => '--' + k).join(' ')}`)
    process.exit(1)
  }
  options[key] = typeof defaults[key] === 'number' ? Number(argv[i + 1]) : argv[i + 1]
}

const videoDir = resolve(here, '../../.tour-recording')
await rm(videoDir, { recursive: true, force: true })

console.log(`Recording ${options.url}`)

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: options.width, height: options.height },
  recordVideo: { dir: videoDir, size: { width: options.width, height: options.height } },
  colorScheme: 'dark',
  deviceScaleFactor: 1,
})
const page = await context.newPage()

/** Step the scroll position by hand. See the header for why not behavior:'smooth'. */
async function scrollTo(targetY) {
  await page.evaluate(
    async ([target, step, delay]) => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
      let y = window.scrollY
      const direction = target > y ? 1 : -1
      while ((direction > 0 && y < target) || (direction < 0 && y > target)) {
        y += step * direction
        window.scrollTo(0, y)
        await sleep(delay)
      }
      window.scrollTo(0, target)
    },
    [targetY, options.step, options.stepDelay],
  )
}

/** Where a heading sits on the page, so the tour targets content not pixel guesses. */
async function topOf(headingText) {
  return page.evaluate((text) => {
    const h = [...document.querySelectorAll('h1,h2')].find((e) => e.textContent.includes(text))
    if (!h) return null
    // A little above the heading, so it is not jammed against the viewport edge.
    return Math.max(0, Math.round(h.getBoundingClientRect().top + window.scrollY) - 40)
  }, headingText)
}

await page.goto(options.url, { waitUntil: 'networkidle' })

const memberButton = page.getByRole('button', { name: /Sign in as Member/i })
await memberButton.waitFor({ state: 'visible', timeout: 30_000 })

// 1. The top of the page, as a visitor first sees it.
await page.waitForTimeout(2000)

// 2. One click, no account. The claims panel on the right swaps to the member.
await memberButton.click()
await page.waitForTimeout(2200)

// 3. Down past the token, which is now the member's.
const tokenTop = await topOf('Sample ID token')
const memberTokenTop = await topOf('Member sample token')
await scrollTo(memberTokenTop ?? tokenTop ?? 900)
await page.waitForTimeout(2200)

// 4. The measured timeline for that member's real sign-in.
const timelineTop = await topOf('How those claims got there')
if (timelineTop !== null) {
  await scrollTo(timelineTop)
  await page.waitForTimeout(2600)
}

// 5. Module 2. Three account types, three blast radiuses.
const mapTop = await topOf('Account types')
if (mapTop !== null) {
  await scrollTo(mapTop)
  await page.waitForTimeout(1400)

  const section = page.locator('section').filter({
    has: page.getByRole('heading', { name: /Account types/i }),
  })
  for (const accountType of ['CIAM Customer', 'Workforce member', 'B2B guest']) {
    await section.getByRole('button', { name: accountType, exact: true }).click()
    await page.waitForTimeout(1900)
  }
  // Hold on the guest, where the External ID tenant has gone dark.
  await page.waitForTimeout(900)
}

// Video is only flushed to disk on context close, not page close.
await context.close()
await browser.close()

const recorded = (await readdir(videoDir)).find((f) => f.endsWith('.webm'))
if (!recorded) {
  console.error('Playwright wrote no video. Nothing to convert.')
  process.exit(1)
}
const webm = join(videoDir, recorded)

// ── webm -> mp4 ──────────────────────────────────────────────────────────────
// LinkedIn takes mp4 reliably and webm unreliably. yuv420p because some players
// (and some social pipelines) will not decode anything else, and the even-
// dimension filter because H.264 refuses odd widths or heights.

await mkdir(dirname(options.out), { recursive: true })

const ffmpegArgs = [
  '-y',
  '-i', webm,
  '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
  '-c:v', 'libx264',
  '-preset', 'slow',
  '-crf', '20',
  '-pix_fmt', 'yuv420p',
  '-movflags', '+faststart',
  options.out,
]

const code = await new Promise((resolvePromise) => {
  const proc = spawn('ffmpeg', ffmpegArgs, { stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  proc.stderr.on('data', (chunk) => { stderr += chunk })
  proc.on('error', () => {
    console.error('ffmpeg not found on PATH. The webm is still at:', webm)
    resolvePromise(1)
  })
  proc.on('close', (c) => {
    if (c !== 0) console.error(stderr.split('\n').slice(-15).join('\n'))
    resolvePromise(c)
  })
})

if (code !== 0) process.exit(code)

await rm(videoDir, { recursive: true, force: true })
console.log(`Wrote ${options.out}`)
