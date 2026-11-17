#!/usr/bin/env bun
// Offline tests of youtube-package's scripts/youtube.ts: check's rules (chapters, title, tags, hashtags,
// Markdown, images that don't decode or aren't 16:9) and shoot's diagnostics (a font that doesn't load, a
// character a font lacks, a missing image, the exit codes), and niche's numbers against a local stand-in for the
// Data API. No network, no paid call; shoot and check start a local Chrome. Run: bun evals/tests/test_youtube.ts
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
    'title.txt': 'O que o Claude disse é inquietante\n',
    'description.txt': 'Perguntei pra IA se ela era consciente.\n\nCAPÍTULOS\n0:00 Começo\n0:17 Meio\n1:10 Fim\n\n#IA #Claude\n',
    'tags.txt': 'inteligência artificial, ia, claude, canal curioso\n',
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
  // a stamp with digits past a time ("0:100") is no time either, not 0:10 with a "0" in the name (codex's review)
  pkg('long-stamps', { 'description.txt': '16:9 and 1:1 crops.\n\nChapters\n0:00 Start\n0:100 Middle\n0:200 End\n0:10:0 Late\n1:22:33:44 Far\n' });
  r = run(['check', 'long-stamps', '--duration', '40']);
  expect('check: "0:100" or "0:10:0" is not read as 0:10, nor a ratio opening a line as a timestamp', r.code === 1 && /"0:100" isn't a time/.test(r.out)
    && /"0:200" isn't a time/.test(r.out) && /"0:10:0" isn't a time/.test(r.out) && /"1:22:33:44" isn't a time/.test(r.out)
    && !/"16:9" isn't|"1:1" isn't/.test(r.out), r.out);
  // Codex's reproduction: with a one-digit last part, the stamp used to shrink to 0:10 and pass
  pkg('short-tail', { 'description.txt': '0:00 Start\n0:10:0 Middle\n0:20:0 End\n' });
  r = run(['check', 'short-tail', '--duration', '40']);
  expect('check: "0:10:0" and "0:20:0" fail, not read as 0:10 and 0:20', r.code === 1 && /"0:10:0" isn't a time/.test(r.out) && /"0:20:0" isn't a time/.test(r.out), r.out);
  // the forms that are times still read: hours, a bracket, a colon or dash after the stamp
  pkg('stamp-forms', { 'description.txt': 'Capítulos\n(0:00) Começo\n0:15: Meio\n1:05:30 - Fim\n' });
  r = run(['check', 'stamp-forms', '--duration', '1:10:00']);
  expect('check: (0:00), "0:15:" and 1:05:30 still read as chapters', r.code === 0 && !/isn't a time/.test(r.out), r.out);
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
  // niche with a key, against a local stand-in for the Data API: each video's views against its channel's
  // average per video and its subscribers (hidden ones left out), highest first; pictures from the API's own links
  const pic = readFileSync(path.join(root, 'pages', 'good.png'));
  const vids: Record<string, [number, string]> = { aaaaaaaaaaa: [2_158_820, 'UCbig'], bbbbbbbbbbb: [102_897, 'UCsmall'], ccccccccccc: [939, 'UChidden'] };
  const chans: Record<string, object> = {
    UCbig: { subscriberCount: '8520000', viewCount: '762194974', videoCount: '241', hiddenSubscriberCount: false },
    UCsmall: { subscriberCount: '20000', viewCount: '400000', videoCount: '40', hiddenSubscriberCount: false },
    UChidden: { subscriberCount: '0', viewCount: '3000', videoCount: '6', hiddenSubscriberCount: true },
  };
  const api = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req, server): Response {
    const u = new URL(req.url), base = `http://127.0.0.1:${server.port}`;
    if (u.pathname.startsWith('/img/')) return new Response(pic);
    if (u.pathname === '/search') return Response.json({ items: Object.keys(vids).map((videoId) => ({ id: { videoId } })) });
    if (u.pathname === '/videos') return Response.json({ items: u.searchParams.get('id')!.split(',').map((id) => ({ id,
      snippet: { title: `Video ${id[0]}`, channelTitle: vids[id][1], channelId: vids[id][1], publishedAt: '2025-07-25T13:00:00Z', thumbnails: { maxres: { url: `${base}/img/${id}.jpg` } } },
      statistics: { viewCount: String(vids[id][0]) }, contentDetails: { duration: 'PT15M11S' } })) });
    if (u.pathname === '/channels') return Response.json({ items: u.searchParams.get('id')!.split(',').map((id) => ({ id, statistics: chans[id] })) });
    return new Response('not here', { status: 404 });
  } });
  // one video already there from a run without a key (oEmbed: no numbers): this run adds them, keeping its picture
  mkdirSync(path.join(root, 'niche-api'));
  writeFileSync(path.join(root, 'niche-api', 'aaaaaaaaaaa.jpg'), 'the picture fetched before');
  writeFileSync(path.join(root, 'niche-api', 'niche.json'), JSON.stringify([{ file: 'aaaaaaaaaaa.jpg', id: 'aaaaaaaaaaa', title: 'Video a', channel: 'UCbig' }]));
  const np = Bun.spawn(['bun', SCRIPT, 'niche', '--search', 'como a ia cria imagens', '--out', 'niche-api', '--lang', 'pt'], { cwd: root, stdout: 'pipe', stderr: 'pipe',
    env: { ...process.env, YOUTUBE_API_KEY: 'test', YOUTUBE_API_URL: `http://127.0.0.1:${api.port}` } });
  const nout = await new Response(np.stdout).text() + await new Response(np.stderr).text();
  await np.exited; api.stop(true);
  let got: Record<string, any> = {};
  try { got = Object.fromEntries(JSON.parse(readFileSync(path.join(root, 'niche-api', 'niche.json'), 'utf8')).map((o: any) => [o.id, o])); } catch {}
  expect('niche: with a key, each video against its channel (average per video, subscribers; hidden ones left out)',
    np.exitCode === 0 && got.aaaaaaaaaaa?.vsChannel === 0.68 && got.aaaaaaaaaaa?.vsSubscribers === 0.25 && got.bbbbbbbbbbb?.vsChannel === 10
    && got.bbbbbbbbbbb?.vsSubscribers === 5.1 && got.ccccccccccc?.vsChannel === 1.9 && !('vsSubscribers' in got.ccccccccccc) && got.aaaaaaaaaaa?.published === '2025-07-25', nout + JSON.stringify(got));
  expect('niche: a video already in the folder gets the numbers a run with a key reads, and keeps its picture (codex\'s review)',
    /2 added, 1 updated, 3 in all/.test(nout) && got.aaaaaaaaaaa?.viewCount === 2_158_820 && got.aaaaaaaaaaa?.duration === '15:11'
    && readFileSync(path.join(root, 'niche-api', 'aaaaaaaaaaa.jpg'), 'utf8') === 'the picture fetched before', nout + JSON.stringify(got));
  const order = ['bbbbbbbbbbb', 'ccccccccccc', 'aaaaaaaaaaa'].map((id) => nout.indexOf(`  ${id}  `));
  expect('niche: lists the videos that outran their channel first', order.every((at, i) => at >= 0 && (i === 0 || at > order[i - 1])) && /10x its average, 5\.1x its subscribers/.test(nout), nout);

  // srt: subtitles from the narration's timed words, the video's own and translations' (no dub: each translated
  // sentence shown while its original sentence is spoken)
  const sub = path.join(root, 'subs'), sv = path.join(sub, 'videos', 'v');
  mkdirSync(path.join(sv, 'data'), { recursive: true });
  writeFileSync(path.join(sv, 'video.json'), JSON.stringify({ fps: 30, duration: 20, audio: null }));
  const timed = (text: string, t0: number, dur: number) => text.split(' ').map((w, i, a) => ({ w, start: +(t0 + dur * i / a.length).toFixed(3), end: +(t0 + dur * (i + 0.9) / a.length).toFixed(3) }));
  const S = ['Our journey begins here, a hundred kilometers above the surface of the Earth.', 'This is the edge of space.',
    'The colors come from real satellite photos taken by many satellites over many years.', 'The clouds are real too.'];
  writeFileSync(path.join(sv, 'data', 'words.json'), JSON.stringify({ lines: [
    { text: `${S[0]} ${S[1]}`, words: [...timed(S[0], 1, 4.5), ...timed(S[1], 6, 2)] },
    { text: `${S[2]} ${S[3]}`, words: [...timed(S[2], 9, 5), ...timed(S[3], 15, 1.8)] }] }));
  const tr: Record<string, string> = {
    ja: '私たちの旅はここから始まります、地表から百キロメートル上空です。 ここが宇宙の境目です。\n\n地表の色は長年たくさんの衛星が撮った本物の衛星写真から来ています。 雲も本物です。',
    ko: '우리의 여행은 여기, 지표면에서 백 킬로미터 위에서 시작됩니다. 여기가 우주의 경계입니다.\n\n색은 오랜 세월 많은 위성이 찍은 진짜 위성 사진에서 왔습니다. 구름도 진짜입니다.',
    ar: 'تبدأ رحلتنا من هنا، على ارتفاع مئة كيلومتر فوق سطح الأرض. هذه هي حافة الفضاء.\n\nالألوان مأخوذة من صور حقيقية التقطتها أقمار صناعية كثيرة على مدى سنوات طويلة. والغيوم حقيقية أيضًا.',
    hi: 'हमारी यात्रा यहीं से शुरू होती है, पृथ्वी की सतह से सौ किलोमीटर ऊपर। यह अंतरिक्ष का किनारा है।\n\nरंग कई सालों में कई उपग्रहों की ली गई असली सैटेलाइट तस्वीरों से आते हैं। बादल भी असली हैं।',
  };
  for (const [code, text] of Object.entries(tr)) {
    mkdirSync(path.join(sv, 'youtube', code), { recursive: true });
    writeFileSync(path.join(sv, 'youtube', code, 'narration.txt'), text + '\n');
  }
  writeFileSync(path.join(sv, 'youtube', 'notes.en.tsv'), '0:18\t1.5\t[100 km]\n');
  const inSub = (args: string[]) => { const p = Bun.spawnSync(['bun', SCRIPT, ...args], { cwd: sub, stdout: 'pipe', stderr: 'pipe' }); return { code: p.exitCode, out: p.stdout.toString() + p.stderr.toString() }; };
  const cues = (file: string) => readFileSync(file, 'utf8').trim().split(/\n\n+/).map((b) => { const l = b.split('\n'); return { at: l[1].slice(0, 12), lines: l.slice(2) }; });
  const g = (s: string, lang: string) => [...new Intl.Segmenter(lang, { granularity: 'grapheme' }).segment(s)].length;
  r = inSub(['srt', '--video', 'v', '--lang', 'en']);
  let c = r.code === 0 ? cues(path.join(sv, 'youtube', 'subtitles.en.srt')) : [];
  expect('srt: the video\'s own narration, lines of 42 at most, two a subtitle, from its first word', r.code === 0 && c.length >= 4
    && c.every((x) => x.lines.length <= 2 && x.lines.every((l) => l.length <= 42)) && c[0].at === '00:00:01,000', r.out + JSON.stringify(c));
  expect('srt: a timed note for words on screen, where nobody speaks', c.some((x) => x.at === '00:00:18,000' && x.lines.join(' ') === '[100 km]'), JSON.stringify(c));
  r = inSub(['srt', '--video', 'v', '--lang', 'ja']);
  c = r.code === 0 ? cues(path.join(sv, 'youtube', 'ja', 'subtitles.ja.srt')) : [];
  expect('srt: Japanese in lines of 13, no spaces, no line opening on a particle', r.code === 0 && c.length >= 3
    && c.every((x) => x.lines.every((l) => g(l, 'ja') <= 13 && !/\s/.test(l) && !/^(は|が|を|に|で|と|も|へ|の|から)/.test(l))), r.out + JSON.stringify(c));
  expect('srt: reports a reading speed over the language\'s guide', /over 4 \(the ja guide's adult speed\)/.test(r.out), r.out);
  r = inSub(['srt', '--video', 'v', '--lang', 'ko']);
  c = r.code === 0 ? cues(path.join(sv, 'youtube', 'ko', 'subtitles.ko.srt')) : [];
  expect('srt: Korean in lines of 16, its spaces kept', r.code === 0 && c.every((x) => x.lines.every((l) => g(l, 'ko') <= 16)) && c.some((x) => x.lines.some((l) => / /.test(l))), r.out + JSON.stringify(c));
  r = inSub(['srt', '--video', 'v', '--lang', 'ar']);
  c = r.code === 0 ? cues(path.join(sv, 'youtube', 'ar', 'subtitles.ar.srt')) : [];
  expect('srt: a translated sentence shows while its original is spoken (Arabic, the second at 0:06)', r.code === 0 && c.some((x) => x.at === '00:00:06,000' && /حافة الفضاء/.test(x.lines.join(' '))), r.out + JSON.stringify(c));
  r = inSub(['srt', '--video', 'v', '--lang', 'hi']);
  c = r.code === 0 ? cues(path.join(sv, 'youtube', 'hi', 'subtitles.hi.srt')) : [];
  expect('srt: Hindi lines measured in graphemes (42 at most) and cut at the danda', r.code === 0 && c.every((x) => x.lines.every((l) => g(l, 'hi') <= 42)) && c.some((x) => /।$/.test(x.lines[x.lines.length - 1])), r.out + JSON.stringify(c));
  mkdirSync(path.join(sv, 'youtube', 'xx'), { recursive: true });
  writeFileSync(path.join(sv, 'youtube', 'xx', 'narration.txt'), 'One paragraph only.\n');
  r = inSub(['srt', '--video', 'v', '--lang', 'xx']);
  expect('srt: a translation whose paragraphs don\'t match the narration\'s lines is refused', r.code === 2 && /one paragraph per line/.test(r.out), r.out);
  rmSync(path.join(sv, 'youtube', 'xx'), { recursive: true });
  {
    // a subtitle ended at its clause: what is left, with the next word, is split again until it fits (codex's
    // sixth review: "alle Rechtsschutzversicherungsgesellschaften und" was kept as one 48-character line)
    const dp = path.join(root, 'subs-de'), dv = path.join(dp, 'videos', 'v');
    mkdirSync(path.join(dv, 'data'), { recursive: true });
    const text = 'Bei den heutigen Themen sind, alle Rechtsschutzversicherungsgesellschaften und Betriebshaftpflichtversicherungen.';
    writeFileSync(path.join(dv, 'video.json'), JSON.stringify({ fps: 30, duration: 20, audio: null }));
    writeFileSync(path.join(dv, 'data', 'words.json'), JSON.stringify({ lines: [{ text, words: text.split(' ').map((w, i) => ({ w, start: 1 + i * 0.6, end: 1.5 + i * 0.6 })) }] }));
    const p = Bun.spawnSync(['bun', SCRIPT, 'srt', '--video', 'v', '--lang', 'de'], { cwd: dp, stdout: 'pipe', stderr: 'pipe' });
    const out = p.stdout.toString() + p.stderr.toString();
    const dc = p.exitCode === 0 ? cues(path.join(dv, 'youtube', 'subtitles.de.srt')) : [];
    expect('srt: what is left of a subtitle ended at its clause is split again until it fits (German, 42 at most)',
      p.exitCode === 0 && dc.length > 0 && dc.every((x) => x.lines.length <= 2 && x.lines.every((l) => g(l, 'de') <= 42)) && !/too long for two lines/.test(out), out + JSON.stringify(dc));
  }
  {
    // a word after the video's end joins no subtitle, in the video's language or a translation (codex's seventh
    // review: "Omit." at 5.1 s in a 5-second video was shown with "Keep." until 5.0)
    const kp = path.join(root, 'subs-end'), kv = path.join(kp, 'videos', 'v');
    mkdirSync(path.join(kv, 'data'), { recursive: true });
    mkdirSync(path.join(kv, 'youtube', 'es'), { recursive: true });
    writeFileSync(path.join(kv, 'video.json'), JSON.stringify({ fps: 30, duration: 5, audio: null }));
    writeFileSync(path.join(kv, 'data', 'words.json'), JSON.stringify({ lines: [{ text: 'Keep. Omit.', words: [
      { w: 'Keep.', start: 4.5, end: 4.8 }, { w: 'Omit.', start: 5.1, end: 5.4 }] }] }));
    writeFileSync(path.join(kv, 'youtube', 'es', 'narration.txt'), 'Guardar. Omitir.\n');
    const run = (code: string) => { const p = Bun.spawnSync(['bun', SCRIPT, 'srt', '--video', 'v', '--lang', code], { cwd: kp, stdout: 'pipe', stderr: 'pipe' }); return p.stdout.toString() + p.stderr.toString(); };
    const o1 = run('en'), o2 = run('es');
    const s1 = readFileSync(path.join(kv, 'youtube', 'subtitles.en.srt'), 'utf8'), s2 = readFileSync(path.join(kv, 'youtube', 'es', 'subtitles.es.srt'), 'utf8');
    expect('srt: a word after the video\'s end joins no subtitle, in its language and a translation',
      /Keep\./.test(s1) && !/Omit/.test(s1) && /Guardar\./.test(s2) && !/Omitir/.test(s2) && /1 word\(s\) after the video's end/.test(o1 + o2), o1 + s1 + o2 + s2);
    // a Japanese sentence timed whole (as eleven.py writes one) across the end: its words after the end are left out,
    // not squeezed into the time before it (codex's eighth review)
    const jv = path.join(kp, 'videos', 'j');
    mkdirSync(path.join(jv, 'data'), { recursive: true });
    writeFileSync(path.join(jv, 'video.json'), JSON.stringify({ fps: 30, duration: 5, audio: null }));
    const ja = '私たちの旅はここから始まります、地表から百キロメートル上空です。';
    writeFileSync(path.join(jv, 'data', 'words.json'), JSON.stringify({ lines: [{ text: ja, words: [{ w: ja, start: 4, end: 9.8125 }] }] }));
    const jp = Bun.spawnSync(['bun', SCRIPT, 'srt', '--video', 'j', '--lang', 'ja'], { cwd: kp, stdout: 'pipe', stderr: 'pipe' });
    const sj = jp.exitCode === 0 ? readFileSync(path.join(jv, 'youtube', 'subtitles.ja.srt'), 'utf8') : '';
    expect('srt: a Japanese sentence timed whole across the end shows only what is spoken before it',
      /私たちの旅は/.test(sj) && !/ここ|始まります|上空/.test(sj), jp.stdout.toString() + jp.stderr.toString() + sj);
    // a voice block placed after the video's end (at 5.1 s in a 5-second video, "from": 0.5): nothing of it is heard,
    // not even a word that crosses its start, in the video's language or a translation (codex's ninth review)
    const lv = path.join(kp, 'videos', 'late');
    mkdirSync(path.join(lv, 'data'), { recursive: true });
    mkdirSync(path.join(lv, 'audio'), { recursive: true });
    mkdirSync(path.join(lv, 'youtube', 'es'), { recursive: true });
    writeFileSync(path.join(lv, 'video.json'), JSON.stringify({ fps: 30, duration: 5, audio: null }));
    writeFileSync(path.join(lv, 'data', 'words.json'), JSON.stringify({ lines: [{ text: 'Hello.', words: [{ w: 'Hello.', start: 0, end: 1 }] }] }));
    writeFileSync(path.join(lv, 'audio', 'mix.wav.request.json'), JSON.stringify({ resolved: { duration: 10,
      voice: [{ file: 'videos/late/audio/narration.wav', at: 5.1, end: 7.1 }], timing_data: { 'words.json': { layer: 'voice', shift_s: 4.6 } } } }));
    writeFileSync(path.join(lv, 'youtube', 'es', 'narration.txt'), 'Hola.\n');
    // (an empty file left from before goes: it would be uploaded as subtitles with nothing in them)
    writeFileSync(path.join(lv, 'youtube', 'es', 'subtitles.es.srt'), '');
    const late = (args: string[]) => { const p = Bun.spawnSync(['bun', SCRIPT, ...args], { cwd: kp, stdout: 'pipe', stderr: 'pipe' }); return { code: p.exitCode, out: p.stdout.toString() + p.stderr.toString() }; };
    const l1 = late(['srt', '--video', 'late', '--lang', 'en']), l2 = late(['srt', '--video', 'late', '--lang', 'es']);
    expect('srt: a voice block after the video\'s end has no subtitle, not even a word crossing its start, and no empty file',
      l1.code === 0 && l2.code === 0 && /No subtitles: none of the narration is heard/.test(l1.out + l2.out)
      && !existsSync(path.join(lv, 'youtube', 'subtitles.en.srt')) && !existsSync(path.join(lv, 'youtube', 'es', 'subtitles.es.srt')), l1.out + l2.out);
    // and its language's package is whole without them (codex's tenth review: check --full asked for them either way)
    writeFileSync(path.join(lv, 'youtube', 'es', 'title.txt'), 'Un vídeo\n');
    writeFileSync(path.join(lv, 'youtube', 'es', 'description.txt'), 'Una breve introducción.\n');
    const l3 = late(['check', path.join('videos', 'late', 'youtube', 'es'), '--full']);
    expect('check --full: a language\'s folder for a video whose narration is never heard needs no subtitles',
      l3.code === 0 && /no timed narration heard in the video, so no subtitles/.test(l3.out), l3.out);
    // where the original is heard, so is its translation, even in a sliver of it: the last tenth of a sentence (a block
    // "from": 0.9 "dur": 0.1), or the moment between two translated words (codex's eleventh review: no Spanish file,
    // and check --full failed)
    for (const [name, text, es, row, shift] of [['tail', 'Hello.', 'Hola.', { at: 0, end: 0.1 }, -0.9],
      ['gap', 'Goodbye.', 'Hasta luego.', { at: 0, end: 0.02 }, -0.43]] as const) {
      const gv = path.join(kp, 'videos', name);
      mkdirSync(path.join(gv, 'data'), { recursive: true });
      mkdirSync(path.join(gv, 'audio'), { recursive: true });
      mkdirSync(path.join(gv, 'youtube', 'es'), { recursive: true });
      writeFileSync(path.join(gv, 'video.json'), JSON.stringify({ fps: 30, duration: 5, audio: null }));
      writeFileSync(path.join(gv, 'data', 'words.json'), JSON.stringify({ lines: [{ text, words: [{ w: text, start: 0, end: 1 }] }] }));
      writeFileSync(path.join(gv, 'audio', 'mix.wav.request.json'), JSON.stringify({ resolved: { duration: 5,
        voice: [{ file: `videos/${name}/audio/narration.wav`, ...row }], timing_data: { 'words.json': { layer: 'voice', shift_s: shift } } } }));
      writeFileSync(path.join(gv, 'youtube', 'es', 'narration.txt'), es + '\n');
      writeFileSync(path.join(gv, 'youtube', 'es', 'title.txt'), 'Un vídeo\n');
      writeFileSync(path.join(gv, 'youtube', 'es', 'description.txt'), 'Una breve introducción.\n');
      const g1 = late(['srt', '--video', name, '--lang', 'es']);
      const f = path.join(gv, 'youtube', 'es', 'subtitles.es.srt');
      const body = existsSync(f) ? readFileSync(f, 'utf8') : '';
      const g2 = late(['check', path.join('videos', name, 'youtube', 'es'), '--full']);
      expect(`srt: a translation is shown wherever its original is heard (${name === 'tail' ? 'the last tenth of a sentence' : 'between two translated words'}), and its package passes check --full`,
        g1.code === 0 && body.length > 0 && g2.code === 0, g1.out + body + g2.out);
    }
    // and not where only a pause inside its original is: a block playing 0.3-0.5 s of "Hello" (0-0.2) "world." (0.8-1.0)
    // plays no word of it (codex's twelfth review: "Hola mundo." was shown)
    const pv = path.join(kp, 'videos', 'pause');
    mkdirSync(path.join(pv, 'data'), { recursive: true });
    mkdirSync(path.join(pv, 'audio'), { recursive: true });
    mkdirSync(path.join(pv, 'youtube', 'es'), { recursive: true });
    writeFileSync(path.join(pv, 'video.json'), JSON.stringify({ fps: 30, duration: 5, audio: null }));
    writeFileSync(path.join(pv, 'data', 'words.json'), JSON.stringify({ lines: [{ text: 'Hello world.', words: [{ w: 'Hello', start: 0, end: 0.2 }, { w: 'world.', start: 0.8, end: 1 }] }] }));
    writeFileSync(path.join(pv, 'audio', 'mix.wav.request.json'), JSON.stringify({ resolved: { duration: 5,
      voice: [{ file: 'videos/pause/audio/narration.wav', at: 0, end: 0.2 }], timing_data: { 'words.json': { layer: 'voice', shift_s: -0.3 } } } }));
    writeFileSync(path.join(pv, 'youtube', 'es', 'narration.txt'), 'Hola mundo.\n');
    writeFileSync(path.join(pv, 'youtube', 'es', 'title.txt'), 'Un vídeo\n');
    writeFileSync(path.join(pv, 'youtube', 'es', 'description.txt'), 'Una breve introducción.\n');
    const q1 = late(['srt', '--video', 'pause', '--lang', 'es']);
    const q2 = late(['check', path.join('videos', 'pause', 'youtube', 'es'), '--full']);
    expect('srt: a translation isn\'t shown where only a pause inside its original is heard, and its package passes check --full',
      q1.code === 0 && !existsSync(path.join(pv, 'youtube', 'es', 'subtitles.es.srt')) && q2.code === 0, q1.out + q2.out);
  }

  // check: a language's folder, its subtitles and its dubbed track
  const wav = (seconds: number) => {
    const n = Math.round(seconds * 48000) * 4, b = Buffer.alloc(44 + n);
    b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16);
    b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(48000, 24); b.writeUInt32LE(192000, 28);
    b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n, 40); return b;
  };
  const ar = path.join(sv, 'youtube', 'ar');
  writeFileSync(path.join(ar, 'title.txt'), 'رحلة إلى حافة الفضاء\n');
  writeFileSync(path.join(ar, 'description.txt'), 'وصف قصير.\n');
  writeFileSync(path.join(ar, 'tags.txt'), 'فضاء\n');
  writeFileSync(path.join(ar, 'mix.wav'), wav(12));
  writeFileSync(path.join(ar, 'subtitles.bad.srt'), '1\n00:00:05,000 --> 00:00:04,000\nبعد\n\n2\nno time here\nنص\n');
  r = inSub(['check', '--video', 'v']);
  expect('check --video: each language\'s folder after the package', r.code === 1 && /youtube\/ar\//.test(r.out) && /youtube\/ja\//.test(r.out), r.out);
  expect('check: a dubbed track not as long as the video fails', /FAIL\s+mix\.wav\s+0:12 \(12\.000 s\)[^\n]*the video lasts 20\.000 s/.test(r.out), r.out);
  expect('check: a SubRip file with a cue that ends before it starts, and a block with no time, fails', /FAIL\s+subtitles\.bad\.srt\s+block 1: ends before it starts; block 2/.test(r.out), r.out);
  expect('check: a language\'s folder has no tags of its own (one list a video)', /note\s+tags\.txt\s+YouTube keeps one tag list per video/.test(r.out), r.out);
  writeFileSync(path.join(ar, 'mix.wav'), wav(20));
  rmSync(path.join(ar, 'subtitles.bad.srt'));
  r = inSub(['check', path.join('videos', 'v', 'youtube', 'ar'), '--full']);
  expect('check: a language\'s folder in full: title, description, subtitles, and its track the video\'s length', r.code === 0 && /ok\s+mix\.wav[^\n]*the video's length to a frame/.test(r.out) && /ok\s+subtitles\.ar\.srt/.test(r.out) && /ok\s+package\s+ar: the title, the description and the subtitles, the dubbed track/.test(r.out), r.out);
  writeFileSync(path.join(sv, 'youtube', 'title.txt'), 'A trip to the edge of space\n');
  writeFileSync(path.join(sv, 'youtube', 'description.txt'), 'A short description.\n');
  writeFileSync(path.join(sv, 'youtube', 'tags.txt'), 'space\n');
  rmSync(path.join(sv, 'youtube', 'subtitles.en.srt'));
  r = inSub(['check', path.join('videos', 'v', 'youtube'), '--full']);
  expect('check --full: a package whose video has timed narration needs its subtitles', r.code === 1 && /FAIL\s+package\s+no subtitles\.<code>\.srt/.test(r.out), r.out);

  // srt and check at the edges (codex's review): speech near the end, notes beside narration, no narration at all,
  // and SubRip files that aren't
  const ev = path.join(sub, 'videos', 'e');
  mkdirSync(path.join(ev, 'data'), { recursive: true });
  mkdirSync(path.join(ev, 'youtube', 'ja'), { recursive: true });
  writeFileSync(path.join(ev, 'video.json'), JSON.stringify({ fps: 30, duration: 10, audio: null }));
  // ("Bye." far enough from the line before not to join it: codex's reproduction, which 0.14.0's first fix dropped)
  const E1 = 'The planet turns.', E2 = 'Hello.', E3 = 'Bye.';
  writeFileSync(path.join(ev, 'data', 'words.json'), JSON.stringify({ lines: [
    { text: E1, words: timed(E1, 1, 1.5) }, { text: E2, words: timed(E2, 6, 1) }, { text: E3, words: timed(E3, 9.7, 0.2) }] }));
  writeFileSync(path.join(ev, 'youtube', 'ja', 'narration.txt'), '惑星は回ります。\n\nそして街の上に夜が来て、すべての明かりが一つずつ灯っていきます。\n\nまたね。\n');
  writeFileSync(path.join(ev, 'youtube', 'notes.en.tsv'), '0:00\t2\t[day]\n0:08.5\t3\t[night]\n0:03\t2\t[noon]\n');
  r = inSub(['srt', '--video', 'e', '--lang', 'ja']);
  const endOf = (stamp: string) => { const m = /(\d\d):(\d\d):(\d\d),(\d\d\d)$/.exec(stamp)!; return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000; };
  const ends = (file: string) => readFileSync(file, 'utf8').trim().split(/\n\n+/).map((b) => b.split('\n')[1].split(' --> ')).map(([a, z]) => [endOf(a), endOf(z)]);
  let span = r.code === 0 ? ends(path.join(ev, 'youtube', 'ja', 'subtitles.ja.srt')) : [];
  expect('srt: a subtitle near the video\'s end stays inside it', r.code === 0 && span.length > 0 && span.every(([, z]) => z <= 10), r.out + JSON.stringify(span));
  r = inSub(['srt', '--video', 'e', '--lang', 'en']);
  span = r.code === 0 ? ends(path.join(ev, 'youtube', 'subtitles.en.srt')) : [];
  expect('srt: a word spoken just before the video\'s end keeps its subtitle, ending with the video', r.code === 0 && /Bye\./.test(readFileSync(path.join(ev, 'youtube', 'subtitles.en.srt'), 'utf8')) && span[span.length - 1][1] === 10, r.out + JSON.stringify(span));
  expect('srt: notes placed one by one never overlap the narration or each other, and none runs past the end',
    r.code === 0 && span.every(([a, z], i) => z <= 10 && (i === 0 || a >= span[i - 1][1])) && /\[noon\]/.test(readFileSync(path.join(ev, 'youtube', 'subtitles.en.srt'), 'utf8')), r.out + JSON.stringify(span));
  const nv = path.join(sub, 'videos', 'n');
  mkdirSync(path.join(nv, 'youtube', 'es'), { recursive: true });
  writeFileSync(path.join(nv, 'video.json'), JSON.stringify({ fps: 30, duration: 60, audio: null }));
  writeFileSync(path.join(nv, 'youtube', 'es', 'title.txt'), 'Un título\n');
  writeFileSync(path.join(nv, 'youtube', 'es', 'description.txt'), 'Una descripción.\n');
  r = inSub(['check', path.join('videos', 'n', 'youtube', 'es'), '--full']);
  expect('check --full: a language\'s folder for a video with no timed narration needs no subtitles', r.code === 0 && /no timed narration heard in the video, so no subtitles/.test(r.out), r.out);
  writeFileSync(path.join(nv, 'youtube', 'es', 'subtitles.es.srt'), '\n');
  writeFileSync(path.join(nv, 'youtube', 'es', 'subtitles.xx.srt'), '1\n00:00:99,000 --> 00:01:02,000\nnope\n');
  r = inSub(['check', path.join('videos', 'n', 'youtube', 'es')]);
  expect('check: an empty SubRip file fails, and so does a time with 99 seconds', r.code === 1 && /FAIL\s+subtitles\.es\.srt\s+no subtitles in it/.test(r.out) && /FAIL\s+subtitles\.xx\.srt\s+block 1: a time that isn't one/.test(r.out), r.out);

  // srt: a narration its mix trims at the start (placed 5 s earlier than it begins) has no subtitle before 0 s
  const tv = path.join(sub, 'videos', 't');
  mkdirSync(path.join(tv, 'data'), { recursive: true });
  mkdirSync(path.join(tv, 'audio'), { recursive: true });
  writeFileSync(path.join(tv, 'video.json'), JSON.stringify({ fps: 30, duration: 10, audio: null }));
  writeFileSync(path.join(tv, 'audio', 'mix.wav.request.json'), JSON.stringify({ resolved: { timing_data: { 'words.json': { shift_s: -5 } } } }));
  writeFileSync(path.join(tv, 'data', 'words.json'), JSON.stringify({ lines: [
    { text: 'Cut opening.', words: [{ w: 'Cut', start: 1, end: 1.4 }, { w: 'opening.', start: 1.5, end: 2 }] },
    { text: 'Kept ending.', words: [{ w: 'Kept', start: 6, end: 6.4 }, { w: 'ending.', start: 6.5, end: 7 }] }] }));
  r = inSub(['srt', '--video', 't', '--lang', 'en']);
  const tsrt = r.code === 0 ? readFileSync(path.join(tv, 'youtube', 'subtitles.en.srt'), 'utf8') : '';
  const tchk = inSub(['check', path.join('videos', 't', 'youtube')]);
  expect('srt: narration trimmed before 0 s gets no subtitle (codex\'s review), and check passes', r.code === 0 && !/Cut opening/.test(tsrt)
    && /00:00:01,000 --> [^\n]*\nKept ending\./.test(tsrt) && tchk.code === 0, r.out + tsrt + tchk.out);

  // ...and a translation of a line whose first sentence the mix trims leaves that sentence out too (codex's review)
  writeFileSync(path.join(tv, 'data', 'words.json'), JSON.stringify({ lines: [{ text: 'Cut opening. Kept ending.', words: [
    { w: 'Cut', start: 1, end: 1.4 }, { w: 'opening.', start: 1.5, end: 2 }, { w: 'Kept', start: 6, end: 6.4 }, { w: 'ending.', start: 6.5, end: 7 }] }] }));
  mkdirSync(path.join(tv, 'youtube', 'es'), { recursive: true });
  writeFileSync(path.join(tv, 'youtube', 'es', 'narration.txt'), 'Inicio cortado. Final conservado.\n');
  r = inSub(['srt', '--video', 't', '--lang', 'es']);
  const tes = r.code === 0 ? readFileSync(path.join(tv, 'youtube', 'es', 'subtitles.es.srt'), 'utf8') : '';
  expect('srt: a translated sentence whose original the mix trims is left out', r.code === 0 && /Final conservado\./.test(tes) && !/Inicio cortado/.test(tes), r.out + tes);

  // shoot: a Korean face draws its characters a square wide, as the fallback does; it is still the face that draws
  const malgun = 'C:\\Windows\\Fonts\\malgunsl.ttf';
  if (existsSync(malgun)) {
    mkdirSync(path.join(root, 'pages', 'fonts'), { recursive: true });
    copyFileSync(malgun, path.join(root, 'pages', 'fonts', 'k.ttf'));
    pkg('pages', { 'ko.html': `<!doctype html><style>@font-face{font-family:'K';src:url('fonts/k.ttf')} body{margin:0;width:1280px;height:720px;background:#123} p{font:80px 'K';color:#fff;margin:80px}</style><p>구름도 진짜입니다</p>` });
    r = run(['shoot', 'pages/ko.html']);
    expect('shoot: a CJK face that has the characters isn\'t called a fallback (its glyphs, not its widths, are compared)', r.code === 0 && !/fallback|seems to lack/.test(r.out), r.out);
  } else console.log('skip  shoot: a CJK face (needs Windows\' Malgun Gothic Semilight to load as a web font)');
} finally {
  for (let i = 0; i < 20; i++) { try { rmSync(root, { recursive: true, force: true }); break; } catch { await Bun.sleep(200); } }
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
