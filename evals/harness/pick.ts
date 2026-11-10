#!/usr/bin/env bun
// A page for the director's own blind picks, beside the judges': bun evals/harness/pick.ts <config.json>
//
// config: { "out": <folder for the page>, "pairs": [{ "dir": <a judge.ts folder>, "title": <what the pair
//   compares, without saying which is which>, "note"?: <a line under the title>, "a": <what run a is>,
//   "b": <what run b is>, "facts"?: { "a": <a line about run a>, "b": <one about run b> }, "packet"?: 0 | 1 }] }
//
// Each pair shows the prompt, the two videos from judge.ts's own packets (copied there without their
// metadata) as X and Y with sound, and the question. Which is which is drawn for each pair (packet 0 shows run
// a as X, packet 1 as Y; "packet" fixes it, and a page built again keeps the order it had). What a and b
// were, the facts and the judges' votes stay behind a button; key.json beside the page says which was which,
// for reading the picks the page's button copies as text. The page works opened from disk.
//
// The person hears the sound and sees it move, which no judge does: where the two differ, theirs counts for
// more (evals/README.md, "The gate for a change of taste").
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const file = process.argv[2];
if (!file) { console.error('usage: bun evals/harness/pick.ts <config.json>'); process.exit(2); }
type Pair = { dir: string; title: string; note?: string; a: string; b: string; facts?: { a: string; b: string }; packet?: 0 | 1 };
const cfg = JSON.parse(readFileSync(file, 'utf8')) as { out: string; pairs: Pair[] };
const OUT = path.resolve(cfg.out);
mkdirSync(OUT, { recursive: true });
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const swapXY = (s: string) => s.replace(/\b([XY])\b/g, (_, c) => (c === 'X' ? 'Y' : 'X'));
const slash = (p: string) => p.replaceAll('\\', '/');

// (the order a page already had, so building it again after a judge returns doesn't reshuffle what was watched)
const before = new Map<string, number>();
if (existsSync(path.join(OUT, 'key.json'))) for (const k of JSON.parse(readFileSync(path.join(OUT, 'key.json'), 'utf8'))) before.set(k.dir, k.packet);

type Side = 'a' | 'b';
const key: unknown[] = [];
const sections: string[] = [];
for (const [i, p] of cfg.pairs.entries()) {
  const dir = path.resolve(p.dir), name = slash(path.relative(process.cwd(), dir));
  const packet = p.packet ?? before.get(name) ?? (crypto.getRandomValues(new Uint8Array(1))[0]! & 1);
  const X: Side = packet === 0 ? 'a' : 'b', Y: Side = packet === 0 ? 'b' : 'a';
  const video = (side: string) => path.join(dir, `p${packet}`, side, 'video.mp4');
  if (!existsSync(video('X'))) throw new Error(`${p.dir}: no packet p${packet} (judge.ts builds p1 when it has more than one judge)`);
  const verdict = existsSync(path.join(dir, 'verdict.json')) ? JSON.parse(readFileSync(path.join(dir, 'verdict.json'), 'utf8')) : null;
  const letter = (side: Side | 'tie' | null) => (side === 'tie' ? 'a tie' : side === null ? 'no verdict' : side === X ? 'X' : 'Y');
  const votes = (verdict?.votes ?? []).map((v: any) => {
    // (a judge's own X may be this page's Y: its words are turned to the page's letters)
    const fix = (s: unknown) => (v.seen?.X === X ? String(s ?? '') : swapXY(String(s ?? '')));
    return { pick: letter(v.better), margin: v.margin ?? '', why: fix(v.why ?? v.error), X: { best: fix(v[X]?.best), worst: fix(v[X]?.worst) }, Y: { best: fix(v[Y]?.best), worst: fix(v[Y]?.worst) } };
  });
  const tally = verdict ? { X: verdict.tally[X], Y: verdict.tally[Y], tie: verdict.tally.tie, none: verdict.tally.none } : null;
  const reveal = { X: p[X], Y: p[Y], facts: p.facts ? { X: p.facts[X], Y: p.facts[Y] } : null, judge: verdict?.judge?.model ?? null, tally, votes };
  key.push({ pair: i + 1, title: p.title, dir: name, packet, X: { run: X, what: p[X], folder: verdict?.[X]?.run }, Y: { run: Y, what: p[Y], folder: verdict?.[Y]?.run } });
  sections.push(`
<section class="pair" data-pair="${i + 1}" data-title="${esc(p.title)}">
  <h2><span class="n">Pair ${i + 1}</span> ${esc(p.title)}</h2>
  ${p.note ? `<p class="note">${esc(p.note)}</p>` : ''}
  <p class="request"><span class="dim">The prompt both were given:</span><br>${esc(verdict?.request?.[0] ?? '(not recorded)')}</p>
  <div class="videos">
    <figure><figcaption>X</figcaption><video controls preload="metadata" src="${esc(slash(path.relative(OUT, video('X'))))}"></video></figure>
    <figure><figcaption>Y</figcaption><video controls preload="metadata" src="${esc(slash(path.relative(OUT, video('Y'))))}"></video></figure>
  </div>
  <div class="row">
    <button type="button" data-both="X">Play both, sound from X</button>
    <button type="button" data-both="Y">Play both, sound from Y</button>
    <button type="button" data-stop>Stop</button>
  </div>
  <fieldset>
    <legend>Which is the better video for that prompt?</legend>
    <label><input type="radio" name="pick-${i + 1}" value="X"> X is better</label>
    <label><input type="radio" name="pick-${i + 1}" value="Y"> Y is better</label>
    <label><input type="radio" name="pick-${i + 1}" value="about the same"> About the same</label>
    <select aria-label="By how much"><option value="">by how much?</option><option>slightly</option><option>clearly</option><option>by a lot</option></select>
    <textarea rows="2" placeholder="Anything you want to say about either (optional)"></textarea>
  </fieldset>
  <details class="reveal"><summary>Reveal which is which, and what the judges said</summary><div class="revealed" data-key="${Buffer.from(JSON.stringify(reveal)).toString('base64')}"></div></details>
</section>`);
}
writeFileSync(path.join(OUT, 'key.json'), JSON.stringify(key, null, 1));

// (picks are kept in the browser under the pairs' folders, so another set of pairs starts empty)
const PAGE = Bun.hash(cfg.pairs.map((p) => p.dir).join('|')).toString(36);
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Blind pairs</title>
<style>
  :root { --bg: #14161a; --panel: #1c1f25; --line: #2c313a; --fg: #e8e6e1; --dim: #9aa0aa; --accent: #7fb4ff; --good: #9bd4a4; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 "Segoe UI", system-ui, sans-serif; }
  main { max-width: 1500px; margin: 0 auto; padding: 28px 16px 80px; }
  h1 { font-size: 26px; margin: 0 0 6px; font-weight: 600; }
  .lede { color: var(--dim); max-width: 75ch; margin: 0 0 24px; }
  .request { border-left: 3px solid var(--accent); padding: 4px 12px; margin: 12px 0 4px; max-width: 75ch; font-size: 18px; }
  .request .dim { font-size: 14px; }
  .pair { background: var(--panel); border: 1px solid var(--line); border-radius: 10px; padding: 18px; margin: 0 0 26px; }
  h2 { font-size: 19px; margin: 0 0 4px; font-weight: 600; }
  h2 .n { color: var(--accent); margin-right: 8px; }
  .note { color: var(--dim); margin: 0 0 10px; max-width: 80ch; }
  .videos { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 420px), 1fr)); gap: 14px; margin-top: 12px; }
  figure { margin: 0; }
  figcaption { font-weight: 700; font-size: 20px; margin-bottom: 4px; }
  video { width: 100%; aspect-ratio: 16 / 9; background: #000; border-radius: 6px; display: block; }
  .row { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
  button { font: inherit; color: var(--fg); background: #2a2f38; border: 1px solid var(--line); border-radius: 6px; padding: 6px 12px; cursor: pointer; }
  button:hover { border-color: var(--accent); }
  fieldset { border: 1px solid var(--line); border-radius: 8px; padding: 10px 14px 14px; margin: 0; display: flex; flex-wrap: wrap; gap: 8px 18px; align-items: center; }
  legend { padding: 0 6px; font-weight: 600; }
  select, textarea { font: inherit; color: var(--fg); background: #101216; border: 1px solid var(--line); border-radius: 6px; padding: 5px 8px; }
  textarea { flex: 1 1 100%; resize: vertical; }
  details.reveal { margin-top: 14px; border-top: 1px dashed var(--line); padding-top: 10px; }
  summary { cursor: pointer; color: var(--accent); }
  .revealed { margin-top: 10px; }
  .revealed table { border-collapse: collapse; width: 100%; margin: 8px 0 12px; }
  .revealed th, .revealed td { text-align: left; vertical-align: top; padding: 6px 10px 6px 0; border-bottom: 1px solid var(--line); }
  .revealed th { color: var(--dim); font-weight: 500; white-space: nowrap; width: 1%; padding-right: 18px; }
  .which b { color: var(--good); }
  .dim { color: var(--dim); }
  .send { position: sticky; bottom: 0; background: linear-gradient(transparent, var(--bg) 35%); padding: 26px 0 14px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  .send button { background: var(--accent); color: #0c1220; border: 0; font-weight: 600; padding: 9px 16px; }
  #copied { color: var(--good); }
  pre { white-space: pre-wrap; background: #101216; border: 1px solid var(--line); border-radius: 6px; padding: 10px; }
</style></head>
<body><main>
<h1>Which would you rather have been handed?</h1>
<p class="lede">Each pair is two videos made for the same prompt. They are shown as X and Y, in an order drawn for each pair. Watch both with sound, make your pick, and open the reveal after. Your picks stay in this browser; the button at the bottom copies them as text.</p>
${sections.join('\n')}
<div class="send"><button type="button" id="copy">Copy my picks</button><span id="copied"></span></div>
<pre id="picks" hidden></pre>
</main>
<script>
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };
const PAGE = ${JSON.stringify(PAGE)};
for (const s of document.querySelectorAll('.pair')) {
  const n = s.dataset.pair, [vx, vy] = s.querySelectorAll('video');
  for (const b of s.querySelectorAll('[data-both]')) b.onclick = () => {
    vx.muted = b.dataset.both !== 'X'; vy.muted = b.dataset.both !== 'Y';
    vx.currentTime = 0; vy.currentTime = 0; vx.play(); vy.play();
  };
  s.querySelector('[data-stop]').onclick = () => { vx.pause(); vy.pause(); };
  const radios = s.querySelectorAll('input[type=radio]'), sel = s.querySelector('select'), note = s.querySelector('textarea');
  const saved = JSON.parse(store.get('pair-' + PAGE + '-' + n) || '{}');
  for (const r of radios) r.checked = r.value === saved.pick;
  sel.value = saved.margin || ''; note.value = saved.note || '';
  const save = () => store.set('pair-' + PAGE + '-' + n, JSON.stringify({ pick: [...radios].find((r) => r.checked)?.value || '', margin: sel.value, note: note.value }));
  for (const el of [...radios, sel, note]) el.addEventListener('input', save);
  const det = s.querySelector('details'), box = s.querySelector('.revealed');
  det.addEventListener('toggle', () => {
    if (!det.open || box.firstChild) return;
    const k = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(box.dataset.key), (c) => c.charCodeAt(0))));
    const el = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };
    const which = el('p', null, 'which');
    which.append(el('b', 'X'), ' was ' + k.X + '. ', el('b', 'Y'), ' was ' + k.Y + '.');
    box.append(which);
    if (k.facts) { const t = el('table'); for (const side of ['X', 'Y']) { const r = el('tr'); r.append(el('th', side), el('td', k.facts[side])); t.append(r); } box.append(t); }
    if (k.tally) {
      box.append(el('p', 'Judges (' + (k.judge || 'model not recorded') + ', frames only: they could not hear it or watch it move): X ' + k.tally.X + ', Y ' + k.tally.Y + ', tie ' + k.tally.tie + (k.tally.none ? ', no verdict ' + k.tally.none : '') + '.'));
      const t = el('table');
      k.votes.forEach((v, i) => {
        const r = el('tr'); const td = el('td');
        td.append(el('div', v.why), el('div', 'X at its best: ' + v.X.best + ' At its worst: ' + v.X.worst, 'dim'), el('div', 'Y at its best: ' + v.Y.best + ' At its worst: ' + v.Y.worst, 'dim'));
        r.append(el('th', 'Judge ' + (i + 1) + ': ' + v.pick + (v.margin ? ' (' + v.margin + ')' : '')), td); t.append(r);
      });
      box.append(t);
    } else box.append(el('p', 'No judges have looked at this pair yet.', 'dim'));
  });
}
document.getElementById('copy').onclick = async () => {
  const lines = [...document.querySelectorAll('.pair')].map((s) => {
    const pick = [...s.querySelectorAll('input[type=radio]')].find((r) => r.checked)?.value || '(no pick)';
    const margin = s.querySelector('select').value, note = s.querySelector('textarea').value.trim();
    return 'Pair ' + s.dataset.pair + ' (' + s.dataset.title + '): ' + pick + (margin ? ', ' + margin : '') + (note ? '. ' + note : '');
  });
  const text = lines.join('\\n');
  const pre = document.getElementById('picks'); pre.hidden = false; pre.textContent = text;
  try { await navigator.clipboard.writeText(text); document.getElementById('copied').textContent = 'Copied.'; }
  catch { document.getElementById('copied').textContent = 'Select the text below and copy it.'; }
};
</script>
</body></html>`;
writeFileSync(path.join(OUT, 'index.html'), html);
console.log(path.join(OUT, 'index.html'));
