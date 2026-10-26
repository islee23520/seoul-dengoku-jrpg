/** Serialized into the native Aside REPL. This module has no privileged application access.
 * All mutations are ordinary UI actions. The only state read is an explicitly saved checkpoint.
 * Observational page listeners contain public causal receipts, not hidden world facts. */
export async function campaignBrowserStep(config) {
  const owned = [];
  const ownedIds = [];
  const actions = [];
  const errors = [];
  const baseline = (await listBrowserTabs()).map(tab => tab.targetId).filter(id => !config.previousOwnedIds.includes(id));
  let result;
  const check = (condition, message) => { if (!condition) throw new Error('assertion: ' + message); };
  const open = async url => {
    const before = (await listBrowserTabs()).map(tab => tab.targetId);
    const tab = await openTab(url); owned.push(tab); console.log(await snapshot(tab));
    const created = (await listBrowserTabs()).filter(candidate => !before.includes(candidate.targetId) && candidate.url === url);
    check(created.length === 1, 'owned tab identity is unambiguous'); ownedIds.push(created[0].targetId);
    return tab;
  };
  const click = async (tab, selector) => {
    await tab.locator(selector).click({ timeout: 12000 });
    actions.push({ selector }); console.log(await snapshot(tab));
  };
  const watch = async tab => {
    tab.on('pageerror', error => errors.push({ kind: 'pageerror', message: String(error) }));
    tab.on('console', message => { if (message.type() === 'error') errors.push({ kind: 'console', message: message.text() }); });
    tab.on('requestfailed', request => errors.push({ kind: 'network', url: request.url(), message: String(request.failure()) }));
    await tab.evaluate(() => {
      window.__campaignQa = { events: [], wait: null };
      for (const name of ['campaign:change', 'campaign:view', 'campaign:saved']) {
        document.addEventListener(name, event => window.__campaignQa.events.push({ name, detail: event.detail }));
      }
    });
  };
  const subscribe = async (tab, target) => {
    await tab.evaluate(({ target, timeout }) => {
      window.__campaignQa.wait = new Promise((resolve, reject) => {
        const timer = setTimeout(() => { document.removeEventListener('campaign:change', changed); reject(new Error('campaign-transition-timeout')); }, timeout);
        const changed = event => {
          const detail = event.detail;
          if ((target.time !== undefined && detail.worldMilliseconds >= target.time) ||
              (target.reports !== undefined && detail.reportIds.length === target.reports)) {
            clearTimeout(timer); document.removeEventListener('campaign:change', changed); resolve(detail);
          }
        };
        document.addEventListener('campaign:change', changed);
      });
      // Attach rejection immediately while the ordinary click is in flight.
      window.__campaignQa.wait.catch(() => {});
    }, { target, timeout: config.transitionTimeoutMs ?? 35000 });
  };
  const wait = async tab => tab.evaluate(() => window.__campaignQa.wait);
  const saved = async tab => tab.evaluate(() => {
    const pointer = JSON.parse(localStorage.getItem('seoul-composed-campaign-v2:active'));
    return pointer ? JSON.parse(localStorage.getItem(pointer.current)) : null;
  });
  const save = async tab => {
    const before = await tab.evaluate(() => window.__campaignQa.events.filter(e => e.name === 'campaign:saved').length);
    // Task22 wave2 replaced the session-bar 명시 저장 with the 저장 · 불러오기 opener; the
    // explicit manual save is that surface's primary action behind a cancel-first confirmation.
    const screen = await tab.evaluate(() => document.querySelector('#realtime').dataset.screen);
    await tab.getByRole('button', { name: '저장 · 불러오기', exact: true }).click({ timeout: 12000 });
    await tab.locator('#sv-action').waitFor({ state: 'visible', timeout: 12000 });
    console.log(await snapshot(tab));
    await click(tab, '#sv-action');
    await click(tab, 'dialog.sv-confirm[open] .ui-button--primary');
    const receipt = await tab.evaluate(() => window.__campaignQa.events.filter(e => e.name === 'campaign:saved'));
    check(receipt.length === before + 1, 'save emitted its causal receipt');
    const checkpoint = await saved(tab);
    check(checkpoint.checksum === receipt.at(-1).detail.checksum, 'durable checkpoint matches save receipt');
    // The surface's 뒤로 returns to the map; restore the screen the caller was using.
    await click(tab, '#sv-back');
    if (screen === 'campaign-orders') await click(tab, '#cm-orders');
    return checkpoint;
  };
  const start = async (tab, mode) => {
    await tab.locator('#title-enter').waitFor({ state: 'visible', timeout: 15000 });
    await watch(tab);
    await click(tab, '#title-enter');
    if (mode === 'new') {
      await click(tab, '#menu-new');
      const actor = await tab.evaluate(() => document.querySelector('[role="option"][aria-selected="true"]').dataset.actor);
      check(actor === 'K002', 'ordinary character selection selects K002');
      await click(tab, '#select-confirm');
      await click(tab, '[data-start]');
    } else await click(tab, '#menu-continue');
    await tab.locator('#cm-orders').waitFor({ state: 'visible', timeout: 15000 });
    console.log(await snapshot(tab));
  };
  const capture = async (tab, name) => {
    console.log('CAPTURE ' + config.capturePrefix + '-' + name + ' ' + Buffer.from(await tab.screenshot({ type: 'png', fullPage: true })).toString('base64'));
  };
  try {
    const tab = await open(config.url);
    if (config.kind === 'tamper') {
      await watch(tab);
      await click(tab, '#title-enter'); await click(tab, '#menu-new'); await click(tab, '#select-confirm');
      await tab.evaluate(() => {
        window.__campaignQa.wait = new Promise((resolve, reject) => {
          const timer = setTimeout(() => { observer.disconnect(); reject(new Error('admission-failure-timeout')); }, 20000);
          const observer = new MutationObserver(() => {
            const status = document.querySelector('.ui-select__status');
            if (status?.textContent && !document.querySelector('#select-confirm').disabled) {
              clearTimeout(timer); observer.disconnect(); resolve(status.textContent);
            }
          });
          observer.observe(document.querySelector('#realtime'), { childList: true, subtree: true, characterData: true, attributes: true });
        });
        window.__campaignQa.wait.catch(() => {});
      });
      await click(tab, '[data-start]');
      const failure = await wait(tab);
      check(Boolean(failure), 'tampered pack has visible admission failure');
      check(await saved(tab) === null, 'tampered origin never saves a host');
      check(await tab.locator('#cm-orders').count() === 0, 'tampered pack never enters campaign');
      await capture(tab, 'tamper'); result = { failure, checkpoint: null };
    } else if (config.kind === 'layout') {
      const frame = tab.frameLocator('iframe');
      await frame.locator('#title-enter').click({ timeout: 12000 }); console.log(await snapshot(tab));
      await frame.locator('#menu-continue').click({ timeout: 12000 }); console.log(await snapshot(tab));
      await frame.locator('#cm-orders').waitFor({ state: 'visible', timeout: 15000 });
      await frame.locator('#cm-orders').click({ timeout: 12000 }); console.log(await snapshot(tab));
      const geometry = await tab.evaluate(() => {
        const doc = document.querySelector('iframe').contentDocument;
        return { width: doc.defaultView.innerWidth, height: doc.defaultView.innerHeight,
          clientWidth: doc.documentElement.clientWidth,
          scrollWidth: doc.documentElement.scrollWidth, screen: doc.querySelector('#realtime').dataset.screen,
          buttons: [...doc.querySelectorAll('[data-speed]')].map(button => {
            const r = button.getBoundingClientRect(); return { width: r.width, height: r.height };
          }) };
      });
      console.log('CAPTURE ' + config.capturePrefix + '-layout-' + config.width + ' ' + Buffer.from(await tab.locator('iframe').screenshot({ type: 'png', margin: 0 })).toString('base64'));
      console.log('GEOMETRY ' + JSON.stringify(geometry));
      check(geometry.width === config.width && geometry.height === config.height, 'actual responsive document viewport');
      check(geometry.scrollWidth <= geometry.width && geometry.screen === 'campaign-orders', 'responsive surface is present without horizontal overflow');
      result = { geometry, viewportMethod: 'unscaled same-origin iframe; native top-level resize unavailable' };
    } else {
      await start(tab, config.kind === 'initial' ? 'new' : 'saved');
      if (config.kind === 'initial') {
        check(await saved(tab) === null, 'fresh origin has no prior save');
        await capture(tab, 'map');
      }
      if (config.kind === 'second-tab') {
        const before = await save(tab);
        const second = await open(config.url);
        await watch(second); await click(second, '#title-enter');
        await second.evaluate(() => {
          window.__campaignQa.wait = new Promise((resolve, reject) => {
            const timer = setTimeout(() => { observer.disconnect(); reject(new Error('second-tab-refusal-timeout')); }, 20000);
            const observer = new MutationObserver(() => {
              const status = document.querySelector('.ui-menu__status').textContent;
              if (!document.querySelector('#menu-continue').disabled && status.includes('읽기 전용')) {
                clearTimeout(timer); observer.disconnect(); resolve(status);
              }
            });
            observer.observe(document.querySelector('#realtime'), { subtree: true, childList: true, characterData: true, attributes: true });
          });
          window.__campaignQa.wait.catch(() => {});
        });
        await click(second, '#menu-continue'); const refusal = await wait(second);
        check(await second.locator('#cm-orders').count() === 0, 'second tab never gains writable campaign controls');
        const after = await save(tab);
        check(after.checksum === before.checksum, 'second-tab attempt leaves writer unchanged');
        await capture(second, 'second-tab');
        if (config.takeover) {
          const held = await tab.evaluate(() => navigator.locks.query());
          check(held.held.filter(lock => lock.name === 'campaign:seoul-composed-campaign-v2').length === 1, 'exactly one live writer lock');
          await closeTab(tab); owned.splice(owned.indexOf(tab), 1);
          // A granted lock request is the causal release signal from the closed writer.
          await second.evaluate(() => navigator.locks.request('campaign:seoul-composed-campaign-v2', () => {}));
          await click(second, '#menu-continue');
          await second.locator('#cm-orders').waitFor({ state: 'visible', timeout: 15000 });
          const taken = await save(second);
          check((config.mutate ? taken.checksum + ':offline-credit' : taken.checksum) === after.checksum, 'explicit takeover adds no offline accrual or duplicate effects');
          await capture(second, 'takeover');
          result = { checkpoint: taken, refusal, before: after };
          result.events = await second.evaluate(() => window.__campaignQa.events);
        } else result = { checkpoint: after, refusal };
      } else {
        await click(tab, '#cm-orders');
        const entry = await save(tab);
        if (config.expectedChecksum) check(entry.checksum === config.expectedChecksum, 'fresh-session exact restore before next action');
        if (config.kind === 'reload') {
          await tab.reload(); console.log(await snapshot(tab));
          await start(tab, 'saved'); await click(tab, '#cm-orders');
          const restored = await save(tab);
          check(restored.checksum === entry.checksum, 'actual page reload preserves exact paused save');
          await capture(tab, 'reload'); result = { checkpoint: restored, before: entry };
        } else {
          if (config.issue) {
            await click(tab, '.co-row[data-pick="' + config.issue + '"]');
            await click(tab, '[data-review]'); await click(tab, '[data-issue]');
          }
          if (config.target) {
            await subscribe(tab, config.target);
            await click(tab, '[data-speed="' + (config.speed ?? 4) + '"]');
            const reached = await wait(tab);
            actions.push({ transition: reached });
            await click(tab, '[data-speed="0"]');
          }
          const checkpoint = await save(tab);
          await capture(tab, config.kind);
          if (config.unseen) {
            await click(tab, '[data-back]'); await click(tab, '#cm-reports');
            check(await tab.locator('[data-report]').count() === 0, 'unreceived observations remain absent from inbox');
            check(checkpoint.state.facts.length > 0 && checkpoint.state.reports.every(report => report.receivedAt === null), 'unseen-truth challenge has actual undelivered evidence');
            await capture(tab, 'unseen-inbox');
          }
          if (config.kind === 'complete') {
            await click(tab, '[data-back]');
            await click(tab, '.cm-target[data-region="region:1147063000"]');
            await click(tab, '[data-pick="osm:node:368899387"]');
            await tab.getByRole('button', { name: '정착지 집행 보기', exact: true }).click({ timeout: 12000 }); console.log(await snapshot(tab));
            check(await tab.locator('#cs-work [data-work]').count() === 2, 'settlement presents both real mandates');
            await capture(tab, 'settlement'); await click(tab, '#cs-reports');
            const reports = await tab.evaluate(() => [...document.querySelectorAll('[data-report]')].map(el => el.dataset.report));
            check(new Set(reports).size === 6, 'inbox shows six received report identities');
            await capture(tab, 'inbox');
            result = { checkpoint, visibleReportIds: [...new Set(reports)] };
          } else result = { checkpoint };
        }
      }
      if (!result.events) result.events = await tab.evaluate(() => window.__campaignQa.events);
    }
    result = { ok: true, ...result, actions, errors };
  } catch (error) {
    result = { ok: false, error: String(error.message) + '\n' + String(error.stack ?? error), actions, errors };
  } finally {
    const cleanupErrors = [];
    for (const tab of owned.reverse()) {
      try { await closeTab(tab); }
      catch (error) { cleanupErrors.push(String(error.message) + '\n' + String(error.stack ?? error)); }
    }
    const after = (await listBrowserTabs()).map(tab => tab.targetId);
    result.cleanup = { baseline, after, ownedIds, baselinePreserved: baseline.every(id => after.includes(id)),
      ownedTabsRemaining: ownedIds.filter(id => after.includes(id)), concurrentTabs: after.filter(id => !baseline.includes(id) && !ownedIds.includes(id)), cleanupErrors };
    if (result.cleanup.ownedTabsRemaining.length || cleanupErrors.length) {
      result.ok = false; result.error = (result.error ?? '') + '\nowned-tab cleanup failed\n' + cleanupErrors.join('\n');
    }
    console.log('CAMPAIGN_RESULT ' + JSON.stringify(result));
  }
}
