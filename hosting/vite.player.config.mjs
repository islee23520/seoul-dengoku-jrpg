import path from 'node:path';
import { fileURLToPath } from 'node:url';
import playerConfig from '../engine/vite.player.config.ts';
import { appVersionDefine, readAppVersion } from '../engine/scripts/lib/appVersion.mjs';

const engine = fileURLToPath(new URL('../engine', import.meta.url));

export default {
 ...playerConfig,
 plugins: [
  ...playerConfig.plugins.filter(plugin => plugin.name !== 'oprn-app-version'),
  {name:'hosting-pinned-version',config() {
   const meta=readAppVersion(engine);
   return {define:appVersionDefine({...meta,builtAt:process.env.HOSTING_BUILD_TIMESTAMP})};
  }},
 ],
 build: {
  ...playerConfig.build,
  rollupOptions: {
   ...playerConfig.build.rollupOptions,
   output: {
    ...playerConfig.build.rollupOptions.output,
    // These are pure data modules. Keep synchronous imports and their complete
    // values, but do not merge all bundled tilesets into one shared JS chunk.
    codeSplitting: {groups:[{
     test: id => id.startsWith(path.join(engine,'src/assets/')) && id.endsWith('Tileset.json'),
     name: id => 'tileset-'+path.basename(id,'.json'),
    }]},
   },
  },
 },
};
