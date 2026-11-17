#!/usr/bin/env bun
// audara-studio youtube-package: shoot, preview and check a video's YouTube package.
// Nothing to install: Bun serves the files on 127.0.0.1, Chrome renders them headless, and Bun's own WebSocket
// speaks the DevTools protocol to it, so it runs the same in Claude Code and Codex, from any folder, with no
// network needed for local files.
//
// Usage (from the project folder; paths are relative to it):
//   shoot:   bun <skill>/scripts/youtube.ts shoot <page.html> [more.html ...] [--size 1280x720] [--scale 1]
//            [--jpg [quality]] [--out <file|dir>]
//            Renders each HTML page at exactly --size CSS pixels (times --scale: --scale 3 makes 3840x2160 from a
//            1280x720 layout) to <page>.png beside it, once its fonts and images have loaded. The folder it runs
//            in is served at /, so a page loads `/public/fonts/X.ttf` or `plates/frame.png` (relative to itself)
//            alike. It reports each block of text: its type size, and that size at 168 px wide (the smallest
//            place its words are meant to be read); a block whose box enters the duration badge's corner; a typeface
//            that isn't drawing (a fallback face took over) and characters the typeface lacks (an Ê, a Ç); a file
//            that failed to load or decode. Text inside images or canvases isn't measured: look at it.
//   preview: bun <skill>/scripts/youtube.ts preview [<dir> | <image> ...] [--video <video>] [--title "..."]
//            [--channel "..."] [--duration m:ss] [--niche <dir>] [--lang en|pt|es] [--out <dir>]
//            The options as viewers meet them, one PNG each: sizes.png (every option at the widths YouTube shows
//            it, 500 px in search down to 100 in a playlist, on its dark and light pages, with the duration
//            badge); feed-dark.png and feed-light.png (each option in a home row, an up-next column and a phone
//            feed, its title wrapped and cut as there); and search.png (a search result, with as much of the
//            description as search shows). The other videos come from
//            --niche: images, with their titles and channels in niche.json ([{"file", "title", "channel",
//            "views", "duration"}]); without it, plain placeholders, and the preview then shows legibility and
//            the title's fit, not how the options stand out.
//   niche:   bun <skill>/scripts/youtube.ts niche [<link | id> ...] [--search "<words>"] [--channel <@handle | link>]
//            [--n 20] [--lang pt] [--region BR] [--video <video>] [--out <dir>]
//            Other videos' thumbnails and titles for preview's --niche, into out/<video>/youtube/niche/ (never
//            the project's assets: they are other people's images, for comparison only): niche.json and one
//            image each, added to what's there (a video already there takes this run's reading, the numbers
//            included when a key is set, and keeps its picture). Links (from the user, or found with a web
//            search) are read through YouTube's oEmbed endpoint: title, channel, picture. --search and
//            --channel need a YouTube Data API key in YOUTUBE_API_KEY (free; a search costs 100 of the 10,000
//            daily units, the rest 1 each), which also adds views, lengths, dates and how each video did
//            against its channel: its views as a multiple of the channel's average per video (lifetime views
//            over uploads) and of its subscribers, listed highest first, to find the videos whose package
//            outran their channel. It never scrapes youtube.com: YouTube's terms forbid automated access
//            outside its APIs. Needs the network.
//   check:   bun <skill>/scripts/youtube.ts check [<dir>] [--video <video>] [--duration <s | m:ss>] [--full [--size 1280x720] [--jpg]]
//            The package against YouTube's limits: each thumbnail (it decodes; 16:9; at least 640 wide; its
//            bytes), title.txt, description.txt (length; characters YouTube refuses; chapters: 0:00 first, three
//            or more, ascending, each at least 10 s, the last too, against the video's length), tags.txt (the
//            500-character count YouTube applies) and the hashtags. Exit 1 when YouTube would refuse or ignore
//            something; a warning doesn't fail it. The text files are checked even when Chrome can't start.
//            --full also holds the package to the whole request: three PNG thumbnails at --size (1280x720 unless
//            given; JPEG with --jpg), title.txt, description.txt and tags.txt; without it, a missing part is
//            only a note. The video's length: --duration, else its final render, else as the engine reads it
//            (video.json's duration, its audio segments, data/audio.json, its one audio file).
//            A language's folder (videos/<video>/youtube/<code>/) is held to what it uploads: the title, the
//            description, its thumbnails with words, subtitles.<code>.srt and, when dubbed, mix.wav (as long as the
//            video, to a frame); tags stay one list for the video. Every subtitles.*.srt is read as YouTube reads
//            SubRip (plain UTF-8, numbered, times in order, inside the video). With --video and no folder, the
//            video's package and then each language's are checked; --full also asks the package for its subtitles.
//   srt:     bun <skill>/scripts/youtube.ts srt --video <video> --lang <code> [--line N]
//            Timed subtitles (SubRip), in lines of the language's length (Netflix's guides: 42 characters, Japanese
//            13, Korean and Chinese 16; --line sets another), two a subtitle, at a sentence's end or a clause's,
//            on screen 5/6 s to 7 s. With no youtube/<code>/narration.txt, from the video's own narration
//            (data/words.json) to youtube/subtitles.<code>.srt. With one (a translation, one paragraph per narration
//            line), to youtube/<code>/subtitles.<code>.srt: timed on the language's dubbed voice when dub.py placed
//            it from that text, else each translated sentence while its original sentence is spoken. Timed notes
//            for words the picture shows (youtube/<code>/notes.tsv, or youtube/notes.<code>.tsv for the video's
//            language: time, seconds, text) fill gaps in the narration. Reports the reading speed.
// <dir> is the package folder: thumbnail-1.png ... and title.txt, description.txt, tags.txt. In an audara project,
// --video <video> means videos/<video>/youtube/, previews go to out/<video>/youtube/, and the video's length is
// read from its render (out/<video>/<video>.mp4), else as the engine resolves it (ffprobe for media).
// Chrome: CHROME_PATH, else the usual install places, else Microsoft Edge (also Chromium).
//
// The limits and sizes below were checked against YouTube's help pages on 2026-10-12 (references/youtube.md).

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const MODES = ['shoot', 'preview', 'niche', 'check', 'srt'];
const mode = argv[0] && !argv[0].startsWith('--') ? argv[0] : '';
const rest = argv.slice(1);
const VALUED = new Set(['size', 'scale', 'out', 'video', 'title', 'channel', 'duration', 'niche', 'lang', 'root', 'search', 'n', 'region', 'line']);
const opts = new Map<string, string>();
const positional: string[] = [];
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (!a.startsWith('--')) { positional.push(a); continue; }
  const k = a.slice(2);
  if (k === 'jpg') { // --jpg takes an optional quality
    const q = rest[i + 1];
    opts.set('jpg', q && /^\d+$/.test(q) ? (i++, q) : '90');
  } else if (k === 'help' || k === 'h') opts.set('help', '1');
  else if (k === 'full') opts.set('full', '1');
  else if (VALUED.has(k)) {
    const v = rest[i + 1];
    if (v === undefined || v.startsWith('--')) fail(`--${k} needs a value`);
    opts.set(k, v); i++;
  } else fail(`unknown option --${k} (see: bun <skill>/scripts/youtube.ts --help)`);
}
const opt = (k: string, d?: string) => opts.get(k) ?? d;

function fail(msg: string): never { console.error(`youtube: ${msg}`); process.exit(2); }
function usage(): never {
  const head = readFileSync(import.meta.path, 'utf8').split('\n').slice(1).filter((l) => l.startsWith('//')).map((l) => l.slice(3));
  console.log(head.join('\n'));
  process.exit(0);
}
if (!mode || opts.has('help') || mode === 'help') usage();
if (!MODES.includes(mode)) fail(`unknown mode "${mode}": use ${MODES.join(', ')}`);

const ROOT = path.resolve(opt('root', '.')!);
/** Whether a path is the folder itself or inside it (a path on another drive is not). */
function inside(root: string, p: string): boolean {
  const rel = path.relative(root, p);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// ---------------------------------------------------------------------------------------------------------------
// YouTube's numbers (references/youtube.md has the sources and dates)
const MOBILE_UPLOAD_BYTES = 2 * 1024 * 1024; // the YouTube app refuses a bigger thumbnail; Studio on a computer takes up to 50 MB
const DESKTOP_UPLOAD_BYTES = 50 * 1024 * 1024;
const MIN_WIDTH = 640;                        // YouTube's minimum thumbnail width
const TITLE_MAX = 100;                        // characters
const DESCRIPTION_MAX = 5000;                 // characters
const TAGS_MAX = 500;                         // characters, counted as YouTube counts them (see tagsLength)
const HASHTAGS_MAX = 60;                      // over this, YouTube ignores every hashtag in the description
const HASHTAGS_MANY = 15;                     // well under that, a long list already reads as spam
const CHAPTER_MIN = 10;                       // seconds: the shortest chapter YouTube accepts
const CHAPTERS_MIN = 3;
// The duration badge sits in the bottom-right corner everywhere. Measured on YouTube (2026-10-12) it covers up to
// about 17% of the width and 18% of the height in today's layouts, about 20% by 23% in the classic 168 px up-next
// column, more for a long video: the last 256x166 px of a 1280x720 image, where text or a face gets hidden.
const BADGE_CORNER = { x: 0.8, y: 0.77 };
// Where a thumbnail shows, in CSS pixels, measured on YouTube on 2026-10-12 in a laptop's window: search (500),
// the home grid (three in a row: 344 at 1366 px wide, up to 528 on a big screen), the up-next column (about 215
// to 325; 168 in the classic layout, still served) and the playlist panel (100), where it is only recognized.
const REVIEW_WIDTHS = [500, 344, 250, 168, 100];
const SMALLEST = 168; // the smallest place a thumbnail's words are meant to be read
// Type under this many pixels at 168 px wide is likely too small to read there (a published video's set, which read at
// that size, had 14 to 19 px).
const SMALLEST_READABLE = 9;

// ---------------------------------------------------------------------------------------------------------------
// Chrome over the DevTools protocol

function findChrome(): { exe: string; name: string } {
  const env = process.env.CHROME_PATH;
  if (env) {
    if (!existsSync(env)) throw new Error(`CHROME_PATH=${env} doesn't exist`);
    return { exe: env, name: 'Chrome (CHROME_PATH)' };
  }
  const chrome: string[] = [], edge: string[] = [];
  if (process.platform === 'win32') {
    // (some sandboxes run commands without ProgramFiles or LOCALAPPDATA: the usual folders are tried as well)
    const local = process.env.LOCALAPPDATA ?? (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Local') : undefined);
    const bases = [local, process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], 'C:\\Program Files', 'C:\\Program Files (x86)'];
    for (const base of bases) if (base) {
      chrome.push(path.join(base, 'Google', 'Chrome', 'Application', 'chrome.exe'));
      edge.push(path.join(base, 'Microsoft', 'Edge', 'Application', 'msedge.exe'));
    }
  } else if (process.platform === 'darwin') {
    chrome.push('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    edge.push('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge');
  } else {
    chrome.push('/opt/google/chrome/chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser');
    edge.push('/usr/bin/microsoft-edge');
  }
  const c = chrome.find((p) => existsSync(p));
  if (c) return { exe: c, name: 'Chrome' };
  const e = edge.find((p) => existsSync(p));
  if (e) return { exe: e, name: 'Microsoft Edge' };
  throw new Error('Google Chrome not found. Install it (Windows: winget install Google.Chrome; macOS: brew install --cask google-chrome; Linux: the .deb or .rpm from https://www.google.com/chrome/), or set CHROME_PATH to a Chrome or Chromium executable.');
}

type Waiter = { method: string; sessionId?: string; resolve: (m: any) => void; reject: (e: Error) => void };
const CALL_TIMEOUT = 60_000;

class Chrome {
  private nextId = 0;
  private pending = new Map<number, { resolve: (r: any) => void; reject: (e: Error) => void; method: string; timer: ReturnType<typeof setTimeout> }>();
  private waiters: Waiter[] = [];
  private listeners: ((m: any) => void)[] = [];
  private dead?: Error;
  private constructor(private proc: ReturnType<typeof Bun.spawn>, private ws: WebSocket, private userDir: string, private stderr: string[]) {
    ws.onmessage = (ev) => {
      const m = JSON.parse(String(ev.data));
      if (m.id !== undefined) {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        clearTimeout(p.timer);
        if (m.error) p.reject(new Error(`${p.method}: ${m.error.message}`));
        else p.resolve(m.result);
        return;
      }
      for (const l of this.listeners) l(m);
      for (let i = this.waiters.length - 1; i >= 0; i--) {
        const w = this.waiters[i];
        if (w.method === m.method && (!w.sessionId || w.sessionId === m.sessionId)) { this.waiters.splice(i, 1); w.resolve(m); }
      }
    };
    // When Chrome dies or the socket closes, everything waiting on it fails at once, with what Chrome last said.
    const die = (why: string) => {
      if (this.dead) return;
      this.dead = new Error(`${why}${this.tail()}`);
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(this.dead); }
      this.pending.clear();
      for (const w of this.waiters.splice(0)) w.reject(this.dead);
    };
    ws.onclose = () => die('the connection to Chrome closed');
    proc.exited.then((code) => die(`Chrome exited (code ${code})`));
  }

  /** Chrome's last lines on stderr, for an error message. */
  tail(): string {
    const lines = this.stderr.join('').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(-4);
    return lines.length ? `; Chrome said: ${lines.join(' | ')}` : '';
  }

  /** Starts Chrome and connects to it. Failures throw (a mode that can go on without a browser, check, does), and
   *  every failed start ends the browser it began and removes its profile, so nothing is left running. */
  static async launch(): Promise<Chrome> {
    const { exe, name } = findChrome();
    const userDir = mkdtempSync(path.join(os.tmpdir(), 'audara-youtube-'));
    // Playwright's defaults for automation, --no-sandbox among them: Chrome's own sandbox can't start its GPU and
    // renderer processes inside another sandbox (Codex's), and the pages are this project's own files.
    const args = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${userDir}`, '--no-sandbox',
      '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio', '--force-color-profile=srgb',
      '--disable-extensions', '--disable-background-networking', '--disable-sync', '--disable-component-update',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--disable-breakpad', '--disable-hang-monitor', '--disable-dev-shm-usage', '--password-store=basic', '--use-mock-keychain',
      'about:blank'];
    let proc: ReturnType<typeof Bun.spawn>;
    try { proc = Bun.spawn([exe, ...args], { stdout: 'ignore', stderr: 'pipe' }); }
    catch (e) { cleanProfile(userDir); throw new Error(`${name} (${exe}) couldn't start: ${(e as Error).message}`); }
    const stderr: string[] = [];
    (async () => {
      const dec = new TextDecoder();
      for await (const chunk of proc.stderr as ReadableStream<Uint8Array>) { stderr.push(dec.decode(chunk)); if (stderr.length > 200) stderr.splice(0, 100); }
    })().catch(() => {});
    const said = () => { const l = stderr.join('').split(/\r?\n/).map((x) => x.trim()).filter(Boolean).slice(-4); return l.length ? `; it said: ${l.join(' | ')}` : ''; };
    const giveUp = async (why: string): Promise<never> => {
      if (proc.exitCode === null) proc.kill();
      await Promise.race([proc.exited, Bun.sleep(3000)]);
      await cleanProfileAsync(userDir);
      throw new Error(`${why}${said()}`);
    };
    // Chrome writes the port it took (and the browser's socket path) into DevToolsActivePort once it listens. On
    // Windows the file can be busy while Chrome writes it: a read that fails is tried again.
    const portFile = path.join(userDir, 'DevToolsActivePort');
    let lines: string[] = [];
    for (let waited = 0; waited < 30_000 && !lines[1]; waited += 50) {
      if (proc.exitCode !== null) return giveUp(`${name} (${exe}) exited at start (code ${proc.exitCode}). A sandbox that blocks starting a browser or opening a local port needs it allowed for this command`);
      if (existsSync(portFile)) {
        try { lines = readFileSync(portFile, 'utf8').split(/\r?\n/); } catch { lines = []; }
      }
      if (!lines[1]) await Bun.sleep(50);
    }
    if (!lines[1]) return giveUp(`${name} (${exe}) didn't open its DevTools port within 30 s`);
    let ws: WebSocket;
    try { ws = new WebSocket(`ws://127.0.0.1:${lines[0].trim()}${lines[1].trim()}`); }
    catch (e) { return giveUp(`couldn't connect to ${name}'s DevTools port: ${(e as Error).message}`); }
    const ok = await new Promise<boolean>((resolve) => {
      const t = setTimeout(() => resolve(false), 10_000);
      ws.onopen = () => { clearTimeout(t); resolve(true); };
      ws.onerror = () => { clearTimeout(t); resolve(false); };
    });
    if (!ok) { try { ws.close(); } catch {} return giveUp(`couldn't connect to ${name}'s DevTools port`); }
    if (name !== 'Chrome' && name !== 'Chrome (CHROME_PATH)') console.log(`(Chrome not found: using ${name})`);
    return new Chrome(proc, ws, userDir, stderr);
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string, timeoutMs = CALL_TIMEOUT): Promise<any> {
    if (this.dead) return Promise.reject(this.dead);
    const id = ++this.nextId;
    const msg: Record<string, unknown> = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}: no answer from Chrome within ${timeoutMs / 1000} s${this.tail()}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, method, timer });
      this.ws.send(JSON.stringify(msg));
    });
  }

  once(method: string, sessionId: string | undefined, timeoutMs: number, what: string): Promise<any> {
    if (this.dead) return Promise.reject(this.dead);
    return new Promise((resolve, reject) => {
      const w: Waiter = {
        method, sessionId,
        resolve: (m) => { clearTimeout(t); resolve(m); },
        reject: (e) => { clearTimeout(t); reject(e); },
      };
      const t = setTimeout(() => {
        const i = this.waiters.indexOf(w);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error(`${what}: not loaded within ${timeoutMs / 1000} s${this.tail()}`));
      }, timeoutMs);
      this.waiters.push(w);
    });
  }

  on(l: (m: any) => void) { this.listeners.push(l); }

  async page(width: number, height: number, scale = 1): Promise<Page> {
    const { targetId } = await this.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true });
    const p = new Page(this, sessionId);
    await Promise.all([
      this.send('Page.enable', {}, sessionId),
      this.send('Network.enable', {}, sessionId),
      this.send('Runtime.enable', {}, sessionId),
    ]);
    await p.size(width, height, scale);
    return p;
  }

  async close() {
    try { this.ws.close(); } catch {}
    if (this.proc.exitCode === null) this.proc.kill();
    await Promise.race([this.proc.exited, Bun.sleep(5000)]);
    await cleanProfileAsync(this.userDir);
  }
}

function cleanProfile(dir: string) { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
async function cleanProfileAsync(dir: string) {
  // Windows keeps the profile's files locked for a moment after Chrome exits.
  for (let i = 0; i < 40; i++) {
    try { rmSync(dir, { recursive: true, force: true }); return; } catch { await Bun.sleep(100); }
  }
}

class Page {
  failures: string[] = [];
  private urls = new Map<string, string>();
  /** Every URL Chrome requested for the page, a redirect's first one too (its request then takes the next URL). */
  private requested = new Set<string>();
  constructor(private chrome: Chrome, private sessionId: string) {
    chrome.on((m) => {
      if (m.sessionId !== sessionId) return;
      if (m.method === 'Network.requestWillBeSent') { this.urls.set(m.params.requestId, m.params.request.url); this.requested.add(m.params.request.url); }
      else if (m.method === 'Network.responseReceived' && m.params.response.status >= 400)
        this.failed(`${m.params.response.status} ${shortUrl(m.params.response.url)}`);
      else if (m.method === 'Network.loadingFailed' && !m.params.canceled)
        this.failed(`${m.params.errorText} ${shortUrl(this.urls.get(m.params.requestId) ?? '')}`);
      else if (m.method === 'Runtime.exceptionThrown')
        this.failed(`script error: ${m.params.exceptionDetails?.exception?.description?.split('\n')[0] ?? m.params.exceptionDetails?.text}`);
    });
  }
  /** A failure, once (decoding a CSS image fetches it again, and a missing one fails again). */
  private failed(f: string) { if (!this.failures.includes(f)) this.failures.push(f); }
  size(width: number, height: number, scale = 1) {
    return this.chrome.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false }, this.sessionId);
  }
  async goto(url: string) {
    this.failures = [];
    this.urls.clear(); this.requested.clear();
    const loaded = this.chrome.once('Page.loadEventFired', this.sessionId, 60_000, shortUrl(url));
    const nav = await this.chrome.send('Page.navigate', { url }, this.sessionId);
    if (nav.errorText) throw new Error(`${shortUrl(url)}: ${nav.errorText}`);
    await loaded;
    // Fonts and two frames, so what the page shows is laid out and its images requested; then every image decoded
    // (a failure is reported, not hidden), then two frames: what the screenshot takes is what was laid out. Images
    // are <img>, SVG <image> and those CSS draws (a background, a mask, a border, a list marker, generated content,
    // on an element or its ::before and ::after): a broken one there loads fine and then draws nothing. Only what is
    // drawn counts: an image on a visible element with a box, or on a ::before or ::after that exists (a
    // display:contents element's too, which has no box of its own). A file there is decoded when Chrome requested
    // it for this page (decoding waits for a request still loading): it doesn't request an image-set() candidate it
    // didn't pick, and a url(#id) names an element of the page (an SVG mask), not a file. An inline data: image
    // isn't requested when broken, so it counts outside an image-set(), of whose candidates Chrome draws one
    // without saying which.
    await this.eval(`document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))`);
    const requested = JSON.stringify([...this.requested]);
    const undecoded = await this.eval<string[]>(`Promise.resolve()
      .then(() => {
        const urls = new Set();
        for (const i of document.querySelectorAll('image')) if (i.href.baseVal) urls.add(new URL(i.href.baseVal, document.baseURI).href);
        const fetched = new Set(${requested});
        fetched.delete(location.href.split('#')[0]); // (the page itself: a url(#id) names one of its elements)
        const shown = (e) => { for (; e; e = e.parentElement) if (getComputedStyle(e).display === 'none') return false; return true; };
        for (const el of document.querySelectorAll('*')) {
          const boxed = el.getClientRects().length > 0;
          const contents = !boxed && getComputedStyle(el).display === 'contents' && shown(el.parentElement);
          for (const pseudo of [null, '::before', '::after']) {
            const cs = getComputedStyle(el, pseudo);
            const drawn = pseudo ? (boxed || contents) && cs.display !== 'none' && !/^(none|normal)$/.test(cs.content) : boxed;
            if (!drawn || cs.visibility !== 'visible') continue;
            for (const prop of ['background-image', 'mask-image', '-webkit-mask-image', 'border-image-source', 'list-style-image', 'content']) {
              const v = cs.getPropertyValue(prop);
              for (const m of v.matchAll(/url\\("((?:[^"\\\\]|\\\\.)*)"\\)/g)) {
                const u = new URL(m[1].replace(/\\\\(.)/g, '$1'), document.baseURI).href;
                if (u.startsWith('data:')) { if (!/image-set\\(/.test(v)) urls.add(u); }
                else if (fetched.has(u.split('#')[0])) urls.add(u.split('#')[0]);
              }
            }
          }
        }
        const decode = (i, u) => i.decode().then(() => '', () => u);
        return Promise.all([
          ...Array.from(document.images, (i) => decode(i, i.currentSrc || i.src)),
          ...Array.from(urls, (u) => { const i = new Image(); i.src = u; return decode(i, u); }),
        ]);
      })
      .then((bad) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r([...new Set(bad.filter(Boolean))])))))`);
    for (const u of undecoded) this.failed(`image didn't decode: ${shortUrl(u)}`);
  }
  async eval<T = any>(expression: string): Promise<T> {
    const r = await this.chrome.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, this.sessionId);
    if (r.exceptionDetails) throw new Error(`page script: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result.value as T;
  }
  async shot(file: string, width: number, height: number, format: 'png' | 'jpeg' = 'png', quality = 90) {
    const r = await this.chrome.send('Page.captureScreenshot', {
      format, ...(format === 'jpeg' ? { quality } : {}), clip: { x: 0, y: 0, width, height, scale: 1 }, captureBeyondViewport: true,
    }, this.sessionId, 120_000);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, Buffer.from(r.data, 'base64'));
  }
}

function shortUrl(u: string): string {
  if (u.startsWith('data:')) return u.length > 48 ? u.slice(0, 45) + '...' : u; // (an inline image, maybe megabytes)
  try {
    const x = new URL(u);
    const p = decodeURIComponent(x.pathname);
    return p.startsWith('/__file/') ? files.get(p.slice(8)) ?? p : p.startsWith('/__page/') ? `(${p.slice(8)})` : x.host.startsWith('127.0.0.1') ? p.slice(1) : u;
  } catch { return u; }
}

// ---------------------------------------------------------------------------------------------------------------
// The local server: the folder at /, any other file the command was given at /__file/<n>, generated pages at /__page/

const files = new Map<string, string>();
const pages = new Map<string, string>();
function fileUrl(abs: string): string {
  if (inside(ROOT, abs)) return '/' + path.relative(ROOT, abs).split(path.sep).map(encodeURIComponent).join('/');
  const key = String(files.size);
  files.set(key, abs);
  return `/__file/${key}`;
}
let server: ReturnType<typeof Bun.serve> | undefined;
function serve(): string {
  server ??= Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req) {
      let p: string;
      try { p = decodeURIComponent(new URL(req.url).pathname); } catch { return new Response('bad path', { status: 400 }); }
      if (p === '/favicon.ico') return new Response(null, { status: 204 });
      if (p.startsWith('/__page/')) {
        const html = pages.get(p.slice(8));
        return html ? new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }) : new Response('no page', { status: 404 });
      }
      const abs = p.startsWith('/__file/') ? files.get(p.slice(8)) : path.resolve(ROOT, '.' + p);
      if (!abs || (!p.startsWith('/__file/') && !inside(ROOT, abs))) return new Response('outside the folder', { status: 403 });
      if (!existsSync(abs) || !statSync(abs).isFile()) return new Response('not found', { status: 404 });
      return new Response(Bun.file(abs));
    },
  });
  return `http://127.0.0.1:${server.port}`;
}

/** Runs a mode's browser work, and always stops Chrome and the server, however it ends. */
async function withChrome<T>(work: (chrome: Chrome, base: string) => Promise<T>): Promise<T> {
  const base = serve();
  try {
    const chrome = await Chrome.launch();
    try { return await work(chrome, base); }
    finally { await chrome.close(); }
  } finally { server?.stop(true); server = undefined; } // (a running server would keep the process alive)
}

// ---------------------------------------------------------------------------------------------------------------
// Helpers

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(2)} MB`;
const kb = (n: number) => (n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : mb(n));
function sizeOpt(s: string): [number, number] {
  const m = /^(\d+)x(\d+)$/.exec(s);
  if (!m) fail(`--size ${s}: use WIDTHxHEIGHT, e.g. 1280x720`);
  return [+m[1], +m[2]];
}
function readText(file: string): string { return readFileSync(file, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'); }
function chars(s: string): number { return [...s].length; }
function esc(s: string): string { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!)); }
function clock(sec: number): string {
  const s = Math.round(sec), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}
/** Seconds from "m:ss", "h:mm:ss" or a plain number; undefined for anything else, "0:99" included. */
function parseClock(s: string): number | undefined {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (m) {
    if (+m[3] > 59 || (m[1] !== undefined && +m[2] > 59)) return undefined;
    return (m[1] ? +m[1] * 3600 : 0) + +m[2] * 60 + +m[3];
  }
  return /^\d+(\.\d+)?$/.test(s.trim()) ? +s : undefined;
}
const IMAGE = /\.(png|jpe?g|webp|gif)$/i;
function thumbnailsIn(dir: string): string[] {
  return readdirSync(dir).filter((f) => /^thumbnail[-_ ]?\d+\.(png|jpe?g|webp|gif)$/i.test(f))
    .sort((a, b) => +(/\d+/.exec(a)![0]) - +(/\d+/.exec(b)![0]))
    .map((f) => path.join(dir, f));
}

/** An image's format and size from its header, without decoding it (what check falls back to without Chrome). */
function imageHeader(file: string): { kind: string; w?: number; h?: number } {
  const b = readFileSync(file);
  // (the format from its signature, the size only when the header is all there: a cut-off file is still that
  // format, and fails as one that doesn't decode)
  if (b.length >= 8 && b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return b.length > 24 ? { kind: 'PNG', w: b.readUInt32BE(16), h: b.readUInt32BE(20) } : { kind: 'PNG' };
  if (b.length >= 6 && b.toString('latin1', 0, 3) === 'GIF') return b.length > 10 ? { kind: 'GIF', w: b.readUInt16LE(6), h: b.readUInt16LE(8) } : { kind: 'GIF' };
  if (b.length > 30 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
    const f = b.toString('latin1', 12, 16);
    if (f === 'VP8X') return { kind: 'WebP', w: 1 + b.readUIntLE(24, 3), h: 1 + b.readUIntLE(27, 3) };
    if (f === 'VP8 ') return { kind: 'WebP', w: b.readUInt16LE(26) & 0x3fff, h: b.readUInt16LE(28) & 0x3fff };
    if (f === 'VP8L') { const v = b.readUInt32LE(21); return { kind: 'WebP', w: 1 + (v & 0x3fff), h: 1 + ((v >> 14) & 0x3fff) }; }
    return { kind: 'WebP' };
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker === 0xff) { i++; continue; } // a fill byte before the marker
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { i += 2; continue; } // markers without a length
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { kind: 'JPEG', h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
      i += 2 + b.readUInt16BE(i + 2);
    }
    return { kind: 'JPEG' };
  }
  return { kind: '' };
}

/** The package folder, the video and its project (in an audara project) and where previews go. The project is
 *  where the video was found, not above the package folder: that can be anywhere with --video. */
function locate(): { dir: string; video?: string; proj?: string; outDir: string } {
  const video = opt('video');
  // (a mistyped folder fails here, rather than the check quietly reading the folder above it)
  for (const p of positional) if (!existsSync(p)) fail(`${p}: no such folder or file`);
  const dirArg = positional.find((p) => statSync(p).isDirectory());
  if (video) {
    const vdir = path.join(ROOT, 'videos', video);
    if (!existsSync(path.join(vdir, 'video.json'))) fail(`--video ${video}: no videos/${video}/video.json in ${ROOT}`);
    return { dir: dirArg ? path.resolve(dirArg) : path.join(vdir, 'youtube'), video, proj: ROOT, outDir: path.resolve(opt('out', path.join(ROOT, 'out', video, 'youtube'))!) };
  }
  const first = dirArg ?? positional[0];
  const dir = first ? (existsSync(first) && statSync(first).isDirectory() ? path.resolve(first) : path.dirname(path.resolve(first))) : ROOT;
  // videos/<video>/youtube/ given as a path: the same as --video (and videos/<video>/youtube/<code>/, a language's)
  const m = /[\\/]videos[\\/]([^\\/]+)[\\/]youtube$/.exec(dir);
  if (m && existsSync(path.join(dir, '..', 'video.json'))) {
    const proj = path.resolve(dir, '..', '..', '..');
    return { dir, video: m[1], proj, outDir: path.resolve(opt('out', path.join(proj, 'out', m[1], 'youtube'))!) };
  }
  const ml = /[\\/]videos[\\/]([^\\/]+)[\\/]youtube[\\/][^\\/]+$/.exec(dir);
  if (ml && existsSync(path.join(dir, '..', '..', 'video.json'))) {
    const proj = path.resolve(dir, '..', '..', '..', '..');
    return { dir, video: ml[1], proj, outDir: path.resolve(opt('out', path.join(proj, 'out', ml[1], 'youtube'))!) };
  }
  return { dir, outDir: path.resolve(opt('out', path.join(dir, 'preview'))!) };
}

/** The video's length in seconds: --duration, else its final render, else as the engine resolves it. */
function videoLength(dir: string, video?: string, proj?: string): { seconds?: number; from: string } {
  const given = opt('duration');
  if (given) {
    const s = parseClock(given);
    if (s === undefined) fail(`--duration ${given}: use seconds (265.9) or m:ss (4:26)`);
    return { seconds: s, from: '--duration' };
  }
  const probe = (file: string) => {
    try {
      const r = Bun.spawnSync(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
      const s = parseFloat(r.stdout.toString());
      return r.exitCode === 0 && s > 0 ? s : undefined;
    } catch { return undefined; } // no ffprobe
  };
  if (video && proj) {
    const vdir = path.join(proj, 'videos', video);
    // the final render first: it is what gets uploaded
    const render = path.join(proj, 'out', video, `${video}.mp4`);
    if (existsSync(render)) { const s = probe(render); if (s) return { seconds: s, from: `out/${video}/${video}.mp4` }; }
    // then as the engine resolves it (src/engine/soundtrack.ts, resolveDuration): video.json's duration, the end
    // of a list of audio segments, data/audio.json's duration, the single audio file's own length
    const later = '(a render, once there, is read instead)';
    try {
      const vj = JSON.parse(readText(path.join(vdir, 'video.json')));
      if (typeof vj.duration === 'number' && vj.duration > 0) return { seconds: vj.duration, from: `video.json ${later}` };
      if (Array.isArray(vj.audio) && vj.audio.length) {
        const end = Math.max(...vj.audio.map((s: { at?: number; dur?: number }) => (+(s?.at ?? 0) || 0) + (+(s?.dur ?? 0) || 0)));
        if (end > 0) return { seconds: end, from: `video.json's audio segments ${later}` };
      }
      const data = path.join(vdir, 'data', 'audio.json');
      if (existsSync(data)) {
        try { const d = JSON.parse(readText(data)); if (typeof d.duration === 'number' && d.duration > 0) return { seconds: d.duration, from: `data/audio.json ${later}` }; } catch {}
      }
      if (typeof vj.audio === 'string') {
        const a = path.resolve(vdir, vj.audio);
        if (existsSync(a)) { const s = probe(a); if (s) return { seconds: s, from: `its audio, ${vj.audio} ${later}` }; }
      }
    } catch {}
  }
  const media = existsSync(dir) ? readdirSync(dir).find((f) => /\.(mp4|mov|mkv|webm)$/i.test(f)) : undefined;
  if (media) { const s = probe(path.join(dir, media)); if (s) return { seconds: s, from: media }; }
  return { from: 'unknown (pass --duration)' };
}

// ---------------------------------------------------------------------------------------------------------------
// shoot

type TextBlock = { text: string; size: number; x: number; y: number; w: number; h: number; family: string; fellBack: boolean; missing: string };

const MEASURE_TEXT = `(() => {
  // Each element's own text, with its type size after any transform, whether its typeface drew it, and which of
  // its characters the typeface lacks (drawn by a fallback). Boxes are layout boxes: strokes and shadows go past.
  const c = document.createElement('canvas').getContext('2d');
  const blocks = new Map();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.textContent.replace(/\\s+/g, ' ').trim();
    if (!text) continue;
    const el = n.parentElement, cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || el.closest('[hidden]')) continue;
    let op = 1; for (let e = el; e; e = e.parentElement) op *= +getComputedStyle(e).opacity;
    if (op < 0.05) continue;
    const range = document.createRange(); range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    let b = blocks.get(el);
    if (!b) {
      const scale = el.offsetWidth ? el.getBoundingClientRect().width / el.offsetWidth : 1;
      const family = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
      b = { text: '', size: parseFloat(cs.fontSize) * scale, x1: 1e9, y1: 1e9, x2: -1e9, y2: -1e9, family, font: cs.fontStyle + ' ' + cs.fontWeight };
      blocks.set(el, b);
    }
    b.text += (b.text ? ' ' : '') + text;
    b.x1 = Math.min(b.x1, r.left); b.y1 = Math.min(b.y1, r.top); b.x2 = Math.max(b.x2, r.right); b.y2 = Math.max(b.y2, r.bottom);
  }
  const generic = /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-[a-z-]+)$/i;
  // A face that lacks a character draws it in the next one: measured against two generic faces, the width then
  // equals each generic's own, and so do the pixels. (Widths alone aren't enough: every Chinese, Japanese and Korean
  // face draws its characters a square wide, so a face that has them measures as the fallback does.)
  const ink = (f, s) => {
    const k = document.createElement('canvas').getContext('2d');
    k.font = f; const w = Math.min(4000, Math.ceil(k.measureText(s).width) + 8);
    k.canvas.width = w; k.canvas.height = 160; k.font = f; k.textBaseline = 'alphabetic'; k.fillText(s, 4, 118);
    const d = k.getImageData(0, 0, w, 160).data; let h = 0;
    for (let i = 3; i < d.length; i += 4) h = (h * 31 + d[i]) | 0;
    return h;
  };
  const lacks = (font, family, s) => {
    const w = (f) => { c.font = font + ' 100px ' + f; return c.measureText(s).width; };
    if (w('"' + family + '", monospace') !== w('monospace') || w('"' + family + '", serif') !== w('serif')) return false;
    return ink(font + ' 100px "' + family + '", monospace', s) === ink(font + ' 100px monospace', s)
      && ink(font + ' 100px "' + family + '", serif', s) === ink(font + ' 100px serif', s);
  };
  const failed = Array.from(document.fonts).filter((f) => f.status === 'error').map((f) => f.family.replace(/["']/g, ''));
  return { failed, blocks: Array.from(blocks.values(), (b) => {
    const isGeneric = generic.test(b.family);
    const fellBack = !isGeneric && lacks(b.font, b.family, b.text);
    const missing = isGeneric || fellBack ? '' : [...new Set(b.text.replace(/\\s/g, ''))].filter((ch) => lacks(b.font, b.family, ch)).join('');
    return { text: b.text, size: b.size, x: b.x1, y: b.y1, w: b.x2 - b.x1, h: b.y2 - b.y1, family: b.family, fellBack, missing };
  }) };
})()`;

async function shoot() {
  if (!positional.length) fail('shoot needs at least one HTML page: bun <skill>/scripts/youtube.ts shoot videos/<video>/youtube/thumbnail-1.html');
  const [W, H] = sizeOpt(opt('size', '1280x720')!);
  const scale = +opt('scale', '1')!;
  if (!(scale >= 0.5 && scale <= 4)) fail(`--scale ${opt('scale')}: use a number from 0.5 to 4`);
  const jpg = opts.has('jpg') ? +opt('jpg')! : 0;
  if (jpg && !(jpg >= 1 && jpg <= 100)) fail(`--jpg ${jpg}: a quality from 1 to 100`);
  const ext = jpg ? '.jpg' : '.png';
  const out = opt('out');
  const sources = positional.map((p) => path.resolve(p));
  for (const s of sources) {
    if (!/\.html?$/i.test(s)) fail(`${s}: shoot takes HTML pages (.html), so the image written beside it can't replace a source`);
    if (!existsSync(s)) fail(`${s}: no such page`);
    if (!inside(ROOT, s)) fail(`${s} is outside the folder this runs in (${ROOT}): run it from the project folder, or pass --root`);
  }
  const outIsFile = out !== undefined && /\.(png|jpe?g)$/i.test(out);
  if (outIsFile && sources.length > 1) fail('--out names one file, but there are several pages: give a folder');
  if (outIsFile && /\.jpe?g$/i.test(out!) !== Boolean(jpg)) fail(`--out ${out}: its extension doesn't match the format (${jpg ? 'JPEG with --jpg' : 'PNG without --jpg'})`);
  const dests = sources.map((src) => out ? (outIsFile ? path.resolve(out) : path.join(path.resolve(out), path.basename(src).replace(/\.html?$/i, ext))) : src.replace(/\.html?$/i, ext));
  // (two pages with one name, into one folder, would overwrite each other: refused before anything is drawn;
  // Windows and macOS don't tell A.png from a.png, Linux does)
  const same = (a: string, b: string) => process.platform === 'linux' ? a === b : a.toLowerCase() === b.toLowerCase();
  const clash = dests.filter((d, i) => dests.findIndex((e) => same(e, d)) !== i);
  if (clash.length) fail(`two pages would write the same image (${[...new Set(clash)].map((d) => path.relative(ROOT, d)).join(', ')}): rename one, or shoot them into separate folders`);
  // errors: the image isn't what the page asked for (a file missing, a face not drawing); notes: advice
  let errors = 0, notes = 0;
  await withChrome(async (chrome, base) => {
    const page = await chrome.page(W, H, scale);
    for (const [i, src] of sources.entries()) {
      const dest = dests[i];
      await page.goto(base + fileUrl(src));
      const { failed, blocks } = await page.eval<{ failed: string[]; blocks: TextBlock[] }>(MEASURE_TEXT);
      await page.shot(dest, W, H, jpg ? 'jpeg' : 'png', jpg || 90);
      const bytes = statSync(dest).size;
      console.log(`${path.relative(ROOT, dest)}: ${Math.round(W * scale)}x${Math.round(H * scale)}, ${kb(bytes)}${bytes > MOBILE_UPLOAD_BYTES ? `  (over 2 MB: the YouTube app can't upload it, Studio on a computer can; --jpg 90 makes it smaller)` : ''}`);
      const k = SMALLEST / W;
      for (const b of blocks) {
        const small = b.size * k;
        const corner = b.x + b.w > W * BADGE_CORNER.x && b.y + b.h > H * BADGE_CORNER.y;
        const wrong = [
          b.fellBack ? `looks drawn by a fallback face, not "${b.family}"` : '',
          b.missing ? `"${b.family}" seems to lack ${[...b.missing].map((ch) => `"${ch}"`).join(' ')} (drawn by a fallback face: look)` : '',
        ].filter(Boolean);
        const advice = [
          small < SMALLEST_READABLE ? `under ${SMALLEST_READABLE} px at ${SMALLEST} wide: likely too small to read there` : '',
          corner ? 'its box enters the duration badge\'s corner (see the preview)' : '',
        ].filter(Boolean);
        errors += wrong.length; notes += advice.length;
        const flags = [...wrong, ...advice];
        const text = b.text.length > 48 ? b.text.slice(0, 45) + '...' : b.text;
        console.log(`  text "${text}": ${Math.round(b.size)} px type, ${small.toFixed(1)} px at ${SMALLEST} wide, ${b.family}${flags.length ? `  <- ${flags.join('; ')}` : ''}`);
      }
      if (!blocks.length) console.log('  no live text (words inside images or canvases aren\'t measured: look at them)');
      for (const f of failed) { errors++; console.log(`  font "${f}" failed to load (check its url() path)`); }
      for (const f of page.failures) { errors++; console.log(`  failed: ${f}`); }
    }
  });
  if (errors) console.log(`${errors} problem line(s) above: the image isn't what the page asks for (it was written anyway). Exit 1.`);
  else if (notes) console.log(`${notes} note(s) above to look at in the preview.`);
  if (errors) process.exit(1);
}

// ---------------------------------------------------------------------------------------------------------------
// preview

const THEMES = {
  dark: { bg: '#0f0f0f', text: '#f1f1f1', meta: '#aaaaaa', card: '#272727', bar: '#3f3f3f' },
  light: { bg: '#ffffff', text: '#0f0f0f', meta: '#606060', card: '#f2f2f2', bar: '#dcdcdc' },
} as const;
type Theme = keyof typeof THEMES;
const WORDS = {
  en: { views: '12K views', age: '2 days ago', option: 'Option', home: 'Home', upnext: 'Up next', phone: 'Phone', search: 'Search', classic: 'classic', playlist: 'Playlist' },
  pt: { views: '12 mil visualizações', age: 'há 2 dias', option: 'Opção', home: 'Início', upnext: 'A seguir', phone: 'Celular', search: 'Busca', classic: 'clássico', playlist: 'Playlist' },
  es: { views: '12 k visualizaciones', age: 'hace 2 días', option: 'Opción', home: 'Inicio', upnext: 'A continuación', phone: 'Teléfono', search: 'Búsqueda', classic: 'clásico', playlist: 'Lista' },
};
type Lang = keyof typeof WORDS;

type Other = { src?: string; title?: string; channel?: string; views?: string; duration?: string };

/** The other videos for the feeds, from a folder of images (and its niche.json). */
function nicheFolder(dirOpt?: string): { others: Other[]; note: string } {
  if (!dirOpt) return { others: [], note: 'no --niche: the other videos are placeholders, so this shows legibility and the title\'s fit, not how the options stand out' };
  const dir = path.resolve(dirOpt);
  if (!existsSync(dir)) fail(`--niche ${dirOpt}: no such folder`);
  const meta = path.join(dir, 'niche.json');
  let others: Other[] = [];
  if (existsSync(meta)) {
    let list: any;
    try { list = JSON.parse(readText(meta)); } catch (e) { fail(`${meta}: not valid JSON (${(e as Error).message})`); }
    if (!Array.isArray(list)) fail(`${meta}: expected a list of {"file", "title", "channel", "views", "duration"}`);
    others = list.filter((o: any) => o?.file && existsSync(path.join(dir, o.file)))
      .map((o: any) => ({ src: fileUrl(path.join(dir, o.file)), title: o.title, channel: o.channel, views: o.views, duration: o.duration }));
  } else {
    others = readdirSync(dir).filter((f) => IMAGE.test(f)).sort().map((f) => ({ src: fileUrl(path.join(dir, f)) }));
  }
  if (!others.length) fail(`--niche ${dirOpt}: no images there`);
  const titled = others.every((o) => o.title);
  return { others, note: titled ? `${others.length} other videos from ${path.relative(ROOT, dir) || '.'}` : `${others.length} other videos without titles (no niche.json): their title lines are grey bars, so the comparison favours yours` };
}

// (single quotes only: it goes inside style="..." attributes)
const FONT_UI = `Roboto, Arial, 'Helvetica Neue', sans-serif`;

function thumbHtml(src: string | undefined, w: number, duration: string, radius: number, theme: Theme): string {
  const h = Math.round(w * 9 / 16);
  const t = THEMES[theme];
  const img = src ? `<img src="${src}" style="width:${w}px;height:${h}px;object-fit:cover;display:block;border-radius:${radius}px">`
    : `<div style="width:${w}px;height:${h}px;border-radius:${radius}px;background:linear-gradient(135deg,${t.card},${t.bar})"></div>`;
  // YouTube's badge: 12 px medium white on 80% black, about 8 px from the corner (4 in the smallest places).
  const inset = w >= 200 ? 8 : 4, lh = w >= 200 ? 20 : 18;
  const badge = duration ? `<span style="position:absolute;right:${inset}px;bottom:${inset}px;background:rgba(0,0,0,.8);color:#fff;font:500 12px/${lh}px ${FONT_UI};padding:0 4px;border-radius:4px">${esc(duration)}</span>` : '';
  return `<div style="position:relative;width:${w}px;height:${h}px;flex:none">${img}${badge}</div>`;
}

function titleHtml(title: string | undefined, size: number, line: number, color: string, bar: string, cls: string, weight = 500, lines = 2): string {
  if (title) return `<div class="${cls}" style="font:${weight} ${size}px/${line}px ${FONT_UI};color:${color};display:-webkit-box;-webkit-line-clamp:${lines};-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere">${esc(title)}</div>`;
  return `<div style="height:${line * 2}px;display:flex;flex-direction:column;gap:${line - size}px;padding-top:4px"><div style="height:${size - 4}px;width:95%;background:${bar};border-radius:3px"></div><div style="height:${size - 4}px;width:60%;background:${bar};border-radius:3px"></div></div>`;
}

function pageHtml(theme: Theme, width: number, body: string): string {
  const t = THEMES[theme];
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;background:${t.bg};color:${t.text};font-family:${FONT_UI}}
    body{width:${width}px;padding:24px;box-sizing:border-box}
    .label{font:500 20px/28px ${FONT_UI};color:${t.text};margin:0 0 4px}
    .label span{color:${t.meta};font-weight:400;font-size:16px;margin-left:10px}
    .sub{font:400 13px/18px ${FONT_UI};color:${t.meta};margin:14px 0 8px}
    .row{display:flex;gap:16px;align-items:flex-start}
    .meta{font:400 14px/20px ${FONT_UI};color:${t.meta}}
    .meta12{font:400 12px/18px ${FONT_UI};color:${t.meta}}
    .avatar{width:36px;height:36px;border-radius:50%;background:${t.bar};flex:none;display:flex;align-items:center;justify-content:center;font:500 15px ${FONT_UI};color:${t.meta}}
    .section{padding:8px 0 22px;border-bottom:1px solid ${t.bar};margin-bottom:18px}
  </style></head><body data-width="${width}">${body}</body></html>`;
}

async function preview() {
  const { dir, video, proj, outDir } = locate();
  const given = positional.filter((p) => IMAGE.test(p)).map((p) => path.resolve(p));
  const thumbs = given.length ? given : existsSync(dir) ? thumbnailsIn(dir) : [];
  if (!thumbs.length) fail(`no thumbnails: put thumbnail-1.png ... in ${path.relative(ROOT, dir) || dir}, or name the images`);
  for (const t of thumbs) if (!existsSync(t)) fail(`${t}: no such image`);
  const titleFile = path.join(dir, 'title.txt');
  const title = opt('title') ?? (existsSync(titleFile) ? readText(titleFile).trim().split('\n')[0] : undefined);
  if (!title) fail(`no title: pass --title "..." or write ${path.relative(ROOT, titleFile)}`);
  const descFile = path.join(dir, 'description.txt');
  const description = existsSync(descFile) ? readText(descFile).trim() : '';
  const channel = opt('channel', 'Channel')!;
  const lang = opt('lang', /[ãõçáéíóúâêô]/i.test(title + description.slice(0, 300)) ? 'pt' : 'en') as Lang;
  if (!WORDS[lang]) fail(`--lang ${lang}: use ${Object.keys(WORDS).join(', ')}`);
  const w = WORDS[lang];
  const len = videoLength(dir, video, proj);
  const duration = len.seconds ? clock(len.seconds) : '';
  const { others, note } = nicheFolder(opt('niche'));
  const ours = thumbs.map((t) => fileUrl(t));
  let pick = 0;
  const other = (): Other => (others.length ? others[pick++ % others.length] : {});

  // sizes.png: every option at every review width, on both pages (the finished image, scaled down)
  const where = [w.search, w.home, w.upnext, `${w.upnext} (${w.classic})`, w.playlist];
  const sizesBody = (['dark', 'light'] as Theme[]).map((theme) => {
    const t = THEMES[theme];
    const head = `<div class="row" style="margin-bottom:8px"><div style="width:84px;flex:none"></div>
      ${REVIEW_WIDTHS.map((px, i) => `<div class="meta12" style="width:${px}px;flex:none">${esc(where[i])} · ${px}</div>`).join('')}</div>`;
    const rows = ours.map((src, i) => `<div class="row" style="align-items:flex-end;margin-bottom:16px">
      <div style="width:84px;flex:none;font:500 14px ${FONT_UI};color:${t.meta}">${w.option} ${i + 1}</div>
      ${REVIEW_WIDTHS.map((px) => thumbHtml(src, px, duration, px >= 300 ? 12 : 8, theme)).join('')}</div>`).join('');
    return `<div style="background:${t.bg};padding:16px 20px 4px;border-radius:12px">${head}${rows}</div>`;
  }).join('');
  const sizesWidth = 84 + REVIEW_WIDTHS.reduce((a, b) => a + b + 16, 0) + 2 * 24 + 40;
  pages.set('sizes', pageHtml('dark', sizesWidth, `<div style="display:flex;flex-direction:column;gap:16px">${sizesBody}</div>`));

  // feed-<theme>.png: each option in a home row, an up-next column and a phone feed
  const feed = (theme: Theme) => {
    const t = THEMES[theme];
    pick = 0;
    // (another video shows its own duration when niche.json gives it, else no badge)
    const homeCard = (o: Other, cls: string) => `<div style="width:344px;flex:none">${thumbHtml(o.src, 344, o.duration ?? '', 12, theme)}
      <div style="display:flex;gap:12px;margin-top:12px"><div class="avatar">${esc((o.channel ?? '').slice(0, 1).toUpperCase())}</div>
      <div style="flex:1;min-width:0">${titleHtml(o.title, 16, 22, t.text, t.bar, cls)}<div class="meta" style="margin-top:4px">${esc(o.channel ?? '')}</div><div class="meta">${esc(o.views ?? '')}</div></div></div></div>`;
    // (today's up-next column: the title beside the picture, three lines at most)
    const nextItem = (o: Other, cls: string) => `<div style="display:flex;gap:12px;margin-bottom:8px">${thumbHtml(o.src, 250, o.duration ?? '', 8, theme)}
      <div style="width:160px">${titleHtml(o.title, 14, 20, t.text, t.bar, cls, 500, 3)}<div class="meta12" style="margin-top:4px">${esc(o.channel ?? '')}</div><div class="meta12">${esc(o.views ?? '')}</div></div></div>`;
    const phoneItem = (o: Other, cls: string) => `<div style="width:390px;margin-bottom:14px">${thumbHtml(o.src, 390, o.duration ?? '', 0, theme)}
      <div style="display:flex;gap:12px;padding:10px 12px 0"><div class="avatar">${esc((o.channel ?? '').slice(0, 1).toUpperCase())}</div>
      <div style="flex:1;min-width:0">${titleHtml(o.title, 14, 20, t.text, t.bar, cls)}<div class="meta12" style="margin-top:2px">${esc([o.channel, o.views].filter(Boolean).join(' · '))}</div></div></div></div>`;
    // (ours shows no view count: an invented one reads as real data; the other videos keep theirs)
    const me: Other = { title, channel, duration };
    const sections = ours.map((src, i) => {
      pick = 0; // every option meets the same videos, in the same places
      const mine = { ...me, src };
      const home = [other(), mine, other()];
      const next = [other(), mine, other(), other()];
      const phone = [mine, other()]; // a phone shows about one and a half videos: the next one is cut off below
      return `<div class="section"><div class="label">${w.option} ${i + 1}</div>
        <div class="row" style="gap:32px">
          <div><div class="sub">${w.home} · 344 px</div><div class="row">${home.map((o) => homeCard(o, o === mine ? 'mine home' : '')).join('')}</div></div>
          <div><div class="sub">${w.upnext} · 250 px</div>${next.map((o) => nextItem(o, o === mine ? 'mine upnext' : '')).join('')}</div>
          <div><div class="sub">${w.phone} · 390 px</div><div style="height:430px;overflow:hidden">${phone.map((o) => phoneItem(o, o === mine ? 'mine phone' : '')).join('')}</div></div>
        </div></div>`;
    }).join('');
    return pageHtml(theme, (3 * 344 + 2 * 16) + 32 + (250 + 12 + 160) + 32 + 390 + 48, sections);
  };
  pages.set('feed-dark', feed('dark'));
  pages.set('feed-light', feed('light'));

  // search.png: a search result on a computer shows the title at 18 px and about the description's first 130
  // characters, cut by YouTube with " ..." (a phone's search shows none of it)
  const flat = description.split('\n').filter((l) => l.trim()).join(' ');
  const SNIPPET = 130;
  const firstLines = chars(flat) > SNIPPET ? [...flat].slice(0, SNIPPET).join('').replace(/\s+\S*$/, '') + ' ...' : flat;
  const t = THEMES.dark;
  const searchRows = ours.map((src, i) => `<div class="section"><div class="label">${w.option} ${i + 1}<span>${w.search} · 500 px</span></div>
    <div class="row" style="margin-top:10px">${thumbHtml(src, 500, duration, 12, 'dark')}
    <div style="width:560px">${titleHtml(title, 18, 26, t.text, t.bar, 'mine search', 400)}
    <div style="height:10px;width:150px;background:${t.bar};border-radius:3px;margin-top:9px"></div>
    <div class="row" style="gap:8px;align-items:center;margin:12px 0"><div class="avatar" style="width:24px;height:24px;font-size:11px">${esc(channel.slice(0, 1).toUpperCase())}</div><span class="meta12">${esc(channel)}</span></div>
    <div class="meta12" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(firstLines || '(no description.txt yet)')}</div></div></div></div>`).join('');
  pages.set('search', pageHtml('dark', 24 * 2 + 500 + 16 + 560, searchRows));

  const cut = new Map<string, Set<string>>();
  const failures: string[] = [];
  await withChrome(async (chrome, base) => {
    const page = await chrome.page(1600, 900, 1);
    for (const name of ['sizes', 'feed-dark', 'feed-light', 'search']) {
      const width = +(/data-width="(\d+)"/.exec(pages.get(name)!)?.[1] ?? 1600);
      await page.size(width, 900, 1);
      await page.goto(`${base}/__page/${name}`);
      const height = await page.eval<number>('Math.ceil(document.documentElement.scrollHeight)');
      await page.size(width, height, 1);
      // Which places cut the title: a clamped title whose text runs past its two lines.
      for (const where of await page.eval<string[]>(`Array.from(document.querySelectorAll('.mine'), (e) => e.scrollHeight > e.clientHeight + 1 ? e.className.split(' ')[1] : '').filter(Boolean)`))
        (cut.get(where) ?? cut.set(where, new Set()).get(where)!).add(name);
      const file = path.join(outDir, `${name}.png`);
      await page.shot(file, width, height);
      console.log(`${path.relative(ROOT, file) || file}: ${width}x${height}`);
      for (const f of page.failures) if (!failures.includes(f)) failures.push(f);
    }
  });
  for (const f of failures) console.log(`  failed: ${f}`);
  if (failures.length) process.exitCode = 1;
  console.log(`title (${chars(title)} characters): ${cut.size ? `cut short in ${[...cut.keys()].join(', ')} (two lines at most there)` : 'whole everywhere shown'}`);
  console.log(`duration badge: ${duration || 'none'} (${len.from}); ${note}`);
  console.log('titles are set in Roboto where it\'s installed, else Arial, so where a long title breaks can differ from YouTube\'s by a word.');
}

// ---------------------------------------------------------------------------------------------------------------
// niche: other videos for the preview, through YouTube's own endpoints (oEmbed; the Data API with a key)

const YT_API = process.env.YOUTUBE_API_URL || 'https://www.googleapis.com/youtube/v3'; // (another base: a proxy, or the tests' mock)

/** The 11-character id in a YouTube link (watch, youtu.be, shorts, embed, live) or given alone. */
function videoId(s: string): string | undefined {
  const t = s.trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(t)) return t;
  try {
    const u = new URL(t);
    if (/(^|\.)youtu\.be$/.test(u.hostname)) return /^\/([A-Za-z0-9_-]{11})/.exec(u.pathname)?.[1];
    if (/(^|\.)youtube(-nocookie)?\.com$/.test(u.hostname)) {
      const v = u.searchParams.get('v');
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
      return /^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/.exec(u.pathname)?.[1];
    }
  } catch {}
  return undefined;
}

/** A channel's @handle or UC... id, from a link or given alone. Handles can hold any letter (@ciência), and
 *  a link may carry them percent-encoded, so the path is decoded first, not matched with \w. */
function channelOf(arg: string): { handle?: string; cid?: string } {
  const decode = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
  let parts: string[];
  try { parts = decode(new URL(arg).pathname).split('/').filter(Boolean); }
  catch { parts = decode(arg.trim()).split(/[/?#]/).filter(Boolean); } // (a link without https://, or a bare handle)
  const handle = parts.find((p) => p.startsWith('@') && p.length > 1);
  const cid = parts[0] === 'channel' ? parts[1] : parts.find((p) => /^UC[\w-]{22}$/.test(p));
  return { handle, cid };
}

function isoDuration(iso?: string): string | undefined {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso ?? '');
  return m ? clock(+(m[1] ?? 0) * 3600 + +(m[2] ?? 0) * 60 + +(m[3] ?? 0)) : undefined;
}

/** A ratio as it reads: 12x, 3.4x, 0.25x. */
function multiple(r: number): number {
  return r >= 10 ? Math.round(r) : r >= 1 ? Math.round(r * 10) / 10 : Math.round(r * 100) / 100;
}

function views(n: number, lang: Lang): string {
  const locale = { en: 'en', pt: 'pt-BR', es: 'es' }[lang];
  const short = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  return { en: `${short} views`, pt: `${short} visualizações`, es: `${short} visualizaciones` }[lang];
}

async function getJson(url: string, what: string): Promise<any> {
  let r: Response;
  try { r = await fetch(url, { signal: AbortSignal.timeout(20_000) }); }
  catch (e) { throw new Error(`${what}: no answer (${(e as Error).message}); a sandbox may need the network allowed for this command`); }
  const body = await r.text();
  if (!r.ok) {
    let why = body.slice(0, 160);
    try { why = JSON.parse(body).error?.message ?? why; } catch {}
    throw new Error(`${what}: HTTP ${r.status} ${why}`);
  }
  return JSON.parse(body);
}

async function niche() {
  const key = process.env.YOUTUBE_API_KEY;
  const search = opt('search'), channelArg = opt('channel');
  const count = Math.max(1, Math.min(50, Math.round(+opt('n', '20')!) || 20));
  const lang = opt('lang', 'en') as Lang;
  if (!WORDS[lang]) fail(`--lang ${lang}: use ${Object.keys(WORDS).join(', ')}`);
  const ids: string[] = [];
  for (const p of positional) {
    const id = videoId(p);
    if (!id) fail(`${p}: not a YouTube video link or id`);
    ids.push(id);
  }
  if ((search || channelArg) && !key) fail('--search and --channel use the YouTube Data API: set YOUTUBE_API_KEY (a free key from https://console.cloud.google.com with "YouTube Data API v3" enabled; a search costs 100 of the 10,000 daily units). Without one, pass video links: the user\'s, or found with a web search.');
  if (!ids.length && !search && !channelArg) fail('niche needs video links or ids, --search "<words>" or --channel <@handle> (see --help)');
  if (search) {
    const q = new URLSearchParams({ part: 'snippet', type: 'video', maxResults: String(count), q: search, key: key! });
    if (opts.has('lang')) q.set('relevanceLanguage', lang);
    if (opt('region')) q.set('regionCode', opt('region')!);
    for (const it of (await getJson(`${YT_API}/search?${q}`, 'YouTube search')).items ?? []) if (it.id?.videoId) ids.push(it.id.videoId);
  }
  if (channelArg) {
    const { handle, cid } = channelOf(channelArg);
    if (!handle && !cid) fail(`--channel ${channelArg}: give its @handle or its /channel/UC... link`);
    const c = await getJson(`${YT_API}/channels?${new URLSearchParams({ part: 'contentDetails', ...(cid ? { id: cid } : { forHandle: handle! }), key: key! })}`, 'YouTube channel');
    const uploads = c.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploads) fail(`--channel ${channelArg}: YouTube found no such channel`);
    const pl = await getJson(`${YT_API}/playlistItems?${new URLSearchParams({ part: 'contentDetails', playlistId: uploads, maxResults: String(count), key: key! })}`, 'the channel\'s uploads');
    for (const it of pl.items ?? []) if (it.contentDetails?.videoId) ids.push(it.contentDetails.videoId);
  }
  const unique = [...new Set(ids)];
  type Meta = { title?: string; channel?: string; channelId?: string; viewCount?: number; duration?: string; thumb?: string; big?: string; published?: string };
  const metas = new Map<string, Meta>();
  // a channel's size: subscribers (undefined when hidden) and its average views per video over its life
  const channels = new Map<string, { subscribers?: number; average?: number }>();
  if (key) {
    for (let i = 0; i < unique.length; i += 50) {
      const q = new URLSearchParams({ part: 'snippet,statistics,contentDetails', id: unique.slice(i, i + 50).join(','), key });
      for (const v of (await getJson(`${YT_API}/videos?${q}`, 'YouTube videos')).items ?? []) {
        const th = v.snippet?.thumbnails ?? {};
        metas.set(v.id, {
          title: v.snippet?.title, channel: v.snippet?.channelTitle, channelId: v.snippet?.channelId,
          viewCount: v.statistics?.viewCount !== undefined ? +v.statistics.viewCount : undefined,
          duration: isoDuration(v.contentDetails?.duration), thumb: (th.maxres ?? th.medium ?? th.high)?.url,
          big: th.maxres?.url, published: v.snippet?.publishedAt,
        });
      }
    }
    const cids = [...new Set([...metas.values()].map((m) => m.channelId).filter((c): c is string => !!c))];
    for (let i = 0; i < cids.length; i += 50) {
      const q = new URLSearchParams({ part: 'statistics', id: cids.slice(i, i + 50).join(','), key });
      for (const c of (await getJson(`${YT_API}/channels?${q}`, 'YouTube channels')).items ?? []) {
        const s = c.statistics ?? {};
        const subs = !s.hiddenSubscriberCount && s.subscriberCount !== undefined ? +s.subscriberCount : undefined;
        const average = +s.videoCount > 0 && s.viewCount !== undefined ? +s.viewCount / +s.videoCount : undefined;
        channels.set(c.id, { subscribers: subs || undefined, average: average || undefined });
      }
    }
  } else {
    for (const id of unique) {
      try {
        const j = await getJson(`https://www.youtube.com/oembed?${new URLSearchParams({ url: `https://www.youtube.com/watch?v=${id}`, format: 'json' })}`, `oEmbed for ${id}`);
        metas.set(id, { title: j.title, channel: j.author_name, thumb: j.thumbnail_url });
      } catch (e) { console.log(`  ${id}: skipped (${(e as Error).message})`); }
    }
  }
  const video = opt('video');
  const outDir = path.resolve(opt('out', video ? path.join(ROOT, 'out', video, 'youtube', 'niche') : path.join(ROOT, 'niche'))!);
  mkdirSync(outDir, { recursive: true });
  const listFile = path.join(outDir, 'niche.json');
  let list: Record<string, unknown>[] = [];
  if (existsSync(listFile)) {
    try { list = JSON.parse(readText(listFile)); } catch (e) { fail(`${listFile}: not valid JSON (${(e as Error).message})`); }
  }
  const have = new Map(list.filter((o) => typeof o.id === 'string').map((o) => [o.id as string, o]));
  const added: Record<string, unknown>[] = [], updated: Record<string, unknown>[] = [];
  for (const id of unique) {
    const m = metas.get(id);
    if (!m) continue;
    // how it did against its channel: its views as a multiple of the channel's average per video and of its subscribers
    const ch = m.channelId ? channels.get(m.channelId) : undefined;
    const against = m.viewCount === undefined || !ch ? {} : {
      ...(ch.average ? { channelAverage: Math.round(ch.average), vsChannel: multiple(m.viewCount / ch.average) } : {}),
      ...(ch.subscribers ? { subscribers: ch.subscribers, vsSubscribers: multiple(m.viewCount / ch.subscribers) } : {}),
    };
    const fresh: Record<string, unknown> = Object.fromEntries(Object.entries({
      url: `https://www.youtube.com/watch?v=${id}`, title: m.title, channel: m.channel, viewCount: m.viewCount,
      views: m.viewCount !== undefined ? views(m.viewCount, lang) : undefined, duration: m.duration, published: m.published?.slice(0, 10), ...against,
    }).filter(([, v]) => v !== undefined));
    // a video already in the folder takes what this run read (a run with a key after one without adds the numbers;
    // a new reading replaces the old comparison), and keeps its picture when the file is there
    const old = have.get(id);
    if (old && m.viewCount !== undefined) for (const k of ['channelAverage', 'vsChannel', 'subscribers', 'vsSubscribers']) delete old[k];
    if (old && typeof old.file === 'string' && existsSync(path.join(outDir, old.file))) { Object.assign(old, fresh); updated.push(old); continue; }
    // the biggest 16:9 picture there is (a 4:3 one has bars, which the preview's crop removes)
    let file: string | undefined;
    for (const u of new Set([m.big, `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`, `https://i.ytimg.com/vi/${id}/hq720.jpg`, m.thumb, `https://i.ytimg.com/vi/${id}/mqdefault.jpg`])) {
      if (!u) continue;
      try {
        const r = await fetch(u, { signal: AbortSignal.timeout(20_000) });
        if (!r.ok) continue;
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length < 2000) continue; // the small grey stand-in YouTube serves for a size a video lacks
        file = `${id}.jpg`;
        writeFileSync(path.join(outDir, file), buf);
        break;
      } catch {}
    }
    if (!file) { console.log(`  ${id}: no picture could be fetched`); continue; }
    if (old) { Object.assign(old, { file }, fresh); updated.push(old); continue; }
    const entry = { file, id, ...fresh };
    list.push(entry);
    added.push(entry);
  }
  writeFileSync(listFile, JSON.stringify(list, null, 2) + '\n');
  console.log(`${path.relative(ROOT, listFile) || listFile}: ${added.length} added, ${updated.length} updated, ${list.length} in all${key ? '' : ' (titles and channels from oEmbed; YOUTUBE_API_KEY adds views, lengths and how each did against its channel)'}`);
  const shown = [...added, ...updated];
  const score = (o: Record<string, unknown>) => (o.vsChannel as number | undefined) ?? (o.vsSubscribers as number | undefined) ?? -1;
  const measured = shown.some((o) => score(o) >= 0);
  if (measured) console.log(`  highest first, against their channels: views over the channel's average per video (lifetime views over uploads), then over its subscribers; 2x its average or more: it outran its channel`);
  for (const o of measured ? [...shown].sort((a, b) => score(b) - score(a)) : shown) {
    const vs = [o.vsChannel !== undefined ? `${o.vsChannel}x its average` : '', o.vsSubscribers !== undefined ? `${o.vsSubscribers}x its subscribers` : ''].filter(Boolean).join(', ');
    console.log(`  ${o.id}  ${[(o.views as string) ?? '', vs, (o.published as string) ?? ''].filter(Boolean).join('  ')}  ${o.channel}: ${o.title}`);
  }
  console.log(`preview takes them with --niche ${path.relative(ROOT, outDir) || outDir}. Other people's images, for comparison only: keep them out of the project's assets and out of git.`);
}

// ---------------------------------------------------------------------------------------------------------------
// srt: timed subtitles (SubRip) from the narration's timed words

// Subtitle lines and reading speeds, adult programs, from Netflix's timed-text style guides (partnerhelp.netflixstudios
// .com, read 2026-11-17; references/languages.md has the links): 42 characters a line for most languages, Japanese 13
// full-width, Korean and Chinese 16; 17 characters a second for most, English and Arabic 20, Hindi and Bengali 22,
// Korean 12, Chinese 9, Japanese 4. On screen 5/6 s to 7 s, two frames apart. The speeds are reported, not enforced:
// these subtitles carry the narration word for word.
type SubRule = { line: number; cps: number; spaced: boolean };
const SUB_RULES: Record<string, SubRule> = {
  en: { line: 42, cps: 20, spaced: true }, ar: { line: 42, cps: 20, spaced: true },
  hi: { line: 42, cps: 22, spaced: true }, bn: { line: 42, cps: 22, spaced: true },
  ja: { line: 13, cps: 4, spaced: false }, ko: { line: 16, cps: 12, spaced: true }, zh: { line: 16, cps: 9, spaced: false },
};
const SUB_DEFAULT: SubRule = { line: 42, cps: 17, spaced: true };
const SUB_MIN = 5 / 6, SUB_MAX = 7, SUB_LINGER = 0.25, SUB_PAUSE = 1.0;
const subRule = (code: string): SubRule => {
  const r = SUB_RULES[code.split('-')[0].toLowerCase()] ?? SUB_DEFAULT;
  const line = opt('line') ? +opt('line')! : r.line;
  if (!(line >= 8 && line <= 80)) fail(`--line ${opt('line')}: characters a line, 8 to 80`);
  return { ...r, line };
};
const graphemes = (s: string, lang: string) => [...new Intl.Segmenter(lang, { granularity: 'grapheme' }).segment(s)].length;
// (the sentence and clause ends dub.py splits on: ., !, ?, ... and their CJK, Arabic and Devanagari forms)
const SENT_END = /[.!?…。！？؟।॥]+["'”’»」』)\]]*$/;
const CLAUSE_END = /[,;:—–、，；：،]["'”’»)\]]*$/;
const NOT_END = /^(\d{1,2}\.|mr\.|mrs\.|ms\.|dr\.|st\.|sr\.|sra\.|jr\.|vs\.|e\.g\.|i\.e\.|z\.b\.|bzw\.|ca\.|nr\.|prof\.)$/i;
type Tok = { text: string; start: number; end: number; sent: boolean; clause: boolean };
// (a Japanese line or subtitle doesn't open on a particle or an ending: は, を, から, ます)
const noStart = (t: Tok, lang: string) => lang === 'ja' && /^(は|が|を|に|で|と|も|へ|の|から|まで|より|って|ます|です|た|て)/.test(t.text);
type Cue = { start: number; end: number; lines: string[]; toks: Tok[]; note?: boolean };

function toks(words: { w: string; start: number; end: number }[], lang: string, spaced: boolean): Tok[] {
  const out: Tok[] = [];
  const seg = new Intl.Segmenter(lang, { granularity: 'word' });
  for (const w of words) {
    const text = String(w.w ?? '').trim();
    if (!text) continue;
    const sent = SENT_END.test(text) && !NOT_END.test(text), clause = CLAUSE_END.test(text);
    // a word with no spaces in it for a whole phrase (Japanese, Chinese): cut at its words, the time shared by length
    const parts = !spaced && graphemes(text, lang) > 4 ? glue([...seg.segment(text)].map((s) => s.segment)) : [text];
    const total = parts.reduce((n, p) => n + graphemes(p, lang), 0) || 1;
    let acc = 0;
    parts.forEach((p, k) => {
      const a = w.start + (w.end - w.start) * acc / total;
      acc += graphemes(p, lang);
      const b = w.start + (w.end - w.start) * acc / total;
      const last = k === parts.length - 1;
      out.push({ text: p, start: a, end: b, sent: last ? sent : SENT_END.test(p), clause: last ? clause : CLAUSE_END.test(p) });
    });
  }
  return out;
}

/** Word segments with their punctuation kept on the word before (a line never starts with 、 or 。). */
function glue(parts: string[]): string[] {
  const out: string[] = [];
  for (const p of parts) {
    if (out.length && /^[\p{P}\s]+$/u.test(p)) out[out.length - 1] += p.trim();
    else if (p.trim()) out.push(p.trim());
  }
  return out;
}

/** The best two lines for a cue (or one), within `line` graphemes each: a break after punctuation when there is one,
 *  the lines as even as can be, the bottom one the longer. null when the words don't fit in two. */
function breakLines(ts: Tok[], lang: string, rule: SubRule): string[] | null {
  const join = (a: Tok[]) => a.map((t) => t.text).join(rule.spaced ? ' ' : '');
  const whole = join(ts);
  if (graphemes(whole, lang) <= rule.line) return [whole];
  let best: { cost: number; lines: string[] } | null = null;
  for (let k = 1; k < ts.length; k++) {
    const a = join(ts.slice(0, k)), b = join(ts.slice(k));
    const la = graphemes(a, lang), lb = graphemes(b, lang);
    if (la > rule.line || lb > rule.line) continue;
    // (a break after punctuation is best; in Japanese, after a particle: a line doesn't start with は, を or から)
    const after = ts[k - 1].clause || ts[k - 1].sent ? rule.line / 3
      : lang === 'ja' && /(は|が|を|に|で|と|も|へ|から|まで|より|って)$/.test(ts[k - 1].text) ? rule.line / 4 : 0;
    const before = noStart(ts[k], lang) ? rule.line / 2 : 0;
    const cost = Math.abs(la - lb) + (la > lb ? 2 : 0) - after + before;
    if (!best || cost < best.cost) best = { cost, lines: [a, b] };
  }
  return best?.lines ?? null;
}

function buildCues(all: Tok[], lang: string, rule: SubRule, gap: number): { cues: Cue[]; long: string[] } {
  const cues: Cue[] = [];
  const long: string[] = [];
  let cur: Tok[] = [];
  const close = (n = cur.length) => {
    const part = cur.slice(0, n);
    cur = cur.slice(n);
    if (!part.length) return;
    let lines = breakLines(part, lang, rule);
    if (!lines) { // one word longer than two lines: kept whole, reported
      lines = [part.map((t) => t.text).join(rule.spaced ? ' ' : '')];
      long.push(lines[0]);
    }
    cues.push({ start: part[0].start, end: part[part.length - 1].end, lines, toks: part });
  };
  for (const t of all) {
    if (cur.length) {
      const cand = [...cur, t];
      const tooLong = !breakLines(cand, lang, rule) || t.end - cur[0].start > SUB_MAX;
      if (t.start - cur[cur.length - 1].end > SUB_PAUSE) close();
      else if (tooLong) {
        // end the cue at its last clause when that leaves it at least a third full, else where it overflows
        let k = -1;
        for (let i = cur.length - 1; i >= 1; i--) if (cur[i - 1].clause) { k = i; break; }
        const used = k > 0 ? graphemes(cur.slice(0, k).map((x) => x.text).join(' '), lang) : 0;
        let at = k > 0 && used >= rule.line * 2 / 3 ? k : cur.length;
        // the next subtitle would open on a particle: end this one a word earlier
        while (at > 1 && noStart(at < cur.length ? cur[at] : t, lang)) at--;
        close(at);
      }
    }
    cur.push(t);
    if (t.sent) close();
  }
  close();
  // a cue too short to read joins its neighbour when the two fit and nearly touch
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    if (c.end - c.start >= SUB_MIN) continue;
    for (const j of [i + 1, i - 1]) {
      const d = cues[j];
      if (!d || Math.abs((j > i ? d.start - c.end : c.start - d.end)) > 0.5) continue;
      const ts = j > i ? [...c.toks, ...d.toks] : [...d.toks, ...c.toks];
      const lines = breakLines(ts, lang, rule);
      if (!lines || ts[ts.length - 1].end - ts[0].start > SUB_MAX) continue;
      const merged = { start: ts[0].start, end: ts[ts.length - 1].end, lines, toks: ts };
      cues.splice(Math.min(i, j), 2, merged);
      i = Math.min(i, j) - 1;
      break;
    }
  }
  // timing: shown from the first word, a little past the last, long enough to read where the next leaves room,
  // at least 5/6 s where it can be, two frames before the next
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i], next = cues[i + 1], prev = cues[i - 1];
    const room = next ? next.start - gap : Infinity;
    const n = graphemes(c.lines.join(''), lang);
    const want = Math.max(c.end + SUB_LINGER, c.start + Math.max(SUB_MIN, n / rule.cps));
    c.end = Math.min(want, c.end + 1.5, room, c.start + SUB_MAX);
    if (c.end - c.start < SUB_MIN && prev) c.start = Math.max(prev.end + gap, Math.min(c.start, c.end - SUB_MIN));
    c.end = Math.max(c.end, c.start + 0.2);
  }
  return { cues, long };
}

/** A note's time: seconds (12.5), m:ss or m:ss.s (0:08.5), or h:mm:ss. */
function noteTime(t: string): number | undefined {
  const m = /^(\d+):(\d{2}(?:\.\d+)?)$/.exec(t);
  return m && +m[2] < 60 ? +m[1] * 60 + +m[2] : parseClock(t);
}

function stampSrt(t: number): string {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}

type WordsDoc = { lines?: { text?: string; words?: { w: string; start: number; end: number; spoken?: string }[] }[]; source?: any };

function readJson(file: string): any {
  try { return JSON.parse(readText(file)); } catch (e) { fail(`${file}: not readable JSON (${(e as Error).message})`); }
}

/** Where data/words.json's times sit in the video: the shift the video's mix recorded (a voice placed later), else 0. */
function wordsShift(vdir: string): number {
  const rec = path.join(vdir, 'audio', 'mix.wav.request.json');
  if (!existsSync(rec)) return 0;
  try { return +(JSON.parse(readText(rec))?.resolved?.timing_data?.['words.json']?.shift_s ?? 0) || 0; } catch { return 0; }
}

function paragraphsOf(file: string): string[] {
  return readText(file).split(/\n\s*\n/).map((p) => p.split(/\s+/).filter(Boolean).join(' ')).filter(Boolean);
}

function sentencesOf<T extends { w: string }>(ws: T[]): T[][] {
  const out: T[][] = []; let cur: T[] = [];
  for (const w of ws) { cur.push(w); if (SENT_END.test(w.w) && !NOT_END.test(w.w)) { out.push(cur); cur = []; } }
  if (cur.length) out.push(cur);
  return out;
}

async function srt() {
  const video = opt('video'), code = opt('lang');
  if (!video || !code) fail('srt needs --video <video> --lang <code>: the video\'s own language (from data/words.json) or a translation in youtube/<code>/narration.txt');
  if (!/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(code)) fail(`--lang ${code}: a language code such as pt-BR, es, ja or zh-Hans`);
  const vdir = path.join(ROOT, 'videos', video);
  if (!existsSync(path.join(vdir, 'video.json'))) fail(`--video ${video}: no videos/${video}/video.json in ${ROOT}`);
  const lang = code.split('-')[0].toLowerCase();
  const rule = subRule(code);
  let fps = 30;
  try { fps = +JSON.parse(readText(path.join(vdir, 'video.json'))).fps || 30; } catch {}
  const gap = 2 / fps;
  const wordsFile = path.join(vdir, 'data', 'words.json');
  if (!existsSync(wordsFile)) fail(`videos/${video}/data/words.json doesn't exist: subtitles are timed on the narration's words (the soundtrack skill's eleven.py tts or align.py writes them)`);
  const shift = wordsShift(vdir);
  const orig: WordsDoc = readJson(wordsFile);
  // (in video time; words a mix places before 0 s, a narration trimmed at its start, aren't in the video, and are
  // left out once a translation's sentences have been matched to the original's as spoken)
  const full = (orig.lines ?? []).map((l) => (l.words ?? []).filter((w) => typeof w.start === 'number').map((w) => ({ w: String(w.w), start: w.start + shift, end: w.end + shift })));
  const inVideo = <T extends { start: number; end: number }>(ws: T[]) => ws.filter((w) => w.end > 0).map((w) => ({ ...w, start: Math.max(0, w.start) }));
  const olines = full.map(inVideo);
  const pkg = path.join(vdir, 'youtube', code);
  const narration = path.join(pkg, 'narration.txt');
  const placedFile = path.join(vdir, 'dub', code, 'data', 'words-placed.json');
  let words: { w: string; start: number; end: number }[] = [];
  let from = '';
  let out = '';
  const notes: string[] = [];
  if (!existsSync(narration)) {
    words = olines.flat();
    from = `the video's own narration, videos/${video}/data/words.json${shift ? ` (+${shift.toFixed(3)} s, as the mix places it)` : ''}`;
    out = path.join(vdir, 'youtube', `subtitles.${code}.srt`);
  } else {
    const paras = paragraphsOf(narration);
    if (paras.length !== olines.length) fail(`youtube/${code}/narration.txt has ${paras.length} paragraphs and the narration ${olines.length} lines: one paragraph per line, in order`);
    out = path.join(pkg, `subtitles.${code}.srt`);
    let placed: WordsDoc | undefined;
    if (existsSync(placedFile)) {
      placed = readJson(placedFile);
      const said = (placed!.lines ?? []).map((l) => (l.words ?? []).map((w) => w.w).join(' '));
      const fresh = said.length === paras.length && said.every((s, i) => s.replace(/\s+/g, '') === paras[i].replace(/\s+/g, ''));
      if (!fresh) { notes.push(`the dub in videos/${video}/dub/${code}/ was placed from another text than narration.txt: timed on the original instead (place the dub again to time them on its voice)`); placed = undefined; }
    }
    if (placed) {
      words = (placed.lines ?? []).flatMap((l) => (l.words ?? []).filter((w) => w.end > 0).map((w) => ({ w: String(w.w), start: Math.max(0, w.start), end: w.end })));
      from = `youtube/${code}/narration.txt, timed on its dubbed voice (videos/${video}/dub/${code}/data/words-placed.json)`;
    } else {
      // each translated sentence shown while its original sentence is spoken (the paragraph's, when they don't match)
      let whole = 0, trimmedOut = 0;
      paras.forEach((p, i) => {
        const tw = p.split(' ').map((w) => ({ w, start: 0, end: 0 }));
        const os = sentencesOf(full[i]), ts = sentencesOf(tw);
        const pairs: [typeof tw, number, number][] = [];
        if (os.length && os.length === ts.length) ts.forEach((s, k) => pairs.push([s, os[k][0].start, os[k][os[k].length - 1].end]));
        else if (full[i].length) { pairs.push([tw, full[i][0].start, full[i][full[i].length - 1].end]); whole++; }
        for (const [s, a, b] of pairs) {
          const n = s.reduce((x, w) => x + graphemes(w.w, lang) + 1, 0);
          let acc = 0;
          for (const w of s) { w.start = a + (b - a) * acc / n; acc += graphemes(w.w, lang) + 1; w.end = a + (b - a) * (acc - 1) / n; }
          // (a sentence the mix trims whole isn't shown; one it trims in part, from 0 s)
          if (b > 0) { for (const w of s) if (w.end > 0) words.push({ ...w, start: Math.max(0, w.start) }); }
          else trimmedOut++;
        }
      });
      if (trimmedOut) notes.push(`${trimmedOut} translated sentence(s) left out: the mix trims their original before 0 s`);
      from = `youtube/${code}/narration.txt, each sentence shown while its original is spoken (videos/${video}/data/words.json)`;
      if (whole) notes.push(`${whole} paragraph(s) whose sentences don't match the original's one for one: shown across the original line`);
    }
  }
  const built = buildCues(toks(words, lang, rule.spaced), lang, rule, gap);
  const long = built.long;
  // inside the video: a subtitle neither starts nor stays past its end (the reading time a last line would want)
  const len = videoLength(path.join(vdir, 'youtube'), video, ROOT);
  const end = len.seconds ?? Infinity;
  const cues = built.cues.filter((c) => c.start < end);
  if (cues.length < built.cues.length) notes.push(`${built.cues.length - cues.length} subtitle(s) would start after the video's end (${clock(end)}, from ${len.from}): left out`);
  // a subtitle near the end ends with the video, and starts earlier when that leaves it too short to read
  cues.forEach((c, i) => {
    c.end = Math.min(c.end, end);
    if (c.end - c.start < SUB_MIN) c.start = Math.max(i ? cues[i - 1].end + gap : 0, Math.min(c.start, c.end - SUB_MIN));
  });
  // timed notes for words the picture shows (youtube/<code>/notes.tsv: time, seconds, text), where no subtitle is
  const notesFile = existsSync(narration) ? path.join(pkg, 'notes.tsv') : path.join(vdir, 'youtube', `notes.${code}.tsv`);
  let placedNotes = 0;
  if (existsSync(notesFile)) {
    for (const [k, raw] of readText(notesFile).split('\n').entries()) {
      if (!raw.trim() || raw.trim().startsWith('#')) continue;
      const [t, d, ...txt] = raw.split('\t');
      const a = noteTime(t?.trim() ?? ''), len = +(d ?? '');
      if (a === undefined || !(len > 0) || !txt.join('\t').trim()) fail(`${path.basename(notesFile)} line ${k + 1}: time<TAB>seconds<TAB>text`);
      // (what is already there, narration and the notes placed so far, in order)
      const prev = [...cues].reverse().find((c) => c.start <= a), next = cues.find((c) => c.start > a);
      const s = Math.max(a, prev ? prev.end + gap : 0), e = Math.min(a + len, next ? next.start - gap : Infinity);
      if (e - s < 1) { notes.push(`note at ${clock(a)} dropped: under a second free of narration there`); continue; }
      const text = txt.join(' ').trim();
      const lines = breakLines(toks(text.split(/\s+/).map((w) => ({ w, start: s, end: e })), lang, rule.spaced), lang, rule) ?? [text];
      if (s >= end || Math.min(e, end) - s < 1) { notes.push(`note at ${clock(a)} dropped: under a second free of narration before the video's end`); continue; }
      cues.push({ start: s, end: Math.min(e, end), lines, toks: [], note: true });
      cues.sort((x, y) => x.start - y.start);
      placedNotes++;
    }
    cues.sort((x, y) => x.start - y.start);
  }
  const body = cues.map((c, i) => `${i + 1}\n${stampSrt(c.start)} --> ${stampSrt(c.end)}\n${c.lines.join('\n')}\n`).join('\n');
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, body, 'utf8');
  // the report: what was read, and how fast it reads
  const speeds = cues.filter((c) => !c.note).map((c) => ({ c, cps: graphemes(c.lines.join(''), lang) / Math.max(0.1, c.end - c.start) }));
  const sorted = speeds.map((x) => x.cps).sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const fast = speeds.filter((x) => x.cps > rule.cps).sort((a, b) => b.cps - a.cps);
  const rel = path.relative(ROOT, out).replace(/\\/g, '/');
  console.log(`${rel}: ${cues.length} subtitles${placedNotes ? ` (${placedNotes} of them notes for words on screen)` : ''}, ${cues.length ? `${clock(cues[0].start)} to ${clock(cues[cues.length - 1].end)}` : 'none'}; from ${from}.`);
  console.log(`  lines of ${rule.line} characters at most, two a subtitle${opt('line') ? ' (--line)' : ''}; plain UTF-8 SubRip, as YouTube reads it.`);
  console.log(`  reading speed: ${median.toFixed(1)} characters a second on median; ${fast.length} over ${rule.cps} (the ${lang} guide's adult speed)${fast.length ? `, the fastest ${fast[0].cps.toFixed(1)} at ${clock(fast[0].c.start)}` : ''}. They carry the narration word for word, so a fast voice reads fast.`);
  if (long.length) console.log(`  ${long.length} subtitle(s) with a word too long for two lines, kept whole: ${long.slice(0, 3).join(' | ')}`);
  for (const n of notes) console.log(`  note: ${n}`);
  console.log(`  In Studio: Subtitles (or Languages), the video, ${existsSync(narration) ? `Add language: ${code}` : `the video's language`}, Subtitles: Add, Upload file, With timing.`);
}

// ---------------------------------------------------------------------------------------------------------------
// check

type Finding = { level: 'ok' | 'note' | 'warn' | 'FAIL'; what: string; msg: string };

/** YouTube's count for the tags field: every character, a comma between tags, and quotes around a tag with a space. */
function tagsLength(tags: string[]): number {
  return tags.reduce((n, t) => n + chars(t) + (/\s/.test(t) ? 2 : 0), 0) + Math.max(0, tags.length - 1);
}

/** The chapter list YouTube reads: the first run of lines starting with a timestamp, when it starts at 0:00.
 *  A timestamp that isn't a time ("0:99", "0:100", "0:10:0", "1:22:33:44") is reported, not read as the time it
 *  would add up to or as a shorter time with the rest in the name: the whole run of digits and colons is the
 *  stamp, and it is one when a part after a colon has two digits (so "16:9" or "1:1" opening a line is none). */
function chapters(desc: string): { list: { t: number; label: string; line: number }[]; stray: number; invalid: string[] } {
  const lines = desc.split('\n');
  const stamp = /^\s*[([]?(\d+(?::\d+)+)(?!\d|:\d)[)\]]?\s*[-–—:|]?\s*(.*)$/;
  const list: { t: number; label: string; line: number }[] = [];
  const invalid: string[] = [];
  let stray = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = stamp.exec(lines[i]);
    if (!m || !/:\d{2}/.test(m[1])) { if (list.length) break; continue; }
    const t = parseClock(m[1]);
    if (t === undefined) { invalid.push(`line ${i + 1}: "${m[1]}" isn't a time`); continue; }
    if (!list.length && t !== 0) { stray++; continue; }
    list.push({ t, label: m[2].trim(), line: i + 1 });
  }
  return { list, stray, invalid };
}

async function check() {
  const { dir, video, proj } = locate();
  if (!existsSync(dir)) fail(`${dir}: no such folder`);
  // with --video and no folder named: the video's package, then each language's
  const folders = [dir];
  if (video && !positional.length && path.basename(dir) === 'youtube')
    for (const f of readdirSync(dir).sort()) {
      const d = path.join(dir, f);
      if (statSync(d).isDirectory() && ['title.txt', 'description.txt', 'narration.txt'].some((x) => existsSync(path.join(d, x)))) folders.push(d);
    }
  let fails = 0;
  for (const d of folders) {
    if (folders.length > 1) console.log(`\n${path.relative(ROOT, d).replace(/\\/g, '/') || d}/`);
    fails += await checkFolder(d, video, proj);
  }
  if (folders.length > 1) console.log(fails ? `\n${fails} problem(s) in all.` : `\nNothing YouTube would refuse in the ${folders.length - 1} language folder(s) or the package.`);
  if (fails) process.exit(1);
}

async function checkFolder(dir: string, video?: string, proj?: string): Promise<number> {
  const out: Finding[] = [];
  const add = (level: Finding['level'], what: string, msg: string) => out.push({ level, what, msg });
  // a language's folder (videos/<video>/youtube/<code>/): what is uploaded for that language
  const langCode = path.basename(path.dirname(dir)) === 'youtube' && video ? path.basename(dir) : undefined;
  let fps = 30;
  if (video && proj) try { fps = +JSON.parse(readText(path.join(proj, 'videos', video, 'video.json'))).fps || 30; } catch {}

  // thumbnails: decoded by Chrome when it starts (what it can't decode, YouTube won't either), else read from
  // their headers, so a browser problem never stops the rest of the check
  const thumbs = thumbnailsIn(dir);
  const full = opts.has('full');
  const [wantW, wantH] = sizeOpt(opt('size', '1280x720')!);
  let decoded = false;
  const sizes = new Map<string, [number, number, string]>();
  const judge = (name: string, kind: string, w: number, h: number, bytes: number) => {
    sizes.set(name, [w, h, kind]);
    const desc = `${w}x${h} ${kind}, ${kb(bytes)}`;
    if (Math.abs(w / h - 16 / 9) > 0.01) add('FAIL', name, `${desc}: not 16:9, so YouTube letterboxes or crops it`);
    else if (w < MIN_WIDTH) add('FAIL', name, `${desc}: under YouTube's minimum width of ${MIN_WIDTH}`);
    else if (bytes > DESKTOP_UPLOAD_BYTES) add('FAIL', name, `${desc}: over 50 MB, YouTube's limit`);
    else if (bytes > MOBILE_UPLOAD_BYTES) add('warn', name, `${desc}: over 2 MB, so the YouTube app can't upload it (Studio on a computer can); shoot --jpg 90 makes it smaller`);
    else add('ok', name, desc);
  };
  if (thumbs.length) {
    const headers = thumbs.map((f) => ({ file: f, name: path.basename(f), bytes: statSync(f).size, ...imageHeader(f) }));
    for (const h of headers) if (!h.kind) add('FAIL', h.name, 'not a PNG, JPEG, GIF or WebP file');
    const readable = headers.filter((h) => h.kind);
    try {
      await withChrome(async (chrome, base) => {
        const page = await chrome.page(800, 600, 1);
        for (const h of readable) {
          pages.set('img', `<!doctype html><img id="i" src="${fileUrl(h.file)}">`);
          await page.goto(`${base}/__page/img`);
          const r = await page.eval<{ w: number; h: number; ok: boolean; alpha: boolean }>(`(() => {
            const i = document.getElementById('i');
            if (!i.complete || !i.naturalWidth) return { w: 0, h: 0, ok: false, alpha: false };
            const c = document.createElement('canvas'); c.width = i.naturalWidth; c.height = i.naturalHeight;
            const g = c.getContext('2d'); g.drawImage(i, 0, 0);
            const d = g.getImageData(0, 0, c.width, c.height).data;
            let alpha = false; for (let k = 3; k < d.length; k += 4) if (d[k] < 255) { alpha = true; break; }
            return { w: i.naturalWidth, h: i.naturalHeight, ok: true, alpha };
          })()`);
          if (!r.ok) { add('FAIL', h.name, `${h.kind} that doesn't decode (truncated or damaged)`); continue; }
          judge(h.name, h.kind, r.w, r.h, h.bytes);
          if (r.alpha) add('warn', h.name, 'has transparent pixels: YouTube shows them over its own background, which differs between the dark and light pages');
        }
        decoded = true;
      });
    } catch (e) {
      console.log(`(thumbnails not decoded, read from their headers only: ${(e as Error).message.split('\n')[0]})`);
    }
    // (every whole PNG, GIF, WebP and JPEG states its size in its header: one that doesn't is cut off or damaged)
    if (!decoded) for (const h of readable) {
      if (h.w && h.h) judge(h.name, h.kind, h.w, h.h, h.bytes);
      else add('FAIL', h.name, `${h.kind} whose header is cut off or damaged (no size in it), so it won't decode`);
    }
  } else add('note', 'thumbnails', langCode ? "none (the video's thumbnails without words serve every language)" : 'none (thumbnail-1.png ...)');

  // title
  const titleFile = path.join(dir, 'title.txt');
  if (existsSync(titleFile)) {
    const lines = readText(titleFile).split('\n').map((l) => l.trim()).filter(Boolean);
    const title = lines[0] ?? '';
    const n = chars(title);
    if (!title) add('FAIL', 'title.txt', 'empty');
    else if (lines.length > 1) add('FAIL', 'title.txt', `${lines.length} lines: one title, on one line (alternatives go in NOTES.md)`);
    else if (n > TITLE_MAX) add('FAIL', 'title.txt', `${n} characters: YouTube's limit is ${TITLE_MAX}`);
    else if (/[<>]/.test(title)) add('FAIL', 'title.txt', 'has < or >, which YouTube refuses');
    else add('ok', 'title.txt', `${n} characters: "${title}"`);
  } else add('note', 'title.txt', 'none');

  // description: length, refused characters, chapters, hashtags
  const len = videoLength(dir, video, proj);
  const descFile = path.join(dir, 'description.txt');
  if (existsSync(descFile)) {
    const desc = readText(descFile).trim();
    const n = chars(desc);
    const first = desc.split('\n')[0];
    // (YouTube's help counts 5,000 characters, its Data API 5,000 bytes: an accent takes two, an emoji four)
    const bytes = Buffer.byteLength(desc, 'utf8');
    if (!desc) add('FAIL', 'description.txt', 'empty');
    else if (n > DESCRIPTION_MAX) add('FAIL', 'description.txt', `${n} characters: YouTube's limit is ${DESCRIPTION_MAX}`);
    else if (/[<>]/.test(desc)) add('FAIL', 'description.txt', `has < or > (line ${desc.split('\n').findIndex((l) => /[<>]/.test(l)) + 1}), which YouTube refuses`);
    else add('ok', 'description.txt', `${n} characters${bytes !== n ? `, ${bytes} bytes` : ''}; it opens "${first.slice(0, 90)}${first.length > 90 ? '...' : ''}"`);
    if (n <= DESCRIPTION_MAX && bytes > DESCRIPTION_MAX) add('warn', 'description.txt', `${bytes} bytes: Studio takes ${DESCRIPTION_MAX} characters, but an upload through YouTube's API (or a tool using it) counts bytes and may refuse it`);
    // (plain lists read fine; these show their marks literally)
    if (/(^|\n)#{1,6} |\*\*[^*\n]+\*\*|\[[^\]\n]+\]\([^)\n]+\)/.test(desc))
      add('warn', 'description.txt', 'has Markdown (a "# " heading, **bold** or [text](link)): YouTube shows the marks as typed');
    const { list, stray, invalid } = chapters(desc);
    if (invalid.length) add('FAIL', 'chapters', `timestamps that aren't times (seconds and minutes run 0 to 59): ${invalid.join('; ')}`);
    if (list.length) {
      const bad: string[] = [];
      if (list.length < CHAPTERS_MIN) bad.push(`${list.length} chapters: YouTube needs at least ${CHAPTERS_MIN}`);
      for (let i = 1; i < list.length; i++) {
        const gap = list[i].t - list[i - 1].t;
        if (gap <= 0) bad.push(`line ${list[i].line}: ${clock(list[i].t)} doesn't come after ${clock(list[i - 1].t)}`);
        else if (gap < CHAPTER_MIN) bad.push(`line ${list[i - 1].line}: "${list[i - 1].label}" lasts ${gap} s, under ${CHAPTER_MIN} s`);
      }
      for (const c of list) if (!c.label) bad.push(`line ${c.line}: a timestamp without a title`);
      const last = list[list.length - 1];
      if (len.seconds !== undefined) {
        if (last.t >= len.seconds) bad.push(`line ${last.line}: ${clock(last.t)} is past the video's end (${clock(len.seconds)}, from ${len.from})`);
        else if (len.seconds - last.t < CHAPTER_MIN) bad.push(`line ${last.line}: the last chapter lasts ${(len.seconds - last.t).toFixed(1)} s, under ${CHAPTER_MIN} s (video ${clock(len.seconds)}, from ${len.from})`);
      }
      const shortest = Math.min(...list.slice(1).map((c, i) => c.t - list[i].t), len.seconds !== undefined ? len.seconds - last.t : Infinity);
      if (bad.length) add('FAIL', 'chapters', `YouTube ignores the whole list: ${bad.join('; ')}`);
      else add('ok', 'chapters', `${list.length}, from 0:00 to ${clock(last.t)}, the shortest ${Number.isFinite(shortest) ? `${Math.round(shortest * 10) / 10} s` : 'unknown'}${len.seconds !== undefined ? `, in a video of ${clock(len.seconds)} (${len.from})` : '; the video\'s length is unknown (pass --duration), so the last chapter wasn\'t checked'}`);
    } else if (stray) add('warn', 'chapters', 'timestamps, but none at 0:00 first: YouTube makes no chapters from them');
    else add('note', 'chapters', 'none');
    const tags = new Set((desc.match(/(^|\s)#[\p{L}\p{N}_]+/gu) ?? []).map((h) => h.trim().toLowerCase()));
    if (tags.size > HASHTAGS_MAX) add('FAIL', 'hashtags', `${tags.size}: over ${HASHTAGS_MAX}, YouTube ignores every hashtag in the description`);
    else if (tags.size > HASHTAGS_MANY) add('warn', 'hashtags', `${tags.size}: a list that long reads as spam; two to four about the video do the job`);
    else if (tags.size) add('ok', 'hashtags', `${tags.size}: ${[...tags].join(' ')} (YouTube shows up to three it finds most engaging by the title)`);
  } else add('note', 'description.txt', 'none');

  // subtitles, and a language's dubbed track
  const srts = readdirSync(dir).filter((f) => /\.srt$/i.test(f)).sort();
  for (const f of srts) checkSrt(path.join(dir, f), len, add);
  const wav = path.join(dir, 'mix.wav');
  if (existsSync(wav)) checkTrack(wav, len, fps, langCode, add);

  // tags
  const tagsFile = path.join(dir, 'tags.txt');
  if (langCode) {
    if (existsSync(tagsFile)) add('note', 'tags.txt', "YouTube keeps one tag list per video, not one per language: this one isn't uploaded (the video's is youtube/tags.txt)");
  } else if (existsSync(tagsFile)) {
    const tags = readText(tagsFile).split(/[,\n]/).map((t) => t.trim()).filter(Boolean);
    const total = tagsLength(tags);
    const dupes = tags.filter((t, i) => tags.findIndex((u) => u.toLowerCase() === t.toLowerCase()) !== i);
    if (!tags.length) add('FAIL', 'tags.txt', 'empty');
    else if (total > TAGS_MAX) add('FAIL', 'tags.txt', `${total} characters as YouTube counts them (a comma between tags, quotes around one with a space): the limit is ${TAGS_MAX}`);
    else if (tags.some((t) => /[<>]/.test(t))) add('FAIL', 'tags.txt', 'a tag has < or >, which YouTube refuses');
    else add('ok', 'tags.txt', `${tags.length} tags, ${total} of ${TAGS_MAX} characters as YouTube counts them`);
    if (dupes.length) add('warn', 'tags.txt', `repeated: ${dupes.join(', ')}`);
  } else add('note', 'tags.txt', 'none');

  // the request: the whole package, with --full (a narrower request makes some parts optional)
  const timed = !!(video && proj && existsSync(path.join(proj, 'videos', video, 'data', 'words.json')));
  const wantSrt = !timed ? '' : langCode ? `subtitles.${langCode}.srt` : 'subtitles.<code>.srt';
  if (langCode) {
    const lm = ['title.txt', 'description.txt', wantSrt].filter((f) => f && !existsSync(path.join(dir, f)));
    if (full) for (const f of lm) add('FAIL', 'package', `${f} is missing`);
    else if (lm.length) add('note', 'package', `no ${lm.join(', ')} yet`);
    if (full && !lm.length) add('ok', 'package', `${langCode}: the title, the description${wantSrt ? ' and the subtitles' : ' (no timed narration, so no subtitles)'}${thumbs.length ? `, ${thumbs.length} thumbnail(s)` : ''}${existsSync(wav) ? ', the dubbed track' : ''}`);
    for (const [name, [w, h, kind]] of full ? sizes : new Map()) if (w !== wantW || h !== wantH || kind !== (opts.has('jpg') ? 'JPEG' : 'PNG')) add('FAIL', 'package', `${name} is ${w}x${h} ${kind}, not the ${wantW}x${wantH} asked for`);
    return report(out, full);
  }
  if (full && wantSrt && !srts.length) add('FAIL', 'package', `no ${wantSrt}: the package has the narration's subtitles (youtube.ts srt --video ${video} --lang <code>)`);
  const missing = ['title.txt', 'description.txt', 'tags.txt'].filter((f) => !existsSync(path.join(dir, f)));
  // (the package's thumbnails are PNG, as the skill makes them; --jpg when JPEG was asked for)
  const wantKind = opts.has('jpg') ? 'JPEG' : 'PNG';
  const allRight = [...sizes.values()].every(([w, h, kind]) => w === wantW && h === wantH && kind === wantKind);
  if (full) {
    if (thumbs.length !== 3) add('FAIL', 'package', `${thumbs.length} thumbnails: the full package has three options`);
    for (const [name, [w, h, kind]] of sizes) {
      if (w !== wantW || h !== wantH) add('FAIL', 'package', `${name} is ${w}x${h}, not the ${wantW}x${wantH} asked for`);
      if (kind !== wantKind) add('FAIL', 'package', `${name} is ${kind}, not ${wantKind}${wantKind === 'PNG' ? ' (--jpg if JPEG was asked for)' : ''}`);
    }
    for (const f of missing) add('FAIL', 'package', `${f} is missing`);
    if (thumbs.length === 3 && !missing.length && allRight && sizes.size === 3) add('ok', 'package', `complete: three ${wantW}x${wantH} ${wantKind} thumbnails, the title, the description and the tags`);
  } else if (missing.length || thumbs.length !== 3) {
    add('note', 'package', `${thumbs.length} thumbnail(s)${missing.length ? `; no ${missing.join(', ')}` : ''} (fine for a narrower request; --full holds it to the whole package)`);
  }

  return report(out, full, thumbs.length > 0 && !decoded);
}

function report(out: Finding[], full: boolean, undecoded = false): number {
  const pad = Math.max(...out.map((f) => f.what.length));
  for (const f of out) console.log(`${f.level.padEnd(4)}  ${f.what.padEnd(pad)}  ${f.msg}`);
  const fails = out.filter((f) => f.level === 'FAIL').length;
  if (fails) console.log(`${fails} problem(s): YouTube would refuse or ignore them${full ? ', or the package is incomplete' : ''}.`);
  else console.log(`Nothing YouTube would refuse${undecoded ? ' in what could be read (the thumbnails from their headers only: they weren\'t decoded)' : ''}. This checks limits, not whether it is good: look at the preview.`);
  return fails;
}

/** A SubRip file as YouTube reads it: plain UTF-8, numbered blocks, times in order and inside the video. */
function checkSrt(file: string, len: { seconds?: number; from: string }, add: (l: Finding['level'], w: string, m: string) => void) {
  const name = path.basename(file);
  const buf = readFileSync(file);
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { add('FAIL', name, 'not UTF-8: YouTube asks for plain UTF-8'); return; }
  if (text.startsWith('\uFEFF')) { add('warn', name, 'starts with a byte-order mark: YouTube asks for plain UTF-8 without one'); text = text.slice(1); }
  const blocks = text.replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/).filter((b) => b.trim());
  if (!blocks.length) { add('FAIL', name, 'no subtitles in it'); return; }
  const T = /^(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/;
  const sec = (m: RegExpExecArray, o: number) => +m[o] * 3600 + +m[o + 1] * 60 + +m[o + 2] + +m[o + 3] / 1000;
  const bad: string[] = [], warn: string[] = [];
  let prevStart = -1, prevEnd = -1, first = 0, last = 0, three = 0, marks = 0;
  blocks.forEach((b, i) => {
    const ls = b.split('\n');
    const n = /^\d+$/.test(ls[0].trim()) ? 1 : 0;
    const m = T.exec(ls[n] ?? '');
    if (!m) { bad.push(`block ${i + 1} ("${ls[0].slice(0, 30)}"): no "00:00:01,000 --> 00:00:02,500" line`); return; }
    if (!n) warn.push(`block ${i + 1} has no number`);
    else if (+ls[0] !== i + 1) warn.push(`block ${i + 1} is numbered ${ls[0].trim()}`);
    if ([m[2], m[3], m[6], m[7]].some((x) => +x > 59)) { bad.push(`block ${i + 1}: a time that isn't one (minutes and seconds run 0 to 59)`); return; }
    const a = sec(m, 1), z = sec(m, 5);
    if (z <= a) bad.push(`block ${i + 1}: ends before it starts`);
    if (a < prevStart) bad.push(`block ${i + 1} starts before block ${i}`);
    else if (a < prevEnd - 0.001) warn.push(`block ${i + 1} starts before block ${i} ends (both show at once)`);
    const lines = ls.slice(n + 1).filter((l) => l.trim());
    if (!lines.length) bad.push(`block ${i + 1} has no text`);
    if (lines.length > 2) three++;
    if (lines.some((l) => /<\/?[a-z]+[^>]*>|\{\\/i.test(l))) marks++;
    if (i === 0) first = a;
    prevStart = a; prevEnd = z; last = Math.max(last, z);
  });
  if (len.seconds !== undefined && last > len.seconds + 0.5) bad.push(`it runs to ${clock(last)}, past the video's end (${clock(len.seconds)}, from ${len.from})`);
  if (three) warn.push(`${three} subtitle(s) of three lines or more`);
  if (marks) warn.push(`${marks} subtitle(s) with style marks (<i>, {\\an8}): YouTube reads the basic form, and may show them as typed`);
  if (bad.length) add('FAIL', name, bad.slice(0, 4).join('; ') + (bad.length > 4 ? `; and ${bad.length - 4} more` : ''));
  else add('ok', name, `${blocks.length} subtitles, ${clock(first)} to ${clock(last)}, plain UTF-8 SubRip`);
  for (const w of warn.slice(0, 4)) add('warn', name, w);
}

/** A dubbed audio track (WAV): as long as the video, to a frame, as YouTube's audio tracks want it. */
function checkTrack(file: string, len: { seconds?: number; from: string }, fps: number, code: string | undefined,
                    add: (l: Finding['level'], w: string, m: string) => void) {
  const b = readFileSync(file);
  if (b.length < 44 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') { add('FAIL', 'mix.wav', 'not a WAV file'); return; }
  let o = 12, rate = 0, ch = 0, bits = 0, data = -1;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4), size = b.readUInt32LE(o + 4);
    if (id === 'fmt ') { ch = b.readUInt16LE(o + 10); rate = b.readUInt32LE(o + 12); bits = b.readUInt16LE(o + 22); }
    if (id === 'data') { data = Math.min(size, b.length - o - 8); break; }
    o += 8 + size + (size % 2);
  }
  if (!rate || !ch || !bits || data < 0) { add('FAIL', 'mix.wav', 'a WAV whose header is cut off or damaged'); return; }
  const d = data / (rate * ch * bits / 8);
  const desc = `${clock(d)} (${d.toFixed(3)} s), ${rate / 1000} kHz, ${ch === 2 ? 'stereo' : ch === 1 ? 'mono' : `${ch} channels`}, ${bits}-bit, ${mb(b.length)}`;
  if (len.seconds === undefined) add('note', 'mix.wav', `${desc}; the video's length is unknown (pass --duration), so it wasn't compared`);
  else if (Math.abs(d - len.seconds) > 1 / fps + 1e-6) add('FAIL', 'mix.wav', `${desc}: the video lasts ${len.seconds.toFixed(3)} s (${len.from}); an audio track is the video's length (dub.py mix makes it so)`);
  else add('ok', 'mix.wav', `${desc}, the video's length to a frame; in Studio: Languages, ${code ?? 'the language'}, Dub: Add`);
}

// ---------------------------------------------------------------------------------------------------------------

try {
  if (mode === 'shoot') await shoot();
  else if (mode === 'preview') await preview();
  else if (mode === 'niche') await niche();
  else if (mode === 'srt') await srt();
  else await check();
} catch (e) {
  server?.stop(true);
  fail(e instanceof Error ? e.message : String(e));
}
