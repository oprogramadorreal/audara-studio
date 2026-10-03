// Headless `codex exec` runs record each folder they ran in as a trusted project in the user's
// ~/.codex/config.toml. The eval harness runs in hundreds of throwaway folders under
// evals/results/, so this removes exactly those [projects.'…'] blocks again (and nothing else).
//   bun evals/harness/codex-trust-cleanup.ts [--dry-run]
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Remove the eval folders' trust entries: anything under audara-studio's evals/results/ (or only under
 * `under`, when other runs may still be going), plus `also` (exact folders).
 */
export function cleanCodexTrust(dryRun = false, also: string[] = [], under?: string) {
  const file = path.join(process.env.CODEX_HOME ?? path.join(os.homedir(), '.codex'), 'config.toml');
  const text = readFileSync(file, 'utf8');
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const marker = `${path.sep}evals${path.sep}results${path.sep}`.toLowerCase();
  const exact = new Set(also.map((p) => `[projects.'${path.resolve(p).toLowerCase()}']`));
  const out: string[] = [];
  let skip = false, dropped = 0;
  for (const line of text.split(/\r?\n/)) {
    // a table header starts a block; drop the block when it is one of the eval folders
    if (line.startsWith('[')) {
      const l = line.toLowerCase();
      const inScope = under ? l.startsWith(`[projects.'${path.resolve(under).toLowerCase()}`) : l.includes(marker) && l.includes('audara-studio');
      skip = l.startsWith("[projects.'") && (inScope || exact.has(l));
      if (skip) dropped++;
    }
    if (!skip) out.push(line);
  }
  if (dropped && !dryRun) {
    copyFileSync(file, `${file}.bak-audara-evals`);
    writeFileSync(file, out.join(eol));
  }
  return { file, dropped };
}

if (import.meta.main) {
  const r = cleanCodexTrust(process.argv.includes('--dry-run'));
  console.log(`${r.dropped} eval project entr${r.dropped === 1 ? 'y' : 'ies'} ${process.argv.includes('--dry-run') ? 'would be' : ''} removed from ${r.file}`);
}
