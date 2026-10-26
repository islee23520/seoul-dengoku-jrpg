import { fileURLToPath } from 'node:url';
import { createServer } from '../../engine/node_modules/vite/dist/node/index.js';

const root = fileURLToPath(new URL('./', import.meta.url));
const moduleId = 'virtual:campaign-negative-states';
const resolvedId = '\0' + moduleId;

/** Node-only test fixtures include fs/assert. Generate their checked readonly snapshots on
 * Vite's SSR side rather than browser-shimming Node or adding a production debug endpoint. */
export default {
  root,
  publicDir: false,
  build: {
    outDir: 'dist-campaign-negative-fixture',
    rollupOptions: { input: fileURLToPath(new URL('./campaign-negative-fixture.html', import.meta.url)) },
  },
  plugins: [{
    name: 'private-campaign-negative-states',
    async load(id) {
      if (id !== resolvedId) return null;
      const server = await createServer({
        configFile: false,
        root: fileURLToPath(new URL('../../', import.meta.url)),
        publicDir: false,
        server: { middlewareMode: true, watch: null },
      });
      try {
        const { negativeFixture } = await server.ssrLoadModule('/scripts/qa/campaign-negative-states.ts');
        return 'export default ' + JSON.stringify(negativeFixture) + ';';
      } finally { await server.close(); }
    },
    resolveId(id) { return id === moduleId ? resolvedId : null; },
  }],
};
