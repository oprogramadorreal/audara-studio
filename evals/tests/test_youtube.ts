#!/usr/bin/env bun
// Offline tests of youtube-package's scripts/youtube.ts: check's rules (chapters, title, tags, hashtags,
// Markdown, images that don't decode or aren't 16:9) and shoot's diagnostics (a font that doesn't load, a
// character a font lacks, a missing image, the exit codes). No network, no paid call; shoot and check start
// a local Chrome. Run: bun evals/tests/test_youtube.ts
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO = path.resolve(import.meta.dir, '..', '..');
const SCRIPT = path.join(REPO, 'skills', 'youtube-package', 'scripts', 'youtube.ts');
const FONT = path.join(REPO, 'skills', 'code-video', 'assets', 'template-webgl', 'public', 'fonts', 'Archivo-w620-900.ttf');
const root = mkdtempSync(path.join(os.tmpdir(), 'audara-yt-test-'));
let passed = 0, failed = 0;

function run(args: string[]): { code: number; out: string } {
  const p = Bun.spawnSync(['bun', SCRIPT, ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe' });
  return { code: p.exitCode ?? -1, out: p.stdout.toString() + p.stderr.toString() };
}
function expect(name: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`ok    ${name}`); }
  else { failed++; console.log(`FAIL  ${name}${detail ? `\n      ${detail.split('\n').join('\n      ')}` : ''}`); }
}
/** A package folder with the given files; images are made by Chrome through shoot, so no encoder is needed here. */
function pkg(name: string, files: Record<string, string>): string {
  const dir = path.join(root, name);
  mkdirSync(dir, { recursive: true });
  for (const [f, body] of Object.entries(files)) writeFileSync(path.join(dir, f), body);
  return dir;
}

try {
  // shoot: a good page, then one with a missing font, a missing image and a character the font lacks
  mkdirSync(path.join(root, 'fonts'));
  copyFileSync(FONT, path.join(root, 'fonts', 'Archivo-w620-900.ttf'));
  const style = `@font-face{font-family:'A';src:url('/fonts/Archivo-w620-900.ttf')}
    @font-face{font-family:'Gone';src:url('/fonts/missing.ttf')}
    body{margin:0;width:1280px;height:720px;background:#202830}`;
  pkg('pages', {
    'good.html': `<!doctype html><meta charset="utf-8"><style>${style} h1{font:900 120px A;color:#f6f1eb;margin:60px}</style><h1>VOCÊ TEM CONSCIÊNCIA?</h1>`,
    'bad.html': `<!doctype html><meta charset="utf-8"><style>${style} .a{font:900 120px Gone;color:#fff} .b{font:900 60px A;color:#fff} .c{position:absolute;right:16px;bottom:12px;font:700 40px A;color:#fff}</style><div class="a">X</div><div class="b">Ç ✓ 日</div><div class="c">canto</div><img src="/nope.png">`,
    'wide.html': `<!doctype html><meta charset="utf-8"><style>body{margin:0;width:1000px;height:1000px;background:#345}</style><p>square</p>`,
  });
  let r = run(['shoot', 'pages/good.html']);
  expect('shoot: a clean page exits 0 and writes its PNG beside it', r.code === 0 && existsSync(path.join(root, 'pages', 'good.png')), r.out);
  expect('shoot: reports the type at 168 px wide', /120 px type, 15\.8 px at 168 wide/.test(r.out), r.out);
  r = run(['shoot', 'pages/bad.html']);
  expect('shoot: a page that loads wrong exits 1', r.code === 1, r.out);
  expect('shoot: names the face that did not load', /looks drawn by a fallback face, not "Gone"/.test(r.out) && /font "Gone" failed to load/.test(r.out), r.out);
  expect('shoot: names the characters a face lacks (not the accented ones it has)', /seems to lack "✓" "日"/.test(r.out) && !/lack[^\n]*"Ç"/.test(r.out), r.out);
  expect('shoot: flags text in the duration badge\'s corner', /enters the duration badge's corner/.test(r.out), r.out);
  expect('shoot: reports the missing image', /404 nope\.png/.test(r.out), r.out);
  r = run(['shoot', 'pages/good.png']);
  expect('shoot: refuses anything but an HTML page (it would overwrite a source)', r.code === 2, r.out);
  // images CSS draws: a broken one loads fine and then draws nothing (codex's review reproduced it)
  const cutOff = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  writeFileSync(path.join(root, 'pages', 'broken.png'), cutOff);
  writeFileSync(path.join(root, 'pages', 'broken-c.png'), cutOff);
  const noise = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8'%3E%3Crect width='8' height='8' fill='%23888'/%3E%3C/svg%3E`;
  pkg('pages', {
    'css-ok.html': `<!doctype html><style>body{margin:0;width:1280px;height:720px;background:url(good.png)} div{width:100px;height:100px;background-image:url("${noise}")} .m{background:#fff;mask-image:url(#cut)} .q{background:#fff;mask-image:url(css-ok.html#cut)}</style><svg width="0" height="0"><mask id="cut"><rect width="100" height="50" fill="#fff"/></mask></svg><div></div><div class="m"></div><div class="q"></div>`
      // (images nothing draws: on an element without a box, a hidden one, a ::before without content or not
      // displayed, the 2x candidate of an image-set at 1x, a file's or an inline one's; and a file Chrome fetched
      // for a hidden element, named again where nothing draws it)
      + `<div style="display:none;background:url(nope-none.png)"></div><div style="visibility:hidden;background:url(broken.png)"></div><p class="e"></p><style>.e::before{background:url(nope-before.png)} .e::after{content:'';display:none;background:url(nope-after.png)}</style>`
      + `<div style="display:none;background:url(broken.png)"></div><p class="f"></p><style>.f::before{background:url(broken.png)}</style>`
      + `<div style="width:100px;height:100px;background-image:image-set(url(good.png) 1x, url(nope-2x.png) 2x)"></div>`
      + `<div style="width:100px;height:100px;background-image:image-set(url(&quot;${noise}&quot;) 1x, url(&quot;data:image/png;base64,iVBORw0KGgoAAAAN&quot;) 2x)"></div>`,
    // (a broken background on a ::before, and on a display:contents element's ::before, which draws though its
    // element has no box)
    'css-bad.html': `<!doctype html><style>body{margin:0;width:1280px;height:720px;background:#123} div{width:100px;height:100px} div::before{content:'';display:block;width:100px;height:100px;background:url(broken.png)} .c{display:contents} .c::before{content:'';display:block;width:50px;height:50px;background:url(broken-c.png)}</style><div></div><span class="c"></span>`,
  });
  r = run(['shoot', 'pages/css-ok.html']);
  expect('shoot: CSS images that decode (a file, an inline SVG), a mask naming an SVG element and images nothing draws pass', r.code === 0, r.out);
  r = run(['shoot', 'pages/css-bad.html']);
  expect('shoot: a CSS background that doesn\'t decode fails, a display:contents element\'s ::before\'s too', r.code === 1 && /image didn't decode: pages\/broken\.png/.test(r.out) && /image didn't decode: pages\/broken-c\.png/.test(r.out), r.out);
  // CSS images still loading when the page is measured (set on load, served a second later), or reached through a
  // redirect, are decoded too (codex's review reproduced each passing)
  const slow = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
    if (new URL(req.url).pathname === '/alias.png') return Response.redirect('/target.png', 302);
    await Bun.sleep(1000);
    return new Response(readFileSync(path.join(root, 'pages', 'broken.png')));
  } });
  const far = `http://127.0.0.1:${slow.port}`;
  writeFileSync(path.join(root, 'pages', 'late.html'), `<!doctype html><style>body{margin:0;width:1280px;height:720px} div{width:100px;height:100px;background:url(${far}/alias.png)}</style><div></div><script>onload = () => { document.body.style.background = 'url(${far}/late.png)' }</script>`);
  const lp = Bun.spawn(['bun', SCRIPT, 'shoot', 'pages/late.html'], { cwd: root, stdout: 'pipe', stderr: 'pipe' }); // (async: the server answers from this process)
  const lateOut = await new Response(lp.stdout).text() + await new Response(lp.stderr).text();
  await lp.exited; slow.stop(true);
  expect('shoot: CSS images still loading, or reached through a redirect, are decoded too', lp.exitCode === 1 && /image didn't decode: late\.png/.test(lateOut) && /image didn't decode: alias\.png/.test(lateOut), lateOut);
  run(['shoot', 'pages/wide.html', '--size', '1000x1000', '--out', 'pages/square.png']);

  // check: a valid package
  const good = pkg('good', {
    'title.txt': 'A resposta do Claude é assustadora\n',
    'description.txt': 'Perguntei pra IA se ela era consciente.\n\nCAPÍTULOS\n0:00 Começo\n0:17 Meio\n1:10 Fim\n\n#IA #Claude\n',
    'tags.txt': 'inteligência artificial, ia, claude, o programador\n',
  });
  copyFileSync(path.join(root, 'pages', 'good.png'), path.join(good, 'thumbnail-1.png'));
  r = run(['check', 'good', '--duration', '4:26']);
  expect('check: a valid package passes', r.code === 0, r.out);
  expect('check: counts characters, not bytes (34 for an accented title)', /34 characters/.test(r.out), r.out);
  expect('check: tags counted as YouTube does (quotes around a tag with a space, commas between)', /4 tags, 51 of 500/.test(r.out), r.out);

  // check: what YouTube refuses or ignores
  const bad = pkg('bad', {
    'title.txt': 'x'.repeat(101) + '\n',
    'description.txt': '**Bold** <b>tags</b>\n0:00 Start\n0:05 Too soon\n0:20 End\n',
    'tags.txt': Array.from({ length: 60 }, (_, i) => `tag number ${i}`).join(', ') + '\n',
  });
  copyFileSync(path.join(root, 'pages', 'square.png'), path.join(bad, 'thumbnail-1.png'));
  writeFileSync(path.join(bad, 'thumbnail-2.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]));
  r = run(['check', 'bad', '--duration', '0:25']);
  expect('check: exits 1 when YouTube would refuse something', r.code === 1, r.out);
  expect('check: a title over 100 characters fails', /title\.txt\s+101 characters/.test(r.out), r.out);
  expect('check: angle brackets in the description fail', /has < or >/.test(r.out), r.out);
  expect('check: a chapter under 10 s fails the list', /lasts 5 s, under 10 s/.test(r.out), r.out);
  expect('check: the last chapter must last 10 s too', /the last chapter lasts 5\.0 s/.test(r.out), r.out);
  expect('check: tags over 500 as YouTube counts them fail', /characters as YouTube counts them .*the limit is 500/.test(r.out), r.out);
  expect('check: a square image fails (not 16:9)', /thumbnail-1\.png\s+1000x1000 PNG.*not 16:9/.test(r.out), r.out);
  expect('check: a damaged PNG fails', /thumbnail-2\.png\s+PNG that doesn't decode/.test(r.out), r.out);

  // check: chapters YouTube wouldn't make, hashtags past its limits, Markdown
  const odd = pkg('odd', {
    'description.txt': 'Intro text.\n1:00 A\n2:00 B\n3:00 C\n\n**bold** and [a link](https://example.com)\n' + Array.from({ length: 20 }, (_, i) => `#tag${i}`).join(' ') + '\n',
  });
  r = run(['check', 'odd']);
  expect('check: timestamps without 0:00 make no chapters (a warning)', /none at 0:00 first/.test(r.out), r.out);
  expect('check: Markdown marks are flagged', /has Markdown/.test(r.out), r.out);
  expect('check: more than 15 hashtags warn, without failing below 60', /20: a list that long reads as spam/.test(r.out) && r.code === 0, r.out);

  // check --full: the whole package, three thumbnails at the size asked for
  for (const i of [2, 3]) copyFileSync(path.join(good, 'thumbnail-1.png'), path.join(good, `thumbnail-${i}.png`));
  r = run(['check', 'good', '--duration', '4:26', '--full']);
  expect('check --full: three 1280x720 thumbnails and the three text files pass', r.code === 0 && /complete: three 1280x720 PNG thumbnails/.test(r.out), r.out);
  r = run(['check', 'odd', '--full']);
  expect('check --full: missing thumbnails and files fail', r.code === 1 && /0 thumbnails: the full package has three/.test(r.out) && /title\.txt is missing/.test(r.out), r.out);

  // check: limits at their edges, and what codex's review reproduced
  const edges = pkg('edges', {
    'description.txt': 'é'.repeat(4990) + '\n0:00 A\n0:99 B\n2:00 C\n' + Array.from({ length: 61 }, (_, i) => `#t${i}`).join(' ') + '\n',
  });
  r = run(['check', 'edges', '--duration', '200']);
  expect('check: the description counts characters, so 4,990 accented letters plus the rest pass 5,000 only past it', /description\.txt\s+\d+ characters: YouTube's limit is 5000/.test(r.out), r.out);
  expect('check: "0:99" is not a time', /"0:99" isn't a time/.test(r.out), r.out);
  expect('check: more than 60 hashtags fail', /61: over 60, YouTube ignores every hashtag/.test(r.out), r.out);
  const ok5000 = pkg('ok5000', { 'description.txt': 'ã'.repeat(5000) + '\n' });
  r = run(['check', 'ok5000']);
  expect('check: exactly 5,000 accented characters pass (characters, not bytes)', r.code === 0 && /5000 characters/.test(r.out), r.out);
  expect('check: past 5,000 bytes, a warning that the Data API counts bytes', /10000 bytes: Studio takes 5000 characters/.test(r.out), r.out);
  r = run(['check', 'does-not-exist', '--full', '--duration', '40']);
  expect('check: a mistyped folder fails instead of checking the folder above it', r.code === 2 && /no such folder or file/.test(r.out), r.out);
  const jpgs = pkg('jpgs', { 'title.txt': 'T\n', 'description.txt': 'D\n', 'tags.txt': 'a\n' });
  run(['shoot', 'pages/good.html', '--jpg', '90', '--out', 'jpgs/thumbnail-1.jpg']);
  for (const i of [2, 3]) copyFileSync(path.join(jpgs, 'thumbnail-1.jpg'), path.join(jpgs, `thumbnail-${i}.jpg`));
  r = run(['check', 'jpgs', '--full']);
  expect('check --full: JPEG thumbnails fail the PNG package', r.code === 1 && /is JPEG, not PNG/.test(r.out), r.out);
  r = run(['check', 'jpgs', '--full', '--jpg']);
  expect('check --full --jpg: the same JPEGs pass when JPEG was asked for', r.code === 0, r.out);

  // check without Chrome: thumbnails read from their headers, and one cut off before its size fails
  const noChrome = { ...process.env, CHROME_PATH: path.join(root, 'no-chrome.exe') };
  const headless = (args: string[]) => {
    const p = Bun.spawnSync(['bun', SCRIPT, ...args], { cwd: root, stdout: 'pipe', stderr: 'pipe', env: noChrome });
    return { code: p.exitCode ?? -1, out: p.stdout.toString() + p.stderr.toString() };
  };
  r = headless(['check', 'good', '--duration', '4:26', '--full']);
  expect('check without Chrome: whole thumbnails pass from their headers', r.code === 0 && /read from their headers only/.test(r.out) && /complete: three/.test(r.out), r.out);
  const cut = pkg('cut', { 'title.txt': 'T\n', 'description.txt': 'D\n', 'tags.txt': 'a\n' });
  for (const i of [1, 2, 3]) copyFileSync(path.join(root, 'pages', 'broken.png'), path.join(cut, `thumbnail-${i}.png`));
  r = headless(['check', 'cut', '--full']);
  expect('check without Chrome: a PNG cut off before its size fails (codex\'s review reproduced it passing)', r.code === 1 && /PNG whose header is cut off/.test(r.out), r.out);
  const jfill = pkg('jfill', {});
  // (a JPEG header with a fill byte before a marker, and a restart marker without a length, before its size)
  writeFileSync(path.join(jfill, 'thumbnail-1.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xd0, 0xff, 0xc0, 0, 11, 8, 2, 0xd0, 5, 0, 1, 1, 0x11, 0, 0, 0, 0]));
  r = headless(['check', 'jfill']);
  expect('check without Chrome: a JPEG header read past fill bytes and markers without a length', /thumbnail-1\.jpg\s+1280x720 JPEG/.test(r.out), r.out);

  // check: the length as the engine reads it (video.json's duration before a longer soundtrack: the case codex
  // reproduced, a 30 s video over 60 s of audio)
  mkdirSync(path.join(root, 'proj', 'videos', 'v', 'youtube'), { recursive: true });
  mkdirSync(path.join(root, 'proj', 'videos', 'v', 'data'), { recursive: true });
  writeFileSync(path.join(root, 'proj', 'videos', 'v', 'video.json'), JSON.stringify({ title: 'V', size: [1920, 1080], fps: 30, audio: 'song.wav', duration: 30 }));
  writeFileSync(path.join(root, 'proj', 'videos', 'v', 'data', 'audio.json'), JSON.stringify({ duration: 60 }));
  writeFileSync(path.join(root, 'proj', 'videos', 'v', 'youtube', 'description.txt'), 'x\n0:00 A\n0:10 B\n0:25 C\n');
  const lenRun = Bun.spawnSync(['bun', SCRIPT, 'check', '--video', 'v'], { cwd: path.join(root, 'proj'), stdout: 'pipe', stderr: 'pipe' });
  const lenOut = lenRun.stdout.toString() + lenRun.stderr.toString();
  expect('check: video.json\'s duration sets the length (the last chapter, 5 s of a 30 s video, fails)', lenRun.exitCode === 1 && /the last chapter lasts 5\.0 s/.test(lenOut) && /video\.json/.test(lenOut), lenOut);
  // the same video with the package in another folder: the length still comes from the video (codex's review)
  mkdirSync(path.join(root, 'proj', 'alternate'));
  writeFileSync(path.join(root, 'proj', 'alternate', 'description.txt'), 'x\n0:00 A\n0:10 B\n0:25 C\n');
  const altRun = Bun.spawnSync(['bun', SCRIPT, 'check', 'alternate', '--video', 'v'], { cwd: path.join(root, 'proj'), stdout: 'pipe', stderr: 'pipe' });
  const altOut = altRun.stdout.toString() + altRun.stderr.toString();
  expect('check: a package folder elsewhere still takes the video\'s length from --video', altRun.exitCode === 1 && /the last chapter lasts 5\.0 s/.test(altOut), altOut);

  // shoot: two pages with one name into one folder would overwrite each other
  mkdirSync(path.join(root, 'twins', 'a'), { recursive: true }); mkdirSync(path.join(root, 'twins', 'b'), { recursive: true });
  for (const d of ['a', 'b']) writeFileSync(path.join(root, 'twins', d, 'same.html'), '<!doctype html><body style="margin:0;width:1280px;height:720px;background:#123"></body>');
  r = run(['shoot', 'twins/a/same.html', 'twins/b/same.html', '--out', 'twins/out']);
  expect('shoot: refuses two pages that would write the same image', r.code === 2 && /would write the same image/.test(r.out), r.out);

  // preview: from the package folder, with other videos from a folder (no network); the same videos beside
  // every option (a regression: a second function named niche once shadowed the folder reader)
  mkdirSync(path.join(root, 'others'));
  copyFileSync(path.join(root, 'pages', 'good.png'), path.join(root, 'others', 'a.png'));
  writeFileSync(path.join(root, 'others', 'niche.json'), JSON.stringify([{ file: 'a.png', title: 'Another video', channel: 'Someone', views: '1K views', duration: '3:00' }]));
  r = run(['preview', 'good', '--niche', 'others', '--channel', 'Test', '--duration', '4:26', '--out', 'prev']);
  expect('preview: writes the size sheet, both feeds and the search row', r.code === 0 && ['sizes', 'feed-dark', 'feed-light', 'search'].every((n) => existsSync(path.join(root, 'prev', `${n}.png`))), r.out);
  expect('preview: says whether the title was cut', /title \(34 characters\): whole everywhere shown/.test(r.out), r.out);

  // niche: what it refuses before any network call
  r = run(['niche', 'not-a-link']);
  expect('niche: a bad link stops it before anything is fetched', r.code === 2 && /not a YouTube video link/.test(r.out), r.out);
  const nk = Bun.spawnSync(['bun', SCRIPT, 'niche', '--search', 'x'], { cwd: root, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, YOUTUBE_API_KEY: '' } });
  const so = nk.stdout.toString() + nk.stderr.toString();
  expect('niche: --search without YOUTUBE_API_KEY says what it needs', nk.exitCode === 2 && /YOUTUBE_API_KEY/.test(so), so);
} finally {
  for (let i = 0; i < 20; i++) { try { rmSync(root, { recursive: true, force: true }); break; } catch { await Bun.sleep(200); } }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
