import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';

/** A fresh loopback origin isolates storage without touching the user's saves or profile.
 * Production bytes are forwarded unchanged. Only the separate negative origin mutates a pack.
 * Responsive captures use real iframe layout viewports, never transforms or CSS zoom. */
export async function campaignOrigin(upstream, options = {}) {
  const requests = [];
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (pathname === '/__campaign_qa_frame') {
      const width = new URL(request.url, 'http://localhost').searchParams.get('width');
      if (!['390', '1440'].includes(width)) { response.writeHead(400).end(); return; }
      const height = width === '390' ? 844 : 900;
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      response.end('<!doctype html><html><head><meta charset="utf-8"><title>Native campaign viewport capture</title></head>'
        + '<body style="margin:0"><iframe title="Production campaign" src="/" style="border:0;width:' + width + 'px;height:' + height + 'px"></iframe></body></html>');
      return;
    }
    try {
      const target = new URL(pathname.slice(1) + new URL(request.url, 'http://localhost').search, upstream);
      const fetched = await fetch(target, { signal: AbortSignal.timeout(15000), redirect: 'error' });
      let bytes = Buffer.from(await fetched.arrayBuffer());
      const sourceHash = createHash('sha256').update(bytes).digest('hex');
      if (options.tamper && pathname.endsWith('/operations.json')) {
        const pack = JSON.parse(bytes.toString());
        pack.clock.worldSecondsPerRealSecond += 1;
        bytes = Buffer.from(JSON.stringify(pack));
      }
      const servedHash = createHash('sha256').update(bytes).digest('hex');
      requests.push({ path: pathname, status: fetched.status, sourceHash, servedHash, bytes: bytes.length });
      response.writeHead(fetched.status, { 'content-type': fetched.headers.get('content-type') ?? 'application/octet-stream', 'cache-control': 'no-store' });
      response.end(bytes);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      requests.push({ path: pathname, error: error.message });
      response.writeHead(502).end('campaign-qa-upstream-unavailable');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new TypeError('Expected loopback TCP address');
  return { url: `http://127.0.0.1:${address.port}/`, requests,
    close: async () => { const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed; } };
}
