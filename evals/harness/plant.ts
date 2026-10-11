// What a real project accumulates before it goes into git, planted in a task case's copy of a finished project
// (setup "plant": "<name>"). Each comes from a project the user turned into a repository by hand (oprog-1,
// 2026-10-10: history.md, 0.6.0) or from what they ask of one: a home-folder path in a treatment, a key in a
// script, a render outside out/, an out/ folder below a video, a duplicate at the top, a file over GitHub's
// 100 MiB limit, a superseded generated image; for a project already in git, a key committed once and taken
// out later, and a change someone left staged. `before` runs on the copy, before the harness's setup commit (when
// the case has one); `after`, once it's made. The token is the case's own (setup.env.AUDIO_API_TOKEN), so the
// repo holds no key-shaped text. One more, for a case about a second video, plants nothing: it measures the first
// video before the session, for the grader.
import { appendFileSync, copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

type Setup = { env?: Record<string, string> };
const ff = (args: string[]) => {
  const p = Bun.spawnSync(['ffmpeg', '-v', 'error', '-y', ...args]);
  if (p.exitCode !== 0) throw new Error(`plant: ffmpeg failed: ${p.stderr.toString()}`);
};
const git = (work: string, ...args: string[]) => {
  const p = Bun.spawnSync(['git', '-c', 'user.name=eval', '-c', 'user.email=eval@local', ...args], { cwd: work });
  if (p.exitCode !== 0) throw new Error(`plant: git ${args.join(' ')} failed: ${p.stderr.toString()}`);
};
/** The project's first video other than the example (the example if it has no other). */
function video(work: string) {
  const all = existsSync(path.join(work, 'videos')) ? readdirSync(path.join(work, 'videos')).filter((v) => existsSync(path.join(work, 'videos', v, 'video.json'))) : [];
  const v = all.find((x) => x !== 'example') ?? all[0];
  if (!v) throw new Error('plant: the project has no videos/<video>/video.json');
  return v;
}
function token(setup: Setup) {
  const t = setup.env?.AUDIO_API_TOKEN;
  if (!t) throw new Error('plant: the case sets no setup.env.AUDIO_API_TOKEN');
  return t;
}
const put = (file: string, body: string) => { mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, body); };
/** A line in the video's SOURCES.md, which code-video keeps for every file from outside code. */
function source(work: string, v: string, line: string) {
  const f = path.join(work, 'videos', v, 'assets', 'SOURCES.md');
  if (!existsSync(f)) put(f, '# Sources\n\n');
  appendFileSync(f, `${line}\n`);
}
/** An ElevenLabs-shaped key (sk_ and 48 hex digits), made at plant time. */
const elevenShaped = () => 'sk_' + Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('');

export const plants: Record<string, { before?: (work: string, setup: Setup) => void; after?: (work: string, setup: Setup) => void }> = {
  // A project about to get its first repository.
  'repo-traps': {
    before(work, setup) {
      const v = video(work), dir = path.join(work, 'videos', v), t = token(setup);
      // the user's home in a note an agent wrote (oprog-1's treatment named plugin-cache paths under C:\Users\<name>)
      const ref = path.join(os.homedir(), '.claude', 'plugins', 'cache', 'audara-studio', 'audara-studio', '0.5.0', 'skills', 'code-video', 'references', 'motion.md');
      appendFileSync(path.join(dir, 'TREATMENT.md'), `\n## Notes\n\n- Motion read from \`${ref}\` while timing the title.\n`);
      // keys: in .env (git-ignored by init), a script that hardcodes one, and a debug dump that copied the other
      put(path.join(work, '.env'), `AUDIO_API_TOKEN=${t}\n`);
      put(path.join(work, 'tools', 'make_sfx.py'), `# Makes the whoosh under the title (videos/${v}/audio/whoosh.wav) from a sound-effects API.\nimport json, urllib.request\n\nAPI_KEY = "${elevenShaped()}"\n\ndef make(prompt, out):\n    req = urllib.request.Request("https://api.elevenlabs.io/v1/sound-generation", data=json.dumps({"text": prompt}).encode(),\n                                 headers={"xi-api-key": API_KEY, "Content-Type": "application/json"})\n    open(out, "wb").write(urllib.request.urlopen(req).read())\n\nif __name__ == "__main__":\n    make("soft airy whoosh, 1.5 s", "videos/${v}/audio/whoosh.wav")\n`);
      put(path.join(work, 'tools', 'last-request.json'), JSON.stringify({ url: 'https://api.example.com/v1/sfx', headers: { Authorization: `Bearer ${t}` }, status: 200 }, null, 2) + '\n');
      // outputs where they don't belong: a render copied to the top, a mix report in an out/ below the video
      ff(['-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=2', '-pix_fmt', 'yuv420p', path.join(work, `${v}-final.mp4`)]);
      put(path.join(dir, 'intro', 'out', 'mix-report.json'), JSON.stringify({ integratedLufs: -14.2, truePeak: -1.3 }, null, 2) + '\n');
      // a source too big for GitHub (110 MiB): the director's own full take, kept for re-editing
      mkdirSync(path.join(dir, 'assets'), { recursive: true });
      ff(['-f', 'lavfi', '-i', 'anoisesrc=color=pink:amplitude=0.05:sample_rate=48000:duration=600', '-ac', '2', '-c:a', 'pcm_s16le', path.join(dir, 'assets', 'master-take.wav')]);
      source(work, v, '- `assets/master-take.wav`: the full 10-minute studio take the title\'s sound was cut from; the director\'s own recording, kept for re-editing.');
      // a duplicate at the top, and a superseded generated image with its request record
      ff(['-f', 'lavfi', '-i', 'testsrc2=s=600x200', '-frames:v', '1', path.join(dir, 'assets', 'logo.png')]);
      copyFileSync(path.join(dir, 'assets', 'logo.png'), path.join(work, 'logo (1).png'));
      source(work, v, '- `assets/logo.png`: the podcast\'s logo, for an end card; the director\'s.');
      mkdirSync(path.join(dir, 'assets', 'older'), { recursive: true });
      ff(['-f', 'lavfi', '-i', 'gradients=s=1280x720:d=1', '-frames:v', '1', path.join(dir, 'assets', 'older', 'backdrop.png')]);
      put(path.join(dir, 'assets', 'older', 'backdrop.request.json'), JSON.stringify({ model: 'gpt-image-2', prompt: 'a night sky over a radio tower, painted', size: '1536x1024', cost: '$0.19', replacedBy: 'none: the title went back to a drawn sky' }, null, 2) + '\n');
    },
  },
  // A project already in git: a key went into an early commit and was taken out in the next, and a change sits
  // staged, made by someone else.
  'history-secret': {
    before(work, setup) {
      put(path.join(work, 'tools', 'upload.ts'), `// Uploads the render to the client's review site.\nconst TOKEN = '${token(setup)}';\nconst file = Bun.file(process.argv[2]);\nawait fetch('https://review.example.com/api/upload', { method: 'POST', headers: { Authorization: \`Bearer \${TOKEN}\` }, body: file });\n`);
    },
    after(work) {
      put(path.join(work, 'tools', 'upload.ts'), `// Uploads the render to the client's review site (the token comes from the environment).\nconst TOKEN = process.env.AUDIO_API_TOKEN;\nif (!TOKEN) throw new Error('set AUDIO_API_TOKEN');\nconst file = Bun.file(process.argv[2]);\nawait fetch('https://review.example.com/api/upload', { method: 'POST', headers: { Authorization: \`Bearer \${TOKEN}\` }, body: file });\n`);
      git(work, 'add', 'tools/upload.ts');
      git(work, 'commit', '-qm', 'upload.ts: read the token from the environment');
      const v = video(work);
      appendFileSync(path.join(work, 'videos', v, 'TREATMENT.md'), '\n- 2026-10-10, not decided yet: try the intro 0.5 s slower.\n');
      git(work, 'add', `videos/${v}/TREATMENT.md`);
    },
  },
  // Nothing planted: the first video's verify report, taken before the session for the grader to compare its
  // frames with at the end, in baseline/ beside work/, where the session doesn't look. Reports from another day
  // couldn't be compared (history.md, 0.6.1), so it is taken on the run's own machine and day, twice, the second
  // --since the first: baseline.json says whether the comparison repeats. baseline/project/ is the project as
  // it was, git-ignored inputs included (without its dependencies, renders and history): what the grader
  // verifies again when the end's comparison differs. The project keeps no out/, as a later session finds it.
  'first-video-baseline': {
    after(work) {
      const v = video(work), dir = path.join(path.dirname(work), 'baseline');
      mkdirSync(dir, { recursive: true });
      const verify = (n: number, since?: string) => {
        const p = Bun.spawnSync([process.execPath, 'scripts/render.ts', 'verify', '--video', v, '--out', path.join(dir, `verify-${n}.json`), ...(since ? ['--since', since] : [])], { cwd: work, stdout: 'pipe', stderr: 'pipe' });
        writeFileSync(path.join(dir, `verify-${n}.log`), `${p.stdout}${p.stderr}`);
        if (p.exitCode !== 0) throw new Error(`plant: verify ${n} of ${v} failed (${path.join(dir, `verify-${n}.log`)})`);
      };
      verify(1);
      verify(2, path.join(dir, 'verify-1.json'));
      const c = JSON.parse(readFileSync(path.join(dir, 'verify-2.json'), 'utf8')).changes;
      const repeatable = c?.compared > 0 && c.changed === 0 && !c.duration && !c.timeline?.length;
      writeFileSync(path.join(dir, 'baseline.json'), JSON.stringify({ video: v, repeatable, compared: c?.compared ?? 0, changed: c?.changed ?? null }, null, 2) + '\n');
      rmSync(path.join(work, 'out'), { recursive: true, force: true });
      const skip = new Set(['node_modules', 'out', '.git']);
      cpSync(work, path.join(dir, 'project'), { recursive: true, filter: (s) => !skip.has(path.basename(s)) });
    },
  },
};

if (import.meta.main) {
  // bun evals/harness/plant.ts <name> <folder> [token]: plant into a scratch copy by hand. A plant's `before`, or
  // for one with only an `after` (first-video-baseline), that: a plant with both needs the harness's setup commit
  // between them (history-secret's key must reach the history before `after` takes it out)
  const [name, work, t = 'eval-token-test'] = process.argv.slice(2);
  const p = plants[name!];
  if (!p) throw new Error(`plant: no plant named ${name} (${Object.keys(plants).join(', ')})`);
  const setup = { env: { AUDIO_API_TOKEN: t } };
  if (p.before) p.before(path.resolve(work!), setup);
  else p.after?.(path.resolve(work!), setup);
  console.log(`planted ${name} in ${path.resolve(work!)}`);
}
