import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { settlementStrings } from '../../game/ui/campaignSettlementModel.ts';

/** Native Aside regression probe. The URL must host a 1280x720 iframe of the production entry. */
async function inspectCampaign(url, unavailable) {
  const page = await openTab(url);
  try {
    console.log(await snapshot(page));
    const frame = page.frameLocator('iframe');
    await frame.getByRole('button', { name: '아무 키나 누르세요' }).click({ timeout: 10000 });
    console.log(await snapshot(page));
    await frame.getByRole('button', { name: '새 게임', exact: true }).click({ timeout: 10000 });
    console.log(await snapshot(page));
    await frame.locator('#select-confirm').click({ timeout: 10000 });
    console.log(await snapshot(page));
    await frame.locator('[data-start]').click({ timeout: 10000 });
    console.log(await snapshot(page));
    await frame.getByRole('button', { name: '정착지 집행 보기', exact: true }).click({ timeout: 10000 });
    console.log(await snapshot(page));
    // Given no issued work, when the wired settlement is rendered, then it must not
    // show the shipped unavailable explanation for an enabled command surface.
    const empty = await page.evaluate(() => {
      const doc = document.querySelector('iframe').contentDocument;
      return { text: doc.querySelector('#cs-work').textContent, disabled: doc.querySelector('#cs-command').disabled };
    });
    console.log('CAPTURE empty ' + Buffer.from(await page.locator('iframe').screenshot({ type: 'png', margin: 0 })).toString('base64'));
    await frame.locator('#cs-command').click({ timeout: 10000 });
    console.log(await snapshot(page));
    const geometry = await page.evaluate(() => {
      const doc = document.querySelector('iframe').contentDocument;
      const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom }; };
      return { width: doc.documentElement.clientWidth, height: doc.documentElement.clientHeight,
        screen: doc.querySelector('#realtime').dataset.screen,
        docks: [...doc.querySelectorAll('.co-dock')].map(dock => ({ dock: rect(dock),
          head: rect(dock.querySelector('.co-head')), body: rect(dock.querySelector('.co-body')),
          footer: dock.querySelector('.co-footer') ? rect(dock.querySelector('.co-footer')) : null })) };
    });
    console.log('CAPTURE orders ' + Buffer.from(await page.locator('iframe').screenshot({ type: 'png', margin: 0 })).toString('base64'));
    // Given the approved reference viewport, when command docks render, then each
    // body owns the same 484px anchor and stays between its heading/footer bands.
    const bodies = geometry.width === 1280 && geometry.height === 720 && geometry.docks.length === 3 &&
      geometry.docks.every(({ dock, head, body, footer }) => head.height === 48 && body.height === 484 &&
        body.y >= head.bottom && body.bottom <= (footer?.y ?? dock.bottom - 80) && (!footer || footer.bottom <= dock.bottom));
    console.log('RESULT ' + JSON.stringify({ bodies, empty: !empty.disabled && !empty.text.includes(unavailable) && geometry.screen === 'campaign-orders', geometry, emptyState: empty }));
  } finally { await closeTab(page); }
}

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === '--help') {
  console.log('Usage: node scripts/qa/campaign-layout.mjs <frame-url> <evidence-directory>');
} else if (args.length !== 2) {
  console.error('Required: <frame-url> <evidence-directory>'); process.exitCode = 2;
} else {
  const url = new URL(args[0]);
  const evidence = path.resolve(args[1]);
  await mkdir(path.join(evidence, 'captures'), { recursive: true });
  const code = 'await (' + inspectCampaign.toString() + ')(' + JSON.stringify(url.href) + ',' + JSON.stringify(settlementStrings.commandUnavailable) + ')';
  const child = spawn('aside-agent', ['repl', '--host', 'local', code], { stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks = [];
  child.stdout.on('data', bytes => chunks.push(bytes)); child.stderr.on('data', bytes => chunks.push(bytes));
  const timer = setTimeout(() => child.kill('SIGTERM'), 90000);
  const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  clearTimeout(timer);
  const output = Buffer.concat(chunks).toString();
  for (const match of output.matchAll(/^CAPTURE (\w+) ([A-Za-z0-9+/=]+)$/gm)) {
    await writeFile(path.join(evidence, 'captures', match[1] + '.png'), Buffer.from(match[2], 'base64'));
  }
  const match = output.match(/^RESULT (.+)$/m);
  if (exit !== 0 || !match) { console.error(output.replace(/^CAPTURE .+$/gm, '')); process.exitCode = 1; }
  else {
    const result = JSON.parse(match[1]);
    console.log('TAP version 13\n1..2');
    console.log((result.bodies ? 'ok' : 'not ok') + ' 1 - all command dock bodies measure 484px at1280x720');
    console.log((result.empty ? 'ok' : 'not ok') + ' 2 - empty settlement agrees with wired command availability');
    console.log('# ' + JSON.stringify(result));
    if (!result.bodies || !result.empty) process.exitCode = 1;
  }
}
