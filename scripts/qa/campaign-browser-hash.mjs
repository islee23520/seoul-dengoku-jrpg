import { pathToFileURL } from 'node:url';

export const vectors = [
  { value: null, hash: '74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b' },
  { value: { a: 1, b: 2 }, hash: '43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777' },
  { value: { 영주: '이서담', 가신: ['백산석', '성달현'], nested: { z: null, a: [true, -0, '서울\n전국'] } }, hash: '50c8ba6b92a10a9eaab174b5e3a8178d476f2ecbfa5b6beb0fabccbcc8e54842' },
  { value: { nested: { a: [true, 0, '서울\n전국'], z: null }, 가신: ['백산석', '성달현'], 영주: '이서담' }, hash: '50c8ba6b92a10a9eaab174b5e3a8178d476f2ecbfa5b6beb0fabccbcc8e54842' },
  { value: { text: '😀\ud800', number: 1e21 }, hash: '02d087894909f9a00f09ae4bd34864033b2d82ad256c00fb4e8311a09430911b' },
];

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === '--help') {
    console.log('Usage: node scripts/qa/campaign-browser-hash.mjs [--port <0-65535>]');
  } else {
    const args = process.argv.slice(2);
    const port = args.length === 0 ? 0 : Number(args[1]);
    if (args.length !== 0 && (args.length !== 2 || args[0] !== '--port' || !/^\d+$/.test(args[1]) || !Number.isInteger(port) || port < 0 || port > 65535)) {
      console.error('Expected --port <0-65535>');
      process.exitCode = 2;
    } else {
      const { createServer } = await import('../../engine/node_modules/vite/dist/node/index.js');
      const server = await createServer({ root: new URL('../../', import.meta.url).pathname, configFile: false, optimizeDeps: { noDiscovery: true, include: [] }, cacheDir: `${process.env['TMPDIR']}/campaign-vite`, server: { host: '127.0.0.1', port, strictPort: true }, plugins: [{ name: 'campaign-browser-hash', configureServer(devServer) {
      devServer.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== '/') return next();
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Production ledger browser hash</title><style>body{font:16px monospace;padding:24px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>Production ledger browser hash</h1><pre id="result">Importing production ledger…</pre><script type="module">
try {
  const { summaryHash, canonicalJson } = await import('/game/src/domain/eventLedger.ts');
  const vectors = ${JSON.stringify(vectors)};
  const results = vectors.map(({value,hash}) => ({ canonical:canonicalJson(value), expected:hash, actual:summaryHash(value), pass:summaryHash(value)===hash }));
  const rejected = [NaN, Infinity, -Infinity].map(value => { try { summaryHash({nested:[value]}); return false; } catch(error) { return error.name === 'CheckpointCorrupt'; } });
  const changed = summaryHash({영주:'이서담'}) !== summaryHash({영주:'백산석'});
  window.hashProof = { status:results.every(v=>v.pass)&&rejected.every(Boolean)&&changed?'passed':'failed', results, rejected, changed };
} catch(error) { window.hashProof = {status:'import-failed',name:error.name,message:error.message}; }
document.querySelector('#result').textContent=JSON.stringify(window.hashProof,null,2);
window.dispatchEvent(new Event('ledger-hash-complete'));
</script></html>`);
      });
      } }] });
      await server.listen();
      console.log(`READY ${server.resolvedUrls.local[0]}`);
      const stop = async () => { await server.close(); console.log('STOPPED'); };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    }
  }
}
