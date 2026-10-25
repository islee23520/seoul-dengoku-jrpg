import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const engine = process.env.REALTIME_ENGINE_SOURCE;
if (!engine) throw new Error('Disposable patched engine source required');
const { default: config } = await import(pathToFileURL(path.join(engine, 'vite.player.config.ts')).href);
export default {
  ...config, root: path.join(root, 'hosting'),
  plugins: config.plugins.map(plugin => plugin.name === 'oprn-app-version'
    ? { ...plugin, config: () => plugin.config({ root: engine }) }
    : plugin),
  build: { ...config.build, rollupOptions: {
    ...config.build.rollupOptions,
    // The HTML entry alone drops bootRealtime and its patched engine imports.
    input: { host: path.join(root, 'hosting/realtime.html'), realtime: path.join(root, 'hosting/realtime-entry.ts'),
      ...(process.env.THREE_STATION_QA === '1' ? { 'three-station-qa': path.join(root, 'hosting/three-station-qa.ts') } : {}),
      ...(process.env.NATURAL_CHARSET_QA === '1' ? { 'natural-charset-qa': path.join(root, 'hosting/natural-charset-qa.ts') } : {}) },
    preserveEntrySignatures: 'strict',
    output: { ...config.build.rollupOptions.output, entryFileNames: '[name].js', chunkFileNames: 'assets/[name]-[hash].js' },
  } },
};
