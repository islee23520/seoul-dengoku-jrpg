import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Native Aside regression probe (task22 wave3): the narrative dialogue surface (task26 §7)
 * driven through the exact production ingress (campaign:open-dialogue on #realtime) with the
 * repository's self-labelled TESTINPUT pilot and a host-owned context. The URL must host a
 * 1280x720 iframe of the production entry; a second 390x844 URL is optional for mobile. */
async function inspectCampaign(url, mobileUrl, doc) {
  const page = await openTab(url);
  const out = {};
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const inFrame = (fn, arg) => page.evaluate(fn, arg);
  const shot = async (label) => {
    // The daemon photographs the active tab; re-assert ours so a concurrently used browser
    // can never leak a foreign screen into task evidence.
    await page.bringToFront();
    console.log('CAPTURE ' + label + ' ' + Buffer.from(await page.locator('iframe').screenshot({ type: 'png', margin: 0 })).toString('base64'));
  };
  const open = (mode) => inFrame((payload) => {
    const d = document.querySelector('iframe').contentDocument;
    const state = d.defaultView.__qaDialogue ?? { traits: true, switches: { 'TESTINPUT-note-ready': true }, applied: [] };
    d.defaultView.__qaDialogue = state;
    d.querySelector('#realtime').dispatchEvent(new CustomEvent('campaign:open-dialogue', { bubbles: true, detail: {
      document: payload.doc === null ? undefined : JSON.parse(payload.doc),
      knownTraits: new Set(['TESTINPUT-meticulous']),
      getContext: () => ({
        actor: { traits: state.traits ? [{ name: 'TESTINPUT-meticulous', causeId: 'TESTINPUT-fixture' }] : [] },
        switches: state.switches,
      }),
      onEffects: (effects, switches) => { state.applied.push(...effects.map(effect => effect.switchId + '=' + effect.value)); state.switches = switches; },
    } }));
  }, { doc: mode === 'blocked' ? null : doc });

  try {
    const frame = page.frameLocator('iframe');
    await frame.getByRole('button', { name: '아무 키나 누르세요' }).click({ timeout: 10000 });
    await frame.getByRole('button', { name: '새 게임', exact: true }).click({ timeout: 10000 });
    await frame.locator('#select-confirm').click({ timeout: 10000 });
    await wait(300);
    await frame.locator('[data-start]').click({ timeout: 10000 });
    await wait(600);
    out.mapScreen = await inFrame(() => document.querySelector('iframe').contentDocument.querySelector('#realtime').dataset.screen);

    // The world clock must keep running while the dialogue is open (contract §3): set 1x through
    // the real orders speed control, then return to the map before opening the surface.
    await inFrame(() => { document.querySelector('iframe').contentDocument.querySelector('#cm-orders').click(); });
    await wait(300);
    await inFrame(() => { document.querySelector('iframe').contentDocument.querySelector('[data-speed="1"]').click(); });
    await wait(200);
    await inFrame(() => { const d = document.querySelector('iframe').contentDocument; (d.querySelector('#co-back') || d.querySelector('[data-back]')).click(); });
    await wait(300);
    out.speedScreen = await inFrame(() => document.querySelector('iframe').contentDocument.querySelector('#realtime').dataset.screen);

    // 1. blocked: the honest no-admitted-document state, no fabricated speech
    await open('blocked');
    await wait(300);
    await shot('w3-dialogue-blocked-1280x720');
    out.blocked = await inFrame(() => {
      const d = document.querySelector('iframe').contentDocument;
      return { screen: d.querySelector('#realtime').dataset.screen,
        text: (d.querySelector('#cd-text')?.textContent || ''),
        confirmDisabled: d.querySelector('#cd-confirm')?.disabled };
    });

    // 2. ready: prepared snapshot with eligible options and a live world clock that keeps running
    await open('ready');
    await wait(300);
    await shot('w3-dialogue-ready-1280x720');
    out.ready = await inFrame(() => {
      const d = document.querySelector('iframe').contentDocument;
      return { screen: d.querySelector('#realtime').dataset.screen,
        title: d.querySelector('#cd-title')?.textContent,
        clock: d.querySelector('#cd-clock')?.textContent,
        options: [...d.querySelectorAll('[data-option-id]')].map(row => row.dataset.optionId),
        provenance: (d.querySelector('#cd-speaker')?.textContent || '').includes('TESTINPUT'),
        confirmDisabled: d.querySelector('#cd-confirm')?.disabled };
    });
    out.clockBefore = out.ready.clock;
    await wait(1300);
    out.clockAfter = await inFrame(() => document.querySelector('iframe').contentDocument.querySelector('#cd-clock')?.textContent);

    // 3. select the trait-gated option: authored disclosure appears, still no effect
    await inFrame(() => { document.querySelector('iframe').contentDocument.querySelector('[data-option-id="inspect"]').click(); });
    await wait(200);
    await shot('w3-dialogue-selected-1280x720');
    out.selected = await inFrame(() => {
      const d = document.querySelector('iframe').contentDocument;
      return { pressed: d.querySelector('[data-option-id="inspect"]')?.getAttribute('aria-pressed'),
        confirmDisabled: d.querySelector('#cd-confirm')?.disabled,
        disclosure: (d.querySelector('#cd-choices')?.textContent || '').includes('요건'),
        applied: d.defaultView.__qaDialogue.applied };
    });

    // 4. confirmation is cancel-first and repeats the authored option text
    await inFrame(() => { document.querySelector('iframe').contentDocument.querySelector('#cd-confirm').click(); });
    await wait(200);
    await shot('w3-dialogue-confirm-1280x720');
    out.confirm = await inFrame(() => {
      const d = document.querySelector('iframe').contentDocument;
      const dialogElement = d.querySelector('dialog[open]');
      return { open: !!dialogElement, focusIsCancel: d.activeElement?.textContent === '취소',
        body: dialogElement?.querySelector('.sv-confirm__body')?.textContent };
    });
    // cancel restores the selected option without effects
    await inFrame(() => { document.querySelector('iframe').contentDocument.querySelector('dialog[open] .ui-button:not(.ui-button--primary)').click(); });
    await wait(200);
    out.afterCancel = await inFrame(() => {
      const d = document.querySelector('iframe').contentDocument;
      return { pressed: d.querySelector('[data-option-id="inspect"]')?.getAttribute('aria-pressed'), applied: d.defaultView.__qaDialogue.applied };
    });

    // 5. stale negative: trait removed before confirm -> refresh + explanation, no effect
    await inFrame(() => { document.querySelector('iframe').contentDocument.defaultView.__qaDialogue.traits = false; });
    await inFrame(() => { document.querySelector('iframe').contentDocument.querySelector('#cd-confirm').click(); });
    await wait(200);
    await inFrame(() => { document.querySelector('iframe').contentDocument.querySelector('dialog[open] .ui-button--primary').click(); });
    await wait(300);
    await shot('w3-dialogue-stale-1280x720');
    out.stale = await inFrame(() => {
      const d = document.querySelector('iframe').contentDocument;
      return { options: [...d.querySelectorAll('[data-option-id]')].map(row => row.dataset.optionId),
        reason: d.querySelector('#cd-reason')?.textContent, applied: d.defaultView.__qaDialogue.applied,
        confirmDisabled: d.querySelector('#cd-confirm')?.disabled };
    });

    // 6. honest choice on the remaining fallback: effects reach the host once, once-event consumed
    await inFrame(() => { document.querySelector('iframe').contentDocument.querySelector('[data-option-id="defer"]').click(); });
    await wait(200);
    await inFrame(() => { document.querySelector('iframe').contentDocument.querySelector('#cd-confirm').click(); });
    await wait(200);
    await inFrame(() => { document.querySelector('iframe').contentDocument.querySelector('dialog[open] .ui-button--primary').click(); });
    await wait(300);
    await shot('w3-dialogue-applied-1280x720');
    out.applied = await inFrame(() => {
      const d = document.querySelector('iframe').contentDocument;
      return { applied: d.defaultView.__qaDialogue.applied,
        reason: d.querySelector('#cd-reason')?.textContent,
        empty: (d.querySelector('#cd-text')?.textContent || '').includes('표시할 수 있는 사건이 없다'),
        options: [...d.querySelectorAll('[data-option-id]')].length };
    });

    // 7. Escape defers (outer Close), never a synthetic option cancel
    await page.keyboard.press('Escape');
    await wait(300);
    out.afterEscape = await inFrame(() => document.querySelector('iframe').contentDocument.querySelector('#realtime').dataset.screen);
    await shot('w3-after-defer-map-1280x720');

    // 8. reopening re-prepares current context: the consumed once-event no longer plays
    await open('ready');
    await wait(300);
    await shot('w3-dialogue-consumed-1280x720');
    out.consumed = await inFrame(() => {
      const d = document.querySelector('iframe').contentDocument;
      return { empty: (d.querySelector('#cd-text')?.textContent || '').includes('표시할 수 있는 사건이 없다'),
        appliedStill: d.defaultView.__qaDialogue.applied.length };
    });
    await page.keyboard.press('Escape');
    await wait(200);

    // mobile adaptation at 390x844 in a separate harness tab
    if (mobileUrl) {
      await closeTab(page);
      const mobile = await openTab(mobileUrl);
      const mobileFrame = mobile.frameLocator('iframe');
      await mobileFrame.getByRole('button', { name: '아무 키나 누르세요' }).click({ timeout: 10000 });
      await mobileFrame.getByRole('button', { name: '새 게임', exact: true }).click({ timeout: 10000 });
      await mobileFrame.locator('#select-confirm').click({ timeout: 10000 });
      await mobileFrame.locator('[data-start]').click({ timeout: 10000 });
      await mobile.evaluate((payload) => {
        const d = document.querySelector('iframe').contentDocument;
        const state = { traits: true, switches: { 'TESTINPUT-note-ready': true }, applied: [] };
        d.defaultView.__qaDialogue = state;
        d.querySelector('#realtime').dispatchEvent(new CustomEvent('campaign:open-dialogue', { bubbles: true, detail: {
          document: JSON.parse(payload.doc), knownTraits: new Set(['TESTINPUT-meticulous']),
          getContext: () => ({ actor: { traits: state.traits ? [{ name: 'TESTINPUT-meticulous', causeId: 'TESTINPUT-fixture' }] : [] }, switches: state.switches }),
          onEffects: (effects, switches) => { state.applied.push(...effects.map(effect => effect.switchId)); state.switches = switches; },
        } }));
      }, { doc });
      await wait(500);
      await mobile.bringToFront();
      console.log('CAPTURE w3-dialogue-ready-390x844 ' + Buffer.from(await mobile.locator('iframe').screenshot({ type: 'png', margin: 0 })).toString('base64'));
      out.mobile = await mobile.evaluate(() => {
        const d = document.querySelector('iframe').contentDocument;
        const doc = d.documentElement;
        return { screen: d.querySelector('#realtime').dataset.screen,
          options: [...d.querySelectorAll('[data-option-id]')].length,
          horizontalOverflow: doc.scrollWidth > doc.clientWidth };
      });
      await mobile.evaluate(() => { document.querySelector('iframe').contentDocument.querySelector('[data-option-id="defer"]').click(); });
      await wait(200);
      // Mobile stacks the docks; bring the choices (and their selection) into the 844px viewport.
      await mobile.evaluate(() => { const d = document.querySelector('iframe').contentDocument; d.querySelector('#cd-choices').scrollIntoView({ block: 'start' }); d.defaultView.scrollBy(0, -48); });
      await wait(300);
      await mobile.bringToFront();
      console.log('CAPTURE w3-dialogue-selected-390x844 ' + Buffer.from(await mobile.locator('iframe').screenshot({ type: 'png', margin: 0 })).toString('base64'));
      await closeTab(mobile);
    }
    console.log('RESULT ' + JSON.stringify(out));
  } finally {
    await closeTab(page);
  }
}

const args = process.argv.slice(2);
if (args.length < 2 || args.length > 3) { console.error('Required: <frame-url-1280> <evidence-directory> [frame-url-390]'); process.exitCode = 2; }
else {
  const url = new URL(args[0]);
  const mobileUrl = args[2] ? new URL(args[2]) : null;
  const evidence = path.resolve(args[1]);
  await mkdir(path.join(evidence, 'captures'), { recursive: true });
  const doc = readFileSync(path.resolve('game/data/events/testinput-sealed-note.json'), 'utf8');
  const code = 'await (' + inspectCampaign.toString() + ')(' + JSON.stringify(url.href) + (mobileUrl ? ', ' + JSON.stringify(mobileUrl.href) : ', null') + ', ' + JSON.stringify(doc) + ')';
  const child = spawn('aside-agent', ['repl', '--host', 'local', code], { stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks = [];
  child.stdout.on('data', (b) => chunks.push(b)); child.stderr.on('data', (b) => chunks.push(b));
  const timer = setTimeout(() => child.kill('SIGTERM'), 180000);
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
