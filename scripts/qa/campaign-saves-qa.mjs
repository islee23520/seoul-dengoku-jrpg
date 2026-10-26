import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Native Aside regression probe (task22 wave2). The URL must host a 1280x720 iframe of the production entry. */
async function inspectCampaign(url) {
  const page = await openTab(url);
  const out = {};
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  /** All frame DOM steps run as real functions inside the harness page. */
  const inFrame = (fn) => page.evaluate(fn);
  const shot = async (label) => {
    console.log('CAPTURE ' + label + ' ' + Buffer.from(await page.locator('iframe').screenshot({ type: 'png', margin: 0 })).toString('base64'));
  };
  try {
    const frame = page.frameLocator('iframe');
    await frame.getByRole('button', { name: '아무 키나 누르세요' }).click({ timeout: 10000 });
    await frame.getByRole('button', { name: '새 게임', exact: true }).click({ timeout: 10000 });
    await frame.locator('#select-confirm').click({ timeout: 10000 });
    await wait(300);
    await frame.locator('[data-start]').click({ timeout: 10000 });
    await wait(600);
    await shot('map-1280');
    out.screen = await inFrame(() => document.querySelector('iframe').contentDocument.querySelector('#realtime').dataset.screen);
    // orders surface
    await inFrame(() => { document.querySelector('iframe').contentDocument.querySelector('#cm-orders').click(); });
    await wait(300);
    await shot('orders-1280');
    out.ordersScreen = await inFrame(() => document.querySelector('iframe').contentDocument.querySelector('#realtime').dataset.screen);
    // back to map, open settlement through the sites tab
    await inFrame(() => {
      const d = document.querySelector('iframe').contentDocument;
      const back = d.querySelector('#co-back') || d.querySelector('[data-back]') || d.querySelector('#cs-back');
      if (!back) throw new Error('orders-back-missing');
      back.click();
    });
    await wait(300);
    await inFrame(() => { document.querySelector('iframe').contentDocument.querySelector('#cm-tab-sites').click(); });
    await wait(200);
    // select rows until the site context panel offers the settlement entry (holding rows show facts first)
    await inFrame(() => {
      const d = document.querySelector('iframe').contentDocument;
      d.querySelector('#cm-tab-sites').click();
      // keyboard-select the actor's home region (Enter on the region target), then the site row
      const target = [...d.querySelectorAll('[data-region]')].find((p) => p.dataset.region === 'region:1147063000') || d.querySelector('[data-region]');
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      const siteRow = [...d.querySelectorAll('[data-pick]')].find((r) => r.dataset.pick.startsWith('osm:'));
      if (!siteRow) throw new Error('site-row-missing');
      siteRow.click();
      const entry = d.querySelector('#cm-open-settlement');
      if (!entry) throw new Error('settlement-entry-missing');
      entry.click();
    });
    await wait(300);
    await shot('settlement-1280');
    out.settlementScreen = await inFrame(() => document.querySelector('iframe').contentDocument.querySelector('#realtime').dataset.screen);
    // reports inbox
    await inFrame(() => { document.querySelector('iframe').contentDocument.querySelector('#cs-reports').click(); });
    await wait(300);
    await shot('reports-1280');
    out.reportsScreen = await inFrame(() => document.querySelector('iframe').contentDocument.querySelector('#realtime').dataset.screen);
    // back to the map, then open the save/load surface through the session bar opener
    await inFrame(() => { document.querySelector('iframe').contentDocument.querySelector('#cr-back').click(); });
    await wait(200);
    await inFrame(() => {
      const d = document.querySelector('iframe').contentDocument;
      const opener = [...d.querySelectorAll('button')].find((b) => (b.textContent || '').includes('저장 · 불러오기'));
      if (!opener) throw new Error('saves-opener-missing');
      opener.click();
    });
    await wait(300);
    await shot('saves-empty-1280');
    out.saves = await inFrame(() => {
      const d = document.querySelector('iframe').contentDocument;
      const action = d.querySelector('#sv-action');
      return {
        screen: d.querySelector('#realtime').dataset.screen,
        actionText: action ? action.textContent : null,
        actionDisabled: action ? action.disabled : null,
        rows: d.querySelectorAll('[data-checkpoint]').length,
        emptyShown: (d.querySelector('#sv-detail')?.textContent || '').includes('저장된 체크포인트가 없다'),
      };
    });
    // confirm dialog is cancel-first
    await inFrame(() => { document.querySelector('iframe').contentDocument.querySelector('#sv-action').click(); });
    await wait(200);
    await shot('saves-confirm-1280');
    out.confirm = await inFrame(() => {
      const d = document.querySelector('iframe').contentDocument;
      const dlg = d.querySelector('dialog[open]');
      if (!dlg) return { open: false };
      const focused = d.activeElement;
      return { open: true, focusIsCancel: focused && focused.textContent === '취소', body: dlg.querySelector('.sv-confirm__body').textContent };
    });
    // proceed with the save, then verify the honest rows
    await inFrame(() => { document.querySelector('iframe').contentDocument.querySelector('dialog[open] .ui-button--primary').click(); });
    await wait(300);
    await shot('saves-saved-1280');
    out.afterSave = await inFrame(() => {
      const d = document.querySelector('iframe').contentDocument;
      return {
        rows: [...d.querySelectorAll('[data-checkpoint]')].map((r) => r.textContent.trim()),
        activePointer: !!d.defaultView.parent.localStorage.getItem('seoul-composed-campaign-v2:active'),
      };
    });
    // escape unwinds to the map without a fake load
    await page.keyboard.press('Escape');
    await wait(200);
    out.afterEscape = await inFrame(() => document.querySelector('iframe').contentDocument.querySelector('#realtime').dataset.screen);
    // reload: the checkpoint must survive a fresh load of the same origin
    try { await page.reload({ timeout: 15000 }); } catch { await page.goto(url); }
    await wait(800);
    out.afterReloadActive = await inFrame(() => !!document.querySelector('iframe').contentWindow.localStorage.getItem('seoul-composed-campaign-v2:active'));
    console.log('RESULT ' + JSON.stringify(out));
  } finally { await closeTab(page); }
}

const args = process.argv.slice(2);
if (args.length !== 2) { console.error('Required: <frame-url> <evidence-directory>'); process.exitCode = 2; }
else {
  const url = new URL(args[0]);
  const evidence = path.resolve(args[1]);
  await mkdir(path.join(evidence, 'captures'), { recursive: true });
  const code = 'await (' + inspectCampaign.toString() + ')(' + JSON.stringify(url.href) + ')';
  const child = spawn('aside-agent', ['repl', '--host', 'local', code], { stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks = [];
  child.stdout.on('data', (b) => chunks.push(b)); child.stderr.on('data', (b) => chunks.push(b));
  const timer = setTimeout(() => child.kill('SIGTERM'), 120000);
  const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  clearTimeout(timer);
  const output = Buffer.concat(chunks).toString();
  for (const match of output.matchAll(/^CAPTURE (\S+) ([A-Za-z0-9+/=]+)$/gm)) {
    await writeFile(path.join(evidence, 'captures', match[1] + '.png'), Buffer.from(match[2], 'base64'));
  }
  const match = output.match(/^RESULT (.+)$/m);
  if (exit !== 0 || !match) { console.error(output.replace(/^CAPTURE .+$/gm, '')); process.exitCode = 1; }
  else console.log(match[1]);
}
