// Small synthetic fixtures for the evals, generated with ffmpeg so the repo carries no media.
// They only need to be realistic enough for a model to treat them as the files the user mentions.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// (run from the repo, so drawtext finds the template's fonts by a relative path: a Windows drive's colon
// would need escaping inside a filter)
const REPO = path.resolve(import.meta.dir, '..', '..');
const ff = (args: string[]) => {
  const p = Bun.spawnSync(['ffmpeg', '-v', 'error', '-y', ...args], { cwd: REPO });
  if (p.exitCode !== 0) throw new Error(`ffmpeg failed: ${p.stderr.toString()}`);
};

// A 24 s "song" at 120 BPM: kick on 1 and 3, a hat on every eighth, a bass note per bar.
const SONG = "aevalsrc='0.5*sin(2*PI*(55+30*exp(-30*mod(t,1)))*t)*exp(-8*mod(t,1))+0.12*(random(0)-0.5)*exp(-60*mod(t,0.25))+0.25*sin(2*PI*110*t)*exp(-2*mod(t,2))':s=44100:d=24";
const TONE = (sec: number) => `aevalsrc='0.3*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*0.5*t))':s=44100:d=${sec}`;
const VOICE = (sec: number) => `aevalsrc='0.4*sin(2*PI*180*t)*sin(2*PI*3*t)*gt(sin(2*PI*0.4*t),-0.3)':s=24000:d=${sec}`;

const TEXT: Record<string, string> = {
  'lyrics.txt': 'Every frame is a function of time\nScrub it back and the light stays mine\nCut on the downbeat, land on the line\nEvery frame is a function of time\n',
  'script.txt': 'Every loaf of sourdough starts with a jar of flour and water.\n\nWild yeast and bacteria move in, and they start to feed.\n\nIn a few days the jar bubbles, and doubles every morning. That\'s a starter.\n\nFeed it, and it will raise your bread for years.\n',
  // A director's script with visual and timing notes beside the narration (43 spoken words): a naive run
  // would speak the notes, the heading or the comment.
  'explainer-script.md': '# Why indexes make SQL fast\n<!-- 16:9, about 35 s. Calm, precise. -->\n\n[VISUAL: a library card catalogue, drawers sliding open. Title on screen: "Why indexes make SQL fast".]\nEvery database query is a search. Without an index, SQL reads every row.\n\n[VISUAL: a table of a million rows scrolling; a counter climbs. Cut on "every row".]\nA million rows means a million checks.\n\n[VISUAL: the rows fold into a B-tree; highlight the path. Hold 2 s on the tree.]\nAn index is a sorted tree. Each step halves what is left, so twenty steps find any row.\n\n[VISUAL: the counter shows 20. End card: "Index the columns you search."]\nIndex the columns you search.\n',
  'ad-script.txt': 'Meet Lumen, the desk lamp that follows the sun.\n\nIt warms up at dawn, cools down at dusk, and never asks you to think about it.\n\nLumen. Light that keeps time.\n',
  'revenue.csv': 'year,revenue_musd\n2019,1.2\n2020,2.9\n2021,6.4\n2022,11.8\n2023,19.5\n2024,31.0\n2025,47.3\n',
  'post.md': '# Why we rewrote our scheduler\n\nOur old scheduler assumed every job was short. That stopped being true in March.\n\nThis post walks through what broke and what we built instead.\n',
  'vlog.srt': '1\n00:00:00,500 --> 00:00:02,500\nMorning in Lisbon.\n\n2\n00:00:03,000 --> 00:00:05,000\nFirst stop: coffee.\n',
  'words.json': JSON.stringify({ lines: [{ text: 'Every loaf starts here.', start: 0.4, end: 2.1, words: [
    { w: 'Every', start: 0.4, end: 0.7 }, { w: 'loaf', start: 0.7, end: 1.0 }, { w: 'starts', start: 1.05, end: 1.5 }, { w: 'here.', start: 1.55, end: 2.1 }] }] }, null, 1),
  'logo.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><circle cx="100" cy="100" r="70" fill="none" stroke="#222" stroke-width="12"/><path d="M60 130 L100 60 L140 130 Z" fill="#222"/></svg>\n',
};

// Two phone screens of a made-up budgeting app, Tally, as a director would hand them over: its home screen and
// its receipt scanner. The story the case asks for also needs a third (the budget after the scan) that no file has.
const ARCHIVO = (w: number) => `skills/code-video/assets/template-webgl/public/fonts/Archivo-w1000-${w}.ttf`;
const txt = (text: string, x: string | number, y: number, size: number, color: string, weight = 500) =>
  `drawtext=fontfile=${ARCHIVO(weight)}:text='${text}':x=${x}:y=${y}:fontsize=${size}:fontcolor=${color}`;
const box = (x: number, y: number, w: number, h: number, color: string) => `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${color}:t=fill`;
const INK = '0x1B1F24', GREY = '0x6B7280', GREEN = '0x2E9E6B', MID = '(w-text_w)/2';
const TALLY_HOME = [
  'color=c=0xF6F7F9:s=1080x2340', txt('Tally', 72, 120, 72, INK, 700), txt('Hi, Sam', 72, 220, 40, GREY),
  box(48, 300, 984, 420, 'white'), txt('October budget', 96, 350, 40, GREY), txt('$1,240 of $2,000', 96, 420, 84, INK, 700),
  box(96, 560, 888, 28, '0xE5E7EB'), box(96, 560, 551, 28, GREEN), txt('$760 left for 12 days', 96, 620, 36, GREY),
  txt('Recent', 72, 800, 44, INK, 700),
  ...([['Groceries', '$86.40'], ['Coffee', '$4.50'], ['Metro card', '$33.00']] as const).flatMap(([what, cost], i) => {
    const y = 880 + i * 160;
    return [box(48, y, 984, 136, 'white'), txt(what, 96, y + 44, 40, INK), txt(cost, 820, y + 44, 40, INK)];
  }),
  box(72, 2060, 936, 160, GREEN), txt('Scan a receipt', MID, 2112, 52, 'white', 700),
].join(',');
const TALLY_SCAN = [
  'color=c=0x0E1114:s=1080x2340', txt('Scan a receipt', MID, 140, 52, 'white', 700),
  box(250, 420, 580, 1180, '0xEDEBE6'), txt('CORNER MARKET', MID, 470, 36, '0x3A3A3A', 700),
  ...[420, 300, 460, 360, 480, 260, 440, 380].map((w, i) => box(300, 560 + i * 90, w, 18, '0xB8B4AC')),
  txt('TOTAL  $42.80', 300, 1460, 40, '0x3A3A3A', 700),
  // the scanner's corner brackets
  ...[[210, 380], [780, 380], [210, 1550], [780, 1550]].flatMap(([x, y], i) => [
    box(x!, i < 2 ? y! : y! + 80, 90, 10, GREEN), box(i % 2 ? x! + 80 : x!, y!, 10, 90, GREEN)]),
  txt('Hold steady', MID, 1760, 40, '0x9CA3AF'), box(460, 2020, 160, 160, 'white'),
].join(',');

const MEDIA: Record<string, string[]> = {
  'tally-home.png': ['-f', 'lavfi', '-i', TALLY_HOME, '-frames:v', '1'],
  'tally-scan.png': ['-f', 'lavfi', '-i', TALLY_SCAN, '-frames:v', '1'],
  'song.mp3': ['-f', 'lavfi', '-i', SONG, '-c:a', 'libmp3lame', '-b:a', '192k'],
  'song.wav': ['-f', 'lavfi', '-i', SONG],
  'track.wav': ['-f', 'lavfi', '-i', SONG],
  'intro.mp3': ['-f', 'lavfi', '-i', TONE(12), '-c:a', 'libmp3lame', '-b:a', '160k'],
  'music.mp3': ['-f', 'lavfi', '-i', TONE(40), '-c:a', 'libmp3lame', '-b:a', '160k'],
  'episode.mp3': ['-f', 'lavfi', '-i', VOICE(30), '-c:a', 'libmp3lame', '-b:a', '96k'],
  'narration.wav': ['-f', 'lavfi', '-i', VOICE(14)],
  'call.wav': ['-f', 'lavfi', '-i', VOICE(10)],
  'interview.mp4': ['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=20', '-f', 'lavfi', '-i', VOICE(20), '-shortest', '-pix_fmt', 'yuv420p'],
  'vlog.mp4': ['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=8', '-f', 'lavfi', '-i', TONE(8), '-shortest', '-pix_fmt', 'yuv420p'],
  'wedding.mp4': ['-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=30', '-f', 'lavfi', '-i', TONE(30), '-shortest', '-pix_fmt', 'yuv420p'],
  'clip.mov': ['-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30:d=6', '-pix_fmt', 'yuv420p'],
  'brand.png': ['-f', 'lavfi', '-i', 'color=c=0x1d3557:s=600x200,drawbox=x=400:y=0:w=200:h=200:color=0xe63946:t=fill,drawbox=x=200:y=0:w=200:h=200:color=0xf1faee:t=fill', '-frames:v', '1'],
};

/** Make sure every fixture exists in `dir` (generated once, then reused). */
export function ensureFixtures(dir: string) {
  dir = path.resolve(dir); // (ffmpeg runs in the repo: a relative folder would land somewhere else for it)
  mkdirSync(dir, { recursive: true });
  for (const [f, body] of Object.entries(TEXT)) if (!existsSync(path.join(dir, f))) writeFileSync(path.join(dir, f), body);
  for (const [f, args] of Object.entries(MEDIA)) if (!existsSync(path.join(dir, f))) ff([...args, path.join(dir, f)]);
  return dir;
}

if (import.meta.main) console.log(ensureFixtures(process.argv[2] ?? path.join(import.meta.dir, '..', 'results', 'fixtures')));
