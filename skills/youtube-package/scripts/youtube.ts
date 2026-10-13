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
//            image each, added to what's there. Links (from the user, or found with a web search) are read
//            through YouTube's oEmbed endpoint: title, channel, picture. --search and --channel need a YouTube
//            Data API key in YOUTUBE_API_KEY (free; a search costs 100 of the 10,000 daily units, the rest 1
//            each), which also adds views and lengths. It never scrapes youtube.com: YouTube's terms forbid
//            automated access outside its APIs. Needs the network.
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
const MODES = ['shoot', 'preview', 'niche', 'check'];
const mode = argv[0] && !argv[0].startsWith('--') ? argv[0] : '';
const rest = argv.slice(1);
const VALUED = new Set(['size', 'scale', 'out', 'video', 'title', 'channel', 'duration', 'niche', 'lang', 'root', 'search', 'n', 'region']);
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
// Type under this many pixels at 168 px wide is likely too small to read there (oprog-4's set, which read at
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
  constructor(private chrome: Chrome, private sessionId: string) {
    chrome.on((m) => {
      if (m.sessionId !== sessionId) return;
      if (m.method === 'Network.requestWillBeSent') this.urls.set(m.params.requestId, m.params.request.url);
      else if (m.method === 'Network.responseReceived' && m.params.response.status >= 400)
        this.failures.push(`${m.params.response.status} ${shortUrl(m.params.response.url)}`);
      else if (m.method === 'Network.loadingFailed' && !m.params.canceled)
        this.failures.push(`${m.params.errorText} ${shortUrl(this.urls.get(m.params.requestId) ?? '')}`);
      else if (m.method === 'Runtime.exceptionThrown')
        this.failures.push(`script error: ${m.params.exceptionDetails?.exception?.description?.split('\n')[0] ?? m.params.exceptionDetails?.text}`);
    });
  }
  size(width: number, height: number, scale = 1) {
    return this.chrome.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false }, this.sessionId);
  }
  async goto(url: string) {
    this.failures = [];
    const loaded = this.chrome.once('Page.loadEventFired', this.sessionId, 60_000, shortUrl(url));
    const nav = await this.chrome.send('Page.navigate', { url }, this.sessionId);
    if (nav.errorText) throw new Error(`${shortUrl(url)}: ${nav.errorText}`);
    await loaded;
    // Fonts, then every image decoded (a failure is reported, not hidden), then two frames: what the screenshot
    // takes is what was laid out. Images are <img>, SVG <image> and those CSS draws (a background, a mask, a
    // border, a list marker, generated content, on an element or its ::before and ::after): a broken one there
    // loads fine and then draws nothing. Only what is drawn counts: an element with no box (display:none, or inside
    // one) or a hidden one draws no image, nor a ::before or ::after without content, which doesn't exist (Chrome
    // doesn't fetch their images either). A url(#id), or this page's own name with #id, names an element of the
    // page (an SVG mask), not an image.
    const undecoded = await this.eval<string[]>(`document.fonts.ready
      .then(() => {
        const urls = new Set();
        for (const i of document.querySelectorAll('image')) if (i.href.baseVal) urls.add(new URL(i.href.baseVal, document.baseURI).href);
        for (const el of document.querySelectorAll('*')) {
          if (!el.getClientRects().length) continue;
          for (const pseudo of [null, '::before', '::after']) {
            const cs = getComputedStyle(el, pseudo);
            if (cs.visibility !== 'visible' || (pseudo && /^(none|normal)$/.test(cs.content))) continue;
            for (const prop of ['background-image', 'mask-image', '-webkit-mask-image', 'border-image-source', 'list-style-image', 'content'])
              for (const m of cs.getPropertyValue(prop).matchAll(/url\\("((?:[^"\\\\]|\\\\.)*)"\\)/g)) {
                const u = new URL(m[1].replace(/\\\\(.)/g, '$1'), document.baseURI);
                if (!(u.hash && u.href.split('#')[0] === location.href.split('#')[0])) urls.add(u.href);
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
    for (const u of undecoded) this.failures.push(`image didn't decode: ${shortUrl(u)}`);
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
  // videos/<video>/youtube/ given as a path: the same as --video
  const m = /[\\/]videos[\\/]([^\\/]+)[\\/]youtube$/.exec(dir);
  if (m && existsSync(path.join(dir, '..', 'video.json'))) {
    const proj = path.resolve(dir, '..', '..', '..');
    return { dir, video: m[1], proj, outDir: path.resolve(opt('out', path.join(proj, 'out', m[1], 'youtube'))!) };
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
  // equals each generic's own.
  const lacks = (font, family, s) => {
    const w = (f) => { c.font = font + ' 100px ' + f; return c.measureText(s).width; };
    return w('"' + family + '", monospace') === w('monospace') && w('"' + family + '", serif') === w('serif');
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

const YT_API = 'https://www.googleapis.com/youtube/v3';

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
  type Meta = { title?: string; channel?: string; viewCount?: number; duration?: string; thumb?: string };
  const metas = new Map<string, Meta>();
  if (key) {
    for (let i = 0; i < unique.length; i += 50) {
      const q = new URLSearchParams({ part: 'snippet,statistics,contentDetails', id: unique.slice(i, i + 50).join(','), key });
      for (const v of (await getJson(`${YT_API}/videos?${q}`, 'YouTube videos')).items ?? []) {
        const th = v.snippet?.thumbnails ?? {};
        metas.set(v.id, {
          title: v.snippet?.title, channel: v.snippet?.channelTitle,
          viewCount: v.statistics?.viewCount !== undefined ? +v.statistics.viewCount : undefined,
          duration: isoDuration(v.contentDetails?.duration), thumb: (th.maxres ?? th.medium ?? th.high)?.url,
        });
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
  const have = new Set(list.map((o) => o.id));
  const added: Record<string, unknown>[] = [];
  for (const id of unique) {
    const m = metas.get(id);
    if (!m || have.has(id)) continue;
    // the biggest 16:9 picture there is (a 4:3 one has bars, which the preview's crop removes)
    let file: string | undefined;
    for (const u of [`https://i.ytimg.com/vi/${id}/maxresdefault.jpg`, `https://i.ytimg.com/vi/${id}/hq720.jpg`, m.thumb, `https://i.ytimg.com/vi/${id}/mqdefault.jpg`]) {
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
    const entry = { file, id, url: `https://www.youtube.com/watch?v=${id}`, title: m.title, channel: m.channel,
      ...(m.viewCount !== undefined ? { viewCount: m.viewCount, views: views(m.viewCount, lang) } : {}), ...(m.duration ? { duration: m.duration } : {}) };
    list.push(entry);
    added.push(entry);
  }
  writeFileSync(listFile, JSON.stringify(list, null, 2) + '\n');
  console.log(`${path.relative(ROOT, listFile) || listFile}: ${added.length} added, ${list.length} in all${key ? '' : ' (titles and channels from oEmbed; YOUTUBE_API_KEY adds views and lengths)'}`);
  for (const o of added) console.log(`  ${o.id}  ${(o.views as string) ?? ''}  ${o.channel}: ${o.title}`);
  console.log(`preview takes them with --niche ${path.relative(ROOT, outDir) || outDir}. Other people's images, for comparison only: keep them out of the project's assets and out of git.`);
}

// ---------------------------------------------------------------------------------------------------------------
// check

type Finding = { level: 'ok' | 'note' | 'warn' | 'FAIL'; what: string; msg: string };

/** YouTube's count for the tags field: every character, a comma between tags, and quotes around a tag with a space. */
function tagsLength(tags: string[]): number {
  return tags.reduce((n, t) => n + chars(t) + (/\s/.test(t) ? 2 : 0), 0) + Math.max(0, tags.length - 1);
}

/** The chapter list YouTube reads: the first run of lines starting with a timestamp, when it starts at 0:00.
 *  A timestamp that isn't a time ("0:99") is reported, not read as the time it would add up to. */
function chapters(desc: string): { list: { t: number; label: string; line: number }[]; stray: number; invalid: string[] } {
  const lines = desc.split('\n');
  const stamp = /^\s*[([]?((?:\d+:)?\d{1,2}:\d{2})[)\]]?\s*[-–—:|]?\s*(.*)$/;
  const list: { t: number; label: string; line: number }[] = [];
  const invalid: string[] = [];
  let stray = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = stamp.exec(lines[i]);
    if (!m) { if (list.length) break; continue; }
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
  const out: Finding[] = [];
  const add = (level: Finding['level'], what: string, msg: string) => out.push({ level, what, msg });

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
  } else add('note', 'thumbnails', 'none (thumbnail-1.png ...)');

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
    if (!desc) add('FAIL', 'description.txt', 'empty');
    else if (n > DESCRIPTION_MAX) add('FAIL', 'description.txt', `${n} characters: YouTube's limit is ${DESCRIPTION_MAX}`);
    else if (/[<>]/.test(desc)) add('FAIL', 'description.txt', `has < or > (line ${desc.split('\n').findIndex((l) => /[<>]/.test(l)) + 1}), which YouTube refuses`);
    else add('ok', 'description.txt', `${n} characters; it opens "${first.slice(0, 90)}${first.length > 90 ? '...' : ''}"`);
    // (YouTube's help counts 5,000 characters, its Data API 5,000 bytes: an accent takes two, an emoji four)
    const bytes = Buffer.byteLength(desc, 'utf8');
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

  // tags
  const tagsFile = path.join(dir, 'tags.txt');
  if (existsSync(tagsFile)) {
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

  const pad = Math.max(...out.map((f) => f.what.length));
  for (const f of out) console.log(`${f.level.padEnd(4)}  ${f.what.padEnd(pad)}  ${f.msg}`);
  const fails = out.filter((f) => f.level === 'FAIL').length;
  if (fails) console.log(`${fails} problem(s): YouTube would refuse or ignore them${full ? ', or the package is incomplete' : ''}.`);
  else console.log(`Nothing YouTube would refuse${thumbs.length && !decoded ? ' in what could be read (the thumbnails from their headers only: they weren\'t decoded)' : ''}. This checks limits, not whether it is good: look at the preview.`);
  if (fails) process.exit(1);
}

// ---------------------------------------------------------------------------------------------------------------

try {
  if (mode === 'shoot') await shoot();
  else if (mode === 'preview') await preview();
  else if (mode === 'niche') await niche();
  else await check();
} catch (e) {
  server?.stop(true);
  fail(e instanceof Error ? e.message : String(e));
}
