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
// Not with CSS `behavior: 'smooth'`: the browser's easing curve and duration are
// not observable, so the recording cannot tell when it finished and a fixed
// sleep afterwards is either a stall or a truncation. Pacing is a number here
// instead.
//
// Not at constant velocity either, which is what the first version did and what
// made it read as a machine. A person scrolling a page does not glide, they
// FLICK: a burst of wheel movement that decelerates as the wheel spins down,
// then a short rest while they read what arrived, then another flick. So this
// splits a scroll into a few flicks, eases each one out, and rests between them.
//
// It also stops where content starts rather than at a pixel offset, because a
// person stops when the thing they were scrolling towards is on screen.
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
  // 1280 keeps the page in its two-column desktop layout, which is what a
  // visitor on a laptop actually sees. 800 tall is enough to hold the whole
  // claims panel (672px) in one frame, which 720 was not.
  width: 1280,
  height: 800,
  // Also write a poster frame beside the video. See the thumbnail section below.
  thumb: 'yes',
}

// slate-950, the page background. Used to pad the thumbnail rather than letting
// it letterbox against whatever the player defaults to.
const PAGE_BG = '0x020617'

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

/**
 * Scroll like a person: a few decelerating flicks with a rest between each.
 * See the header for why not constant velocity and why not behavior:'smooth'.
 */
async function humanScroll(targetY) {
  await page.evaluate(async (target) => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    // Ease-out cubic. Fast at the start of a flick, slow at the end, which is
    // what a spinning-down scroll wheel does.
    const ease = (p) => 1 - Math.pow(1 - p, 3)

    const start = window.scrollY
    const distance = target - start
    if (Math.abs(distance) < 4) return

    // Longer journeys get more flicks, the way a person keeps flicking rather
    // than doing one enormous swipe. Roughly one flick per 450px, 2 to 5.
    const flicks = Math.max(2, Math.min(5, Math.round(Math.abs(distance) / 450)))

    let covered = 0
    for (let f = 0; f < flicks; f++) {
      // The last flick lands exactly on target; earlier ones take a share.
      const flickEnd = f === flicks - 1 ? distance : Math.round((distance * (f + 1)) / flicks)
      const flickDistance = flickEnd - covered
      const frames = 14

      for (let i = 1; i <= frames; i++) {
        window.scrollTo(0, start + covered + flickDistance * ease(i / frames))
        await sleep(16)
      }
      covered = flickEnd

      // A beat between flicks, while a person registers what arrived. Not on
      // the final flick: that rest is the pause the caller asked for.
      if (f < flicks - 1) await sleep(90)
    }
    window.scrollTo(0, target)
  }, targetY)
}

/**
 * Scroll so a section sits fully in frame if it fits, or with its top just
 * inside if it does not. A person stops when the thing arrives, not at a pixel
 * offset, and this is the closest honest approximation of that.
 */
async function bring(headingPattern) {
  const y = await page.evaluate((pattern) => {
    const heading = [...document.querySelectorAll('h1,h2')].find((e) =>
      new RegExp(pattern, 'i').test(e.textContent),
    )
    if (!heading) return null
    const section = heading.closest('section') ?? heading.parentElement
    const box = section.getBoundingClientRect()
    const top = Math.round(box.top + window.scrollY)
    const margin = 48

    // Fits: centre it, so it reads as a framed unit rather than something that
    // happens to start at the top edge.
    if (box.height + margin * 2 <= window.innerHeight) {
      return Math.max(0, Math.round(top - (window.innerHeight - box.height) / 2))
    }
    // Taller than the viewport: put its top just inside and let the rest run off.
    return Math.max(0, top - margin)
  }, headingPattern)

  if (y === null) return false
  await humanScroll(y)
  return true
}

await page.goto(options.url, { waitUntil: 'networkidle' })

const memberButton = page.getByRole('button', { name: /Sign in as Member/i })
await memberButton.waitFor({ state: 'visible', timeout: 30_000 })

// 1. The top of the page, as a visitor first sees it. Short: the hero is three
//    paragraphs nobody reads in a silent autoplaying video.
await page.waitForTimeout(1300)

// 2. Frame the inspector BEFORE touching it. The claims panel is 672px and the
//    viewport is 800, so it fits whole, with the member button inside it. That
//    matters beyond looks: clicking a button that is off-screen makes Playwright
//    scroll to it first, which lands in the recording as a jump cut.
await bring('claims you')
await page.waitForTimeout(900)

// 3. One click, no account. The panel swaps to the member's captured token.
await memberButton.click()
await page.waitForTimeout(2000)

// 4. Module 2, the point of the clip. Three account types, three blast radiuses.
if (await bring('Account types')) {
  await page.waitForTimeout(1000)

  const section = page.locator('section').filter({
    has: page.getByRole('heading', { name: /Account types/i }),
  })
  for (const accountType of ['CIAM Customer', 'Workforce member', 'B2B guest']) {
    await section.getByRole('button', { name: accountType, exact: true }).click()
    await page.waitForTimeout(1500)
  }
  // Hold on the guest, where the External ID tenant has gone dark. That is the
  // frame worth stopping on, and a looping autoplay will land on it.
  await page.waitForTimeout(1100)
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

/** Run ffmpeg, returning its exit code and printing the tail of stderr on failure. */
function ffmpeg(args, onMissing) {
  return new Promise((resolvePromise) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    proc.stderr.on('data', (chunk) => { stderr += chunk })
    proc.on('error', () => {
      console.error(onMissing)
      resolvePromise(1)
    })
    proc.on('close', (c) => {
      if (c !== 0) console.error(stderr.split('\n').slice(-15).join('\n'))
      resolvePromise(c)
    })
  })
}

const code = await ffmpeg(ffmpegArgs, `ffmpeg not found on PATH. The webm is still at: ${webm}`)
if (code !== 0) process.exit(code)

await rm(videoDir, { recursive: true, force: true })
console.log(`Wrote ${options.out}`)

// ── Thumbnail ────────────────────────────────────────────────────────────────
// A poster frame, because LinkedIn shows one before autoplay starts and to
// anyone who has autoplay off.
//
// NOT a frame pulled out of the video. A video frame is a whole page at
// thumbnail size, which means every word on it is illegible and the picture
// reads as grey mush. What survives being shrunk into a feed is the diagram:
// three big coloured triangles, six short labels, and a legend.
//
// So this is a separate, deliberately narrow shot -- the section from its
// heading down to the bottom of the legend, and nothing below it. The paragraph
// and the claims table underneath are the first things to become unreadable and
// they are cropped out on purpose.
//
// Captured at deviceScaleFactor 2 so it stays sharp if anything upscales it, at
// a viewport under Tailwind's lg breakpoint so the map has the full column
// width, and in the "Workforce member" state because that is the one where the
// most of the map is lit.

if (options.thumb === 'yes') {
  const thumbPath = options.out.replace(/\.mp4$/, '-thumb.png')
  const rawPath = resolve(videoDir, 'thumb-raw.png')
  await mkdir(videoDir, { recursive: true })

  const thumbBrowser = await chromium.launch()
  const thumbPage = await thumbBrowser.newPage({
    viewport: { width: 1000, height: 1200 },
    colorScheme: 'dark',
    deviceScaleFactor: 2,
  })
  await thumbPage.goto(options.url, { waitUntil: 'networkidle' })

  const mapSection = thumbPage.locator('section').filter({
    has: thumbPage.getByRole('heading', { name: /Account types/i }),
  })
  await mapSection.waitFor({ state: 'visible', timeout: 30_000 })
  await mapSection.getByRole('button', { name: 'Workforce member', exact: true }).click()
  await thumbPage.waitForTimeout(700)

  // Crop at the legend rather than a magic number, so a layout change moves the
  // crop with it instead of silently slicing the diagram in half.
  const clip = await mapSection.evaluate((section) => {
    const box = section.getBoundingClientRect()
    const legend = [...section.querySelectorAll('*')].find(
      (el) => el.children.length === 0 && /blast radius if the account/i.test(el.textContent),
    )
    const bottom = legend ? legend.getBoundingClientRect().bottom : box.top + 470

    // Breathing room on all four sides. Clipping to the element's exact box puts
    // the heading hard against the left edge, which reads as a screenshot
    // someone cropped badly rather than a composed frame.
    const margin = 28
    const x = Math.max(0, box.x - margin)
    const y = Math.max(0, box.y - margin)
    return {
      x,
      y,
      width: Math.min(window.innerWidth - x, box.width + margin * 2),
      height: Math.round(bottom - box.top) + margin * 2,
    }
  })

  await thumbPage.screenshot({ path: rawPath, clip })
  await thumbBrowser.close()

  // Fit to the video's own dimensions. A thumbnail whose aspect ratio does not
  // match the video gets letterboxed by the player, which looks like a mistake.
  const thumbCode = await ffmpeg(
    [
      '-y', '-i', rawPath,
      '-vf', `scale=${options.width}:-2,pad=${options.width}:${options.height}:(ow-iw)/2:(oh-ih)/2:color=${PAGE_BG}`,
      thumbPath,
    ],
    'ffmpeg not found on PATH, so the thumbnail was not resized.',
  )
  await rm(videoDir, { recursive: true, force: true })

  if (thumbCode === 0) console.log(`Wrote ${thumbPath}`)
}
