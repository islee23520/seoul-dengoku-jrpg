import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { CampaignContent } from '../../game/src/campaign/content.ts';
import { CampaignApplication } from '../../game/src/campaign/application.ts';
import { createCampaignE0 } from '../../game/src/campaign/state.ts';
import { composeCampaignAuthority } from '../../game/src/campaign/authorityComposition.ts';
import { CampaignBoundaryError } from '../../game/src/campaign/errors.ts';

/** Ordinary application ingress for local operator use; no state/effect injection or accelerated clock. */
export async function runCampaignCommands(args: readonly string[]): Promise<void> {
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node scripts/tools/campaign-commands.ts --interactive\nCommands: issue S01-L|S01-O; cancel ORDER_ID; confirm; back; speed 0|1|2|4; status; quit.\nIssue and cancellation require explicit confirm. Back discards only the draft. Investigation effect handlers are supplied by tasks 9/10.');
    return;
  }
  if (args.length !== 1 || args[0] !== '--interactive') throw new CampaignBoundaryError('shape');
  const data = new URL('../../game/data/', import.meta.url);
  const content = CampaignContent.parse({
    manifest: await readFile(new URL('campaign/source-manifest.json', data), 'utf8'),
    atlas: await readFile(new URL('campaign/atlas.json', data), 'utf8'),
    identities: await readFile(new URL('campaign/identity-map.json', data), 'utf8'),
    scenario: await readFile(new URL('scenarios/townhall-s01-r1/scenario.json', data), 'utf8'),
    projection: await readFile(new URL('scenarios/townhall-s01-r1/projection.json', data), 'utf8'),
    operations: await readFile(new URL('scenarios/townhall-s01-r2/operations.json', data), 'utf8'),
  });
  const app = new CampaignApplication({ content, state: createCampaignE0(content), now: () => performance.now() });
  const reader = createInterface({ input: stdin, output: stdout, terminal: stdin.isTTY });
  let pending: unknown = null;
  let cursor = 0;
  const show = () => {
    const state = app.checkpoint();
    const events = state.commands.events.slice(cursor);
    cursor = state.commands.events.length;
    for (const event of events) console.log(JSON.stringify({ event }));
    console.log(JSON.stringify({ view: app.view('K002') }));
  };
  const wake = setInterval(() => {
    app.reconcile();
    const state = app.checkpoint();
    if (state.commands.events.length > cursor) show();
  }, content.data.operations.clock.hostIntegrationMaxRealMilliseconds);
  try {
    show();
    for await (const line of reader) {
      try {
        const [action, value, extra] = line.trim().split(/\s+/);
        if (extra !== undefined) throw new CampaignBoundaryError('shape');
        if (action === 'quit' && value === undefined) break;
        if (action === 'back' && value === undefined) { pending = null; console.log(JSON.stringify({ draft: 'discarded', mutated: false })); continue; }
        if (action === 'confirm' && value === undefined) {
          if (pending === null) throw new CampaignBoundaryError('shape');
          console.log(JSON.stringify({ receipt: app.submit(pending) })); pending = null; show(); continue;
        }
        if (action === 'status' && value === undefined) { show(); continue; }
        if (action === 'speed' && (value === '0' || value === '1' || value === '2' || value === '4')) {
          const speed = value === '0' ? 0 : value === '1' ? 1 : value === '2' ? 2 : 4;
          app.setSpeed(speed); show(); continue;
        }
        const state = app.checkpoint();
        if (action === 'issue' && (value === 'S01-L' || value === 'S01-O')) {
          const recipientId = value === 'S01-L' ? 'K568' : 'K616';
          const basis = composeCampaignAuthority(state, { operation: value, issuerPersonId: 'K002', recipientId, expectedRevision: state.revision }, content);
          pending = { kind: 'issue', commandId: crypto.randomUUID(), issuerPersonId: 'K002', recipientId, operation: value,
            expectedRevision: state.revision, expectedCompositeVersion: basis.compositeVersion };
        } else if (action === 'cancel' && value) pending = { kind: 'request-cancellation', commandId: crypto.randomUUID(), issuerPersonId: 'K002', orderId: value, expectedRevision: state.revision };
        else throw new CampaignBoundaryError('shape');
        console.log(JSON.stringify({ draft: pending, defaultAction: 'back', confirmationRequired: true }));
      } catch (error) {
        if (!(error instanceof CampaignBoundaryError)) throw error;
        console.error(JSON.stringify({ code: error.code }));
      }
    }
  } finally { clearInterval(wake); reader.close(); app.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await runCampaignCommands(process.argv.slice(2)); }
  catch (error) {
    if (!(error instanceof Error)) throw error;
    console.error(JSON.stringify({ code: error instanceof CampaignBoundaryError ? error.code : 'input-unreadable' }));
    process.exitCode = 1;
  }
}
