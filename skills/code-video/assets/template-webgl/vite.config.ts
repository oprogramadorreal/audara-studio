import { defineConfig, normalizePath, type Plugin } from 'vite';

/**
 * The preview's dev-server glue:
 * - Saving a scene file swaps only that scene. Each module under videos/<video>/scenes/ whose default
 *   export is a class (`export default class X extends Scene`) is made self-accepting, so its update
 *   stops there instead of climbing to src/main.ts and reloading the page; src/main.ts swaps the
 *   timeline entries that use it (on `vite:beforeUpdate`). Helper modules (named exports only) are not:
 *   their updates reach the scenes that import them. This needs the scene modules to have no importer
 *   but those: the timelines load them by URL, not through import.meta.glob (see videos/example/timeline.ts).
 * - A new or changed file under videos/<video>/data/, audio/ or assets/ (fetched at boot, not imported)
 *   reloads the page, so fresh timing data, a new soundtrack or a changed image or model shows up without a
 *   manual reload.
 * - GET /__audara answers with the folder this server serves: scripts/render.ts checks it before
 *   using a server given with --url, so a preview of another project is never rendered by mistake.
 */
const SCENE_FILE = /\/videos\/[^/]+\/scenes\/[^/]+\.ts$/;
const isScene = (code: string) => /\bexport\s+default\s+class\b[^{]*\bextends\b/.test(code);

function audara(): Plugin {
  let root = '';
  let reloadTimer: ReturnType<typeof setTimeout> | undefined;
  return {
    name: 'audara',
    configResolved(c) { root = normalizePath(c.root); },
    configureServer(server) {
      server.middlewares.use('/__audara', (_req, res) => {
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ root }));
      });
    },
    transform(code, id) {
      const file = normalizePath(id.split('?')[0]!);
      if (!file.startsWith(root + '/videos/') || !SCENE_FILE.test(file) || !isScene(code)) return;
      return {
        code: `${code}\nif (import.meta.hot) import.meta.hot.accept();\n`,
        map: null, // appended at the end: existing mappings stay valid
      };
    },
    async hotUpdate({ file, modules, read }) {
      if (this.environment.name !== 'client') return;
      const f = normalizePath(file);
      if (/\/videos\/[^/]+\/(data|audio|assets)\//.test(f)) {
        // (debounced: a file being written fires several changes)
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => this.environment.hot.send({ type: 'full-reload', path: '*' }), 400);
        return [];
      }
      // A scene whose last version never compiled (an import that didn't resolve, a module broken since the
      // page opened) isn't marked self-accepting, so Vite would answer its fix with a page reload: it is a
      // scene module, and src/main.ts swaps the fix in (or shows what is still wrong) without one.
      if (SCENE_FILE.test(f) && modules.some((m) => m.isSelfAccepting !== true) && isScene(await read()))
        for (const m of modules) m.isSelfAccepting = true;
    },
  };
}

export default defineConfig({
  root: '.',
  publicDir: 'public',
  // a missing file answers 404, not index.html: a model or image loader handed the page fails on its HTML
  // without naming the file (a misspelled asset, a frame not extracted yet)
  appType: 'mpa',
  plugins: [audara()],
  // Find the scenes' imports when the dependency cache is built, as well as the engine's: Vite looks from
  // index.html by default, and scenes load by URL (videos/example/timeline.ts), out of its sight. A module
  // only a scene imports (three/addons/...) was otherwise bundled while the page loaded, and render.ts's
  // page, which can't reload, ran with two copies of three.js (instanceof failed; a glTF model drew black).
  // The list replaces the default, so index.html is in it. An import added once the cache exists is still
  // found late: the preview reloads itself, render.ts reloads its page.
  optimizeDeps: { entries: ['index.html', 'videos/*/timeline.ts', 'videos/*/scenes/**/*.ts'] },
  server: {
    // IPv4 loopback, named: with the default ('localhost') Vite may bind only ::1 and miss another app on
    // 127.0.0.1:5173, and the same address then reaches two servers; bound here, a taken port is noticed
    // and the next one used (the URL Vite prints is the one to open)
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
    // AUDARA_NO_HMR=1: no live reload (an export render must not reload mid-run when a file changes)
    hmr: process.env.AUDARA_NO_HMR ? false : undefined,
    // renders write into out/: never watch them
    watch: { ignored: ['**/out/**'] },
  },
  build: { target: 'esnext', assetsInlineLimit: 0 },
});
