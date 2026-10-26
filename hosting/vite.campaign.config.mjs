import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
if (!process.env.CAMPAIGN_BUILD_ID) throw new Error('Campaign build identity required');
export default {
  root: path.join(root, 'hosting'), base: './', publicDir: false,
  define: { __CAMPAIGN_BUILD_ID__: JSON.stringify(process.env.CAMPAIGN_BUILD_ID) },
  build: { manifest: false, assetsInlineLimit: 0,
    rollupOptions: { input: { index: path.join(root, 'hosting/index.html'), campaign: path.join(root, 'hosting/campaign.html') },
      output: { entryFileNames: '[name].js', chunkFileNames: 'assets/[name]-[hash].js' } },
  },
};
