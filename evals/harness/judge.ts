#!/usr/bin/env bun
// Blind pairwise judging: which of two videos made for the same request would the person who asked rather
// have. It is how a set is compared (evals/README.md, "The gate for a change of taste"): two runs of one case,
// with and without the skills, or with two versions of their text.
//
//   bun evals/harness/judge.ts --a <run folder> --b <run folder> [--model <id>] [--effort <level>] [--n 3]
//       [--a-video <mp4>] [--b-video <mp4>] [--out <dir>] [--dry]
//
// A run folder is a task run's (evals/results/tasks/<run>): its result.json gives the request, word for word,
// and its work/ the video (the full render when there is one, else the newest draft; --a-video and --b-video
// name one instead). Each judge is a fresh headless Claude Code session that gets a folder with the two videos as
// X and Y and nothing else: each video copied without its metadata, sheets of its frames labelled with their
// times, and five full-size stills. Which run is X changes from one judge to the next, so a preference for the
// first one seen cancels out, and nothing in the folder or its path says which run is which. A judge is a
// session with the machine's files in reach, not a sandbox: the folder above its own holds no verdict and no
// other judge's transcript while it works (a folder that already has a judging is refused), and past that its
// blindness rests on having no reason to look elsewhere. One call at a time for an --out folder; and a judging
// stopped by hand leaves no transcripts, since they are written when every judge is done.
//
// A judge can't reward taste past its own, and can't hear: verdict.json records the model each judge ran, as its
// transcript names it, beside its vote, and says the picture alone was judged. For a comparison that decides
// something, the judge is the strongest model there is, and the director (pick.ts builds their page from the
// folders this writes). The question is one fixed prompt (below), two-sided on purpose: neither the busier nor
// the quieter video is better in itself.
import { mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { cleanClaudeProjects } from './claude-projects-cleanup';

const argv = process.argv.slice(2);
const opt = (k: string, d?: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const fail = (m: string): never => { console.error(m); process.exit(2); };

const REPO = path.resolve(import.meta.dir, '..', '..');
const A = opt('a'), B = opt('b');
if (!A || !B) fail('usage: bun evals/harness/judge.ts --a <run folder> --b <run folder> [--model <id>] [--effort <level>] [--n 3]');
const MODEL = opt('model'), EFFORT = opt('effort');
const N = Number(opt('n', '3'));
if (!Number.isInteger(N) || N < 1) fail(`--n ${opt('n')}: how many judges, a whole number from 1`);
const STAMP = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = path.resolve(opt('out', path.join(REPO, 'evals', 'results', 'judge', STAMP))!);
const FONTS = path.join(REPO, 'skills', 'code-video', 'assets', 'template-webgl', 'public', 'fonts');
const TIMEOUT_MS = 30 * 60_000;

const run = (cmd: string[], cwd?: string) => {
  const p = Bun.spawnSync(cmd, { cwd, stdout: 'pipe', stderr: 'pipe' });
  if (p.exitCode !== 0) throw new Error(`${cmd.slice(0, 3).join(' ')} … failed:\n${p.stderr.toString().slice(-800)}`);
  return p.stdout.toString();
};

// ---------------------------------------------------------------- the two runs
type Side = { run: string; video: string; request: string[]; duration: number; width: number; height: number };

/**
 * The video a run delivered: its full render when there is one, else its newest draft. A project made with the
 * skills renders under out/, so an .mp4 anywhere else in it (footage the user gave, a generated clip in a
 * video's assets) is not looked at when out/ has one. A run without the skills writes where it likes: every
 * .mp4 counts there, and --a-video or --b-video names the one meant when that picks wrong.
 */
function findVideo(runDir: string): string {
  const work = existsSync(path.join(runDir, 'work')) ? path.join(runDir, 'work') : runDir;
  const found: { file: string; at: number; rank: number }[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (!/^(node_modules|\.git|\.audara-cache|\.claude|\.agents|footage)$/.test(e.name) && !e.name.endsWith('.pieces')) walk(p);
      } else if (/\.mp4$/i.test(e.name)) {
        // (a clip or a critic's render is named or filed as one: render.ts's -preview, -only-<ids> and -<from>-<to>,
        // and the wip/ and critique/ folders; the whole video's draft is <video>-draft.mp4, outside them)
        const aside = /(^|[\\/])(wip|critique|stills|sheets)([\\/]|$)/.test(path.relative(work, p));
        const part = /-(preview|only-[^.]*|\d+(\.\d+)?-\d+(\.\d+)?)(-draft)?\.mp4$/i.test(e.name);
        const draft = /-draft\.mp4$/i.test(e.name);
        // (render.ts's delivery is named for its folder, out/<video>/<video>.mp4: ahead of a check or an older
        // version the session rendered beside it)
        const named = e.name.toLowerCase() === `${path.basename(d).toLowerCase()}.mp4`;
        found.push({ file: p, at: statSync(p).mtimeMs, rank: aside || part ? 0 : draft ? 1 : named ? 3 : 2 });
      }
    }
  };
  if (existsSync(path.join(work, 'out'))) walk(path.join(work, 'out'));
  // (an out/ with only a clip in it, as a run without the skills may have beside its video: the whole project)
  if (!found.some((v) => v.rank >= 1)) { found.length = 0; walk(work); }
  if (!found.length) fail(`no .mp4 under ${work}: a run stopped before its first draft (--until) has no video to judge`);
  // the delivery by its name, else another full render, else the whole video's draft, else whatever is newest
  return found.sort((x, y) => y.rank - x.rank || y.at - x.at)[0]!.file;
}

function side(runDir: string, video?: string): Side {
  const dir = path.resolve(runDir);
  let request: string[] = [];
  try { request = (JSON.parse(readFileSync(path.join(dir, 'result.json'), 'utf8')).turns as { prompt: string }[]).map((t) => t.prompt); } catch { /* not a task run's folder */ }
  const file = path.resolve(video ?? findVideo(dir));
  const probe = JSON.parse(run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height:format=duration', '-of', 'json', file]));
  return { run: dir, video: file, request, duration: Number(probe.format.duration), width: probe.streams[0].width, height: probe.streams[0].height };
}

const a = side(A!, opt('a-video')), b = side(B!, opt('b-video'));
const request = a.request.length ? a.request : b.request;
if (!request.length) fail(`neither folder has a result.json with the request: judge.ts takes task runs' folders`);
if (a.request.length && b.request.length && a.request[0] !== b.request[0]) fail(`the two runs answer different requests:\n  a: ${a.request[0]}\n  b: ${b.request[0]}`);
console.log(`a: ${path.relative(REPO, a.video)} (${a.duration.toFixed(1)} s)\nb: ${path.relative(REPO, b.video)} (${b.duration.toFixed(1)} s)`);

// ---------------------------------------------------------------- what a judge gets
/** Frames a second on the sheets: four for a short piece, fewer for a long one, so its pages stay countable. */
const rateFor = (d: number) => (d <= 60 ? 4 : d <= 240 ? 2 : 1);
const RATE = rateFor(Math.max(a.duration, b.duration));

function pack(dir: string, s: Side) {
  mkdirSync(dir, { recursive: true });
  // the video without the metadata that could name its maker (the encoder's tags, a title)
  run(['ffmpeg', '-v', 'error', '-y', '-i', s.video, '-map', '0:v:0', '-map', '0:a?', '-c', 'copy', '-map_metadata', '-1', '-map_chapters', '-1', '-fflags', '+bitexact', path.join(dir, 'video.mp4')]);
  // sheets: thumbnails of about 384x216's area whatever the shape, as many to a page as stay readable when the
  // page is looked at whole (under about 1940 x 1900 px), each labelled with its time in seconds
  const w = Math.max(2, Math.round(Math.sqrt(384 * 216 * (s.width / s.height)) / 2) * 2), h = Math.max(2, Math.round((w * s.height) / s.width / 2) * 2);
  const cols = Math.max(1, Math.floor(1940 / w)), rows = Math.max(1, Math.floor(1900 / h));
  // (run from the fonts folder, so the font's path needs no drive colon inside the filter)
  run(['ffmpeg', '-v', 'error', '-y', '-i', s.video, '-an', '-vf',
    // (the time as 12.25: the sheet's rates all land on hundredths)
    `fps=${RATE},scale=${w}:${h},drawtext=fontfile=IBMPlexMono-Medium.ttf:text='%{eif\\:floor(t)\\:d}.%{eif\\:mod(round(t*100)\\,100)\\:d\\:2} s':x=6:y=6:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=4,tile=${cols}x${rows}`,
    path.join(dir, 'sheet-%02d.png')], FONTS);
  for (const k of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    const t = s.duration * k;
    run(['ffmpeg', '-v', 'error', '-y', '-ss', t.toFixed(3), '-i', s.video, '-frames:v', '1', path.join(dir, `still-${t.toFixed(2)}s.png`)]);
  }
}

/**
 * Packet 0 shows run a as X; packet 1 shows it as Y. A packet folder is this tool's only while its mark stands
 * beside it (<out>/p0.mark: never inside, where a judge works). The mark is written before the packet is built
 * and holds, once the packet is whole, a hash of the two files' paths, sizes and times, which names no run. A
 * whole packet of these same files is used again (a --dry before the judges); one cut short, or made from
 * other files, is built again; and a p0 or p1 folder with no mark is somebody else's: nothing is removed.
 */
const packets = [path.join(OUT, 'p0'), path.join(OUT, 'p1')];
const stamp = (s: Side) => { const st = statSync(s.video); return `${s.video}|${st.size}|${Math.round(st.mtimeMs)}`; };
const inside = (dir: string, file: string) => { const rel = path.relative(dir, file); return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel); };
for (const s of [a, b]) for (const dir of packets) {
  if (inside(dir, s.video)) fail(`${s.video} is inside ${dir}, a folder this builds: copy the video out of it, or give another --out`);
}
/** What --out already holds of a judging (set below, before the first packet): its packets are that judging's. */
let judged: string[] = [];
function packet(i: number) {
  const dir = packets[i]!, x = i === 0 ? a : b, y = i === 0 ? b : a;
  const mark = `${dir}.mark`, want = Bun.hash([stamp(x), stamp(y), RATE].join('\n')).toString(36);
  if (existsSync(dir)) {
    if (!existsSync(mark)) fail(`${dir} exists and judge.ts did not make it (no ${path.basename(mark)} beside it): give another --out, or remove the folder`);
    if (readFileSync(mark, 'utf8') === want) return dir;
  }
  // (built or built again from here on: never under a verdict, which would then describe other videos)
  if (judged.length) fail(`${OUT} holds a judging (${judged.join(', ')}) of other videos than these, or of packets no longer whole: give another --out`);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
  writeFileSync(mark, 'building'); // (this tool's from here on, and not whole until the hash replaces the word)
  pack(path.join(dir, 'X'), x);
  pack(path.join(dir, 'Y'), y);
  writeFileSync(mark, want);
  return dir;
}

const said = request.length === 1
  ? `The request, word for word:\n"${request[0]}"`
  : `What you asked for, word for word, then what you said as it was made:\n${request.map((r, i) => `${i + 1}. "${r}"`).join('\n')}`;
const PROMPT = `Two videos, X and Y, were made for the same request. You are the person who asked.

${said}

In this folder are X/ and Y/, each with video.mp4, sheet-NN.png (the video's frames in order, ${RATE} a second, each labelled with its time in seconds: look at every page of both) and still-*.png (full-size frames, named by their time). Take any other frame you want with ffmpeg. You can't play the sound: judge the picture, and its motion as far as frames show it, and don't guess about the rest.

Look at both whole before you decide. Then say which one you would rather have been given. What counts: whether it does what was asked; whether it was made for this request, or would fit any request like it; whether it would hold a stranger to the end; whether it is well made (composition, type, motion, nothing broken, empty or unreadable). Neither spectacle nor restraint is better in itself: a quiet piece that suits the request beats a busy one that doesn't, and the other way round.

Change nothing, and write no file. Reply with one JSON object and nothing else:
{"better": "X" | "Y" | "tie", "margin": "slight" | "clear" | "decisive", "why": "<two or three sentences>", "X": {"best": "<its strongest moment, with its time>", "worst": "<its weakest, with its time>"}, "Y": {"best": "...", "worst": "..."}}`;

// ---------------------------------------------------------------- the judges
// (as task.ts's runs: no browser, no desktop, no connectors, and not this repo's own notes, which Claude Code
// would read from the folders above the packet)
const DESKTOP = /computer[-_ ]?use|browser|chrome|chromium|playwright|puppeteer|selenium|webdriver|\bcua|_cua|node_repl/i;
function claudeFlags(): string[] {
  let on: Record<string, unknown> = {};
  try { on = JSON.parse(readFileSync(path.join(process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'), 'settings.json'), 'utf8')).enabledPlugins ?? {}; } catch { /* no settings */ }
  const off = Object.keys(on).filter((p) => on[p] && (DESKTOP.test(p) || /^audara-studio(@|$)/.test(p)));
  const settings = { claudeMdExcludes: [path.join(REPO, 'CLAUDE.md'), path.join(REPO, 'AGENTS.md')], ...(off.length ? { enabledPlugins: Object.fromEntries(off.map((p) => [p, false])) } : {}) };
  return ['--no-chrome', '--strict-mcp-config', '--settings', JSON.stringify(settings)];
}
const env: Record<string, string | undefined> = { ...process.env, ENABLE_CLAUDEAI_MCP_SERVERS: 'false' };
delete env.ELEVENLABS_API_KEY;
delete env.OPENAI_API_KEY;

type Vote = { judge: number; better: 'a' | 'b' | 'tie' | null; margin?: string; why?: string; seen: { X: 'a' | 'b'; Y: 'a' | 'b' }; a?: unknown; b?: unknown; model?: string; seconds: number; error?: string };

/** Each judge's transcript, written once all are done: one still at work can't read another's a folder up. */
const transcripts: string[] = [];
async function judge(i: number): Promise<Vote> {
  const flip = i % 2 === 1, cwd = packet(flip ? 1 : 0);
  const seen = { X: flip ? 'b' : 'a', Y: flip ? 'a' : 'b' } as Vote['seen'];
  const t0 = performance.now();
  const p = Bun.spawn(['claude', '-p', PROMPT, '--output-format', 'stream-json', '--verbose', '--permission-mode', 'auto', ...claudeFlags(),
    ...(MODEL ? ['--model', MODEL] : []), ...(EFFORT ? ['--effort', EFFORT] : [])], { cwd, env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
  const timer = setTimeout(() => { try { process.platform === 'win32' ? Bun.spawnSync(['taskkill', '/T', '/F', '/PID', String(p.pid)]) : p.kill(); } catch { /* it ended meanwhile */ } }, TIMEOUT_MS);
  const [out] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  await p.exited;
  clearTimeout(timer);
  transcripts[i] = out;
  let model: string | undefined, reply = '';
  for (const line of out.split('\n')) {
    let ev: any;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev?.type === 'system' && ev.subtype === 'init' && typeof ev.model === 'string') model ??= ev.model;
    if (ev?.type === 'result' && typeof ev.result === 'string') reply = ev.result;
  }
  const seconds = Math.round((performance.now() - t0) / 1000);
  // (the answer is one JSON object; a judge that wraps it in a sentence or a code fence still counts)
  const m = /\{[\s\S]*"better"[\s\S]*\}/.exec(reply);
  let v: any = null;
  try { v = m ? JSON.parse(m[0]) : null; } catch { /* not JSON */ }
  if (!v || !['X', 'Y', 'tie'].includes(v.better)) return { judge: i + 1, better: null, seen, model, seconds, error: `no verdict in its reply: ${reply.slice(0, 200) || '(empty)'}` };
  const better = v.better === 'tie' ? 'tie' : seen[v.better as 'X' | 'Y'];
  return { judge: i + 1, better, margin: v.margin, why: v.why, seen, [seen.X]: v.X, [seen.Y]: v.Y, model, seconds };
}

mkdirSync(OUT, { recursive: true });
// (a judge works one folder below this one: a verdict or a transcript already here would tell it which run was
// which, or what an earlier judge thought)
// (--dry may still look at such a folder's packets, as they are: packet() builds none there)
judged = readdirSync(OUT).filter((n) => n === 'verdict.json' || n === 'claude-sessions' || /^judge-\d+\.jsonl$/.test(n));
if (judged.length && !argv.includes('--dry')) fail(`${OUT} already holds a judging (${judged.join(', ')}): give another --out`);
packet(0);
packet(1); // (with one judge too: pick.ts draws either order for the director's page)
// --dry: the packets and the prompt, and no judge (to look at what one would get, or to judge by eye)
if (argv.includes('--dry')) { console.log(`\n${PROMPT}\n\n${OUT}`); process.exit(0); }
const votes = await Promise.all(Array.from({ length: N }, (_, i) => judge(i)));
for (const [i, out] of transcripts.entries()) writeFileSync(path.join(OUT, `judge-${i + 1}.jsonl`), out ?? '');
cleanClaudeProjects(false, path.join(OUT, 'claude-sessions'), OUT);

const tally = { a: 0, b: 0, tie: 0, none: 0 };
for (const v of votes) tally[v.better ?? 'none']++;
const models = [...new Set(votes.flatMap((v) => v.model ?? []))];
writeFileSync(path.join(OUT, 'verdict.json'), JSON.stringify({
  request,
  a: { run: path.relative(REPO, a.run).replaceAll('\\', '/'), video: path.relative(a.run, a.video).replaceAll('\\', '/') },
  b: { run: path.relative(REPO, b.run).replaceAll('\\', '/'), video: path.relative(b.run, b.video).replaceAll('\\', '/') },
  // (the judge as the transcripts name it; modelArg is what --model asked for)
  judge: { tool: 'claude', model: models.join(', ') || null, modelArg: MODEL ?? null, effortArg: EFFORT ?? null, judged: 'the picture, from frames: no sound, and motion only as frames show it' },
  tally, votes,
}, null, 1));
console.log(`a ${tally.a}, b ${tally.b}, tie ${tally.tie}${tally.none ? `, no verdict ${tally.none}` : ''}  (judge: ${models.join(', ') || 'unknown'})`);
for (const v of votes) console.log(`  ${v.judge}: ${v.better ?? 'none'}${v.margin ? ` (${v.margin})` : ''}  ${v.why ?? v.error ?? ''}`);
console.log(OUT);
