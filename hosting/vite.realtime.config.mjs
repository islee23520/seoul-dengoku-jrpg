import path from 'node:path';
import { realpathSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const engine = process.env.REALTIME_ENGINE_SOURCE;
if (!engine) throw new Error('Disposable patched engine source required');
const { default: config } = await import(pathToFileURL(path.join(engine, 'vite.player.config.ts')).href);
const engineAssets = path.join(realpathSync(engine), 'src/assets');
export default {
  ...config, root: path.join(root, 'hosting'),
  plugins: config.plugins.map(plugin => plugin.name === 'oprn-app-version'
    ? { ...plugin, config: () => plugin.config({ root: engine }) }
    : plugin),
  build: { ...config.build,
    assetsInlineLimit: (file, _content) => /\.otf$/i.test(file) ? false : undefined,
    rollupOptions: {
    ...config.build.rollupOptions,
    // The HTML entry alone drops bootRealtime and its patched engine imports.
    input: { host: path.join(root, 'hosting/realtime.html'), realtime: path.join(root, 'hosting/realtime-entry.ts'),
      ...(process.env.THREE_STATION_QA === '1' ? { 'three-station-qa': path.join(root, 'hosting/three-station-qa.ts') } : {}),
      ...(process.env.NATURAL_CHARSET_QA === '1' ? { 'natural-charset-qa': path.join(root, 'hosting/natural-charset-qa.ts') } : {}) },
    preserveEntrySignatures: 'strict',
    output: { ...config.build.rollupOptions.output, entryFileNames: '[name].js', chunkFileNames: 'assets/[name]-[hash].js',
      // Keep complete synchronous data exports, but serve each large data module
      // separately instead of folding the entire asset catalog into the entry.
      codeSplitting: { groups: [{
        test: id => id.startsWith(engineAssets + path.sep) && id.endsWith('.json'),
        name: id => 'data-' + path.relative(engineAssets, id).replace(/\.json$/, '').replaceAll(path.sep, '-'),
      }, {
        test: id => id === path.join(root, 'game/data/campaign/map-view.json'),
        name: 'campaign-map-view',
      }] },
    },
  } },
};
