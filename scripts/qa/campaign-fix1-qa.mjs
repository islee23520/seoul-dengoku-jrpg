import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Native Aside regression probe (task22 fix-1): drives the fixed surfaces on the real
 * production build — character selection (R3 anatomy), the real save restore, corrupt-save
 * state, task26 §3 mobile pane navigation on every fixed surface, 640x360 (200% text) flow
 * and keyboard focus — at 1280x720 / 390x844 harness URLs. */
async function inspectCampaign(desktop, mobile, textscale, doc) {
  const page = await openTab(desktop);
  const out = {};
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const inFrame = (fn, arg) => page.evaluate(fn, arg);
  const shot = async (label) => {
    await page.bringToFront();
    console.log('CAPTURE ' + label + ' ' + Buffer.from(await page.locator('iframe').screenshot({ type: 'png', margin: 0 })).toString('base64'));
  };

  try {
    const frame = page.frameLocator('iframe');
    await frame.getByRole('button', { name: '아무 키나 누르세요' }).click({ timeout: 10000 });
    await wait(400);
    await frame.getByRole('button', { name: '새 게임', exact: true }).click({ timeout: 10000 });
    await wait(600);

    // ---- character selection: R3 anatomy (roster / map stage / detail) + modes + search
    await shot('f1-selection-ready-1280x720');
    out.selection = await inFrame(() => {
      const d = document.querySelector('iframe').contentDocument;
      const regions = d.querySelectorAll('.ui-select__region').length;
      const start = d.querySelector('.ui-select__region--start');
      const selectedCard = d.querySelector('.ui-card.is-selected');
      return { screen: d.querySelector('#realtime').dataset.screen,
        regions, startHighlighted: !!start && start.getAttribute('d').length > 10,
        selectedActor: selectedCard?.dataset.actor,
        portraitFallback: (d.querySelector('.ui-portrait')?.textContent || '').includes('초상 자리'),
        biographyNote: (d.querySelector('.ui-select__note')?.textContent || '').includes('인준되지 않았다'),
        startDesignated: (d.querySelector('.ui-card__start')?.textContent || '') === '개막 지정',
        facts: [...d.querySelectorAll('.ui-select__facts .ui-fact dt')].map(term => term.textContent) };
    });
    // keyboard focus ring on the selected card (focus-visible flows)
    await inFrame(() => { const d = document.querySelector('iframe').contentDocument; d.querySelector('.ui-card.is-selected').focus(); });
    await wait(200);
    await shot('f1-selection-focus-1280x720');

    // mode toggle (E = 작위) reorders: title-holder first
    await page.keyboard.press('e');
    await wait(300);
    await shot('f1-selection-titles-mode-1280x720');
    out.titlesMode = await inFrame(() => {
      const d = document.querySelector('iframe').contentDocument;
      return { pressed: d.querySelector('#select-mode-titles').getAttribute('aria-pressed'),
        first: d.querySelector('.ui-card:not([hidden])')?.dataset.actor };
    });

    // search: filter to 백산석, then a query with no result (empty reset state)
    await page.keyboard.press('/');
    await wait(200);
    await page.keyboard.type('백산석');
    await wait(300);
    await shot('f1-selection-search-hit-1280x720');
    out.searchHit = await inFrame(() => {
      const d = document.querySelector('iframe').contentDocument;
      return { visible: [...d.querySelectorAll('.ui-card:not([hidden])')].map(card => card.dataset.actor),
        count: d.querySelector('.ui-select__count').textContent, detailName: d.querySelector('.ui-select__name')?.textContent };
    });
    await inFrame(() => { const d = document.querySelector('iframe').contentDocument; const input = d.querySelector('#select-search'); input.value = 'ㅅㅂ'; input.dispatchEvent(new Event('input', { bubbles: true })); });
    await wait(300);
    await shot('f1-selection-search-empty-1280x720');
    out.searchEmpty = await inFrame(() => {
      const d = document.querySelector('iframe').contentDocument;
      return { visible: d.querySelectorAll('.ui-card:not([hidden])').length,
        none: (d.querySelector('.ui-select__bio')?.textContent || '').includes('없음') };
    });
    // Escape inside search clears it first (topmost), second Escape returns to menu is NOT triggered here
    await page.keyboard.press('Escape');
    await wait(200);
    out.searchCleared = await inFrame(() => {
      const d = document.querySelector('iframe').contentDocument;
      return { screen: d.querySelector('#realtime').dataset.screen, visible: d.querySelectorAll('.ui-card:not([hidden])').length };
    });

    // K568 selection + honest start refusal, then K002 confirm cancel-first
    await inFrame(() => { const d = document.querySelector('iframe').contentDocument; d.querySelector('.ui-card[data-actor="K568"]').click(); });
    await wait(300);
    await inFrame(() => { const d = document.querySelector('iframe').contentDocument; d.querySelector('#select-confirm').click(); });
    await wait(200);
    await shot('f1-selection-start-confirm-1280x720');
    out.startConfirm = await inFrame(() => {
      const d = document.querySelector('iframe').contentDocument;
      const dialogElement = d.querySelector('.ui-scrim .ui-dialog');
      return { open: !!dialogElement, focusIsCancel: d.activeElement?.textContent?.includes('취소') };
    });
    await inFrame(() => { document.querySelector('iframe').contentDocument.querySelector('[data-start]').click(); });
    await wait(600);
    await shot('f1-selection-k568-refused-1280x720');
    out.refused = await inFrame(() => {
      const d = document.querySelector('iframe').contentDocument;
      return { screen: d.querySelector('#realtime').dataset.screen, status: d.querySelector('.ui-select__status')?.textContent };
    });
    // back to K002 and start the campaign for the runtime phases
    await inFrame(() => { const d = document.querySelector('iframe').contentDocument; d.querySelector('.ui-card[data-actor="K002"]').click(); });
    await wait(200);
    await inFrame(() => { document.querySelector('iframe').contentDocument.querySelector('#select-confirm').click(); });
    await wait(200);
    await inFrame(() => { document.querySelector('iframe').contentDocument.querySelector('[data-start]').click(); });
    await wait(900);
    out.mapScreen = await inFrame(() => document.querySelector('iframe').contentDocument.querySelector('#realtime').dataset.screen);
    await inFrame(() => {
      const d = document.querySelector('iframe').contentDocument;
      const theme = d.querySelector('.ui-theme-select');
      theme.value = 'light'; theme.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await wait(250);
    await shot('f1-map-light-1280x720');
    out.lightTheme = await inFrame(() => {
      const d = document.querySelector('iframe').contentDocument;
      return { theme: d.documentElement.dataset.uiTheme, canvas: d.defaultView.getComputedStyle(d.documentElement).getPropertyValue('--color-canvas').trim() };
    });
    await inFrame(() => {
      const d = document.querySelector('iframe').contentDocument;
      const theme = d.querySelector('.ui-theme-select');
      theme.value = 'dark'; theme.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // ---- orders: issue K568, withdrawal request, then the occupied-duty conflict refusal
    const pick = (actor) => inFrame((id) => { const d = document.querySelector('iframe').contentDocument; d.querySelector('.co-row[data-pick="' + id + '"]').click(); }, actor);
    await inFrame(() => { document.querySelector('iframe').contentDocument.querySelector('#cm-orders').click(); });
    await wait(400);
    await pick('K568');
    await wait(300);
    await inFrame(() => { document.querySelector('iframe').contentDocument.querySelector('[data-review]').click(); });
    await wait(200);
    await inFrame(() => { const d = document.querySelector('iframe').contentDocument; const issue = d.querySelector('[data-issue]'); if (issue) issue.click(); });
    await wait(600);
    out.issued = await inFrame(() => {
      const d = document.querySelector('iframe').contentDocument;
      return { orders: d.querySelectorAll('[data-order]').length };
    });
    await shot('f1-orders-issued-1280x720');

    // withdrawal request on the issued order (철회 요청 검토, cancel-first)
    await inFrame(() => { const d = document.querySelector('iframe').contentDocument; const row = d.querySelector('[data-cancel-request]'); if (row) row.click(); });
    await wait(300);
    await shot('f1-orders-cancel-request-1280x720');
    out.cancelRequest = await inFrame(() => {
      const d = document.querySelector('iframe').contentDocument;
      const dialogElement = d.querySelector('.co-dialog');
      return { open: !!dialogElement, focusIsCancel: d.activeElement?.textContent?.includes('취소'),
        body: dialogElement?.textContent?.slice(0, 80) ?? null };
    });
    await inFrame(() => { const d = document.querySelector('iframe').contentDocument; const confirmButton = d.querySelector('[data-cancel-confirm]'); if (confirmButton) confirmButton.click(); });
    await wait(600);
    await shot('f1-orders-cancel-pending-1280x720');
    out.afterCancel = await inFrame(() => {
      const d = document.querySelector('iframe').contentDocument;
      return { pending: (d.querySelector('#realtime').textContent || '').includes('철회') };
    });

    // conflict/occupancy refusal: attempt the same recipient+operation again while active
    await pick('K568');
    await wait(300);
    await inFrame(() => { const d = document.querySelector('iframe').contentDocument; const review = d.querySelector('[data-review]'); if (review && !review.disabled) review.click(); });
    await wait(200);
    await inFrame(() => { const d = document.querySelector('iframe').contentDocument; const issue = d.querySelector('[data-issue]'); if (issue) issue.click(); });
    await wait(600);
    await shot('f1-orders-conflict-refusal-1280x720');
    out.conflict = await inFrame(() => {
      const d = document.querySelector('iframe').contentDocument;
      const reason = d.querySelector('.co-reason');
      const row = d.querySelector('.co-row[data-pick="K568"]');
      return { refused: !!reason && reason.getAttribute('role') === 'alert', text: reason?.textContent ?? null,
        reviewDisabled: d.querySelector('[data-review]')?.disabled ?? null,
        rosterReason: row?.textContent ?? null,
        orders: d.querySelectorAll('[data-order]').length };
    });

    // ---- saves: real restore (save at boundary, run world, restore returns to it)
    await inFrame(() => { const d = document.querySelector('iframe').contentDocument; const dismiss = d.querySelector('[data-modal-cancel]'); if (dismiss) dismiss.click(); });
    await wait(200);
    await inFrame(() => { const d = document.querySelector('iframe').contentDocument; const speed = d.querySelector('[data-speed="1"]'); if (speed) speed.click(); });
    await wait(200);
    await inFrame(() => { const d = document.querySelector('iframe').contentDocument; (d.querySelector('[data-back]') || d.querySelector('#co-back'))?.click(); });
    await wait(400);
    await wait(2500);
    await inFrame(() => { const d = document.querySelector('iframe').contentDocument; [...d.querySelectorAll('button')].find((b) => (b.textContent || '').includes('저장 · 불러오기'))?.click(); });
    await frame.locator('#sv-action').waitFor({ state: 'visible', timeout: 12000 });
    await wait(200);
    // Save first at this running boundary
    await inFrame(() => { document.querySelector('iframe').contentDocument.querySelector('#sv-action').click(); });
    await frame.locator('dialog.sv-confirm[open]').waitFor({ state: 'visible', timeout: 12000 });
    const savedClock = await inFrame(() => document.querySelector('iframe').contentDocument.querySelector('#sv-clock')?.textContent);
    await inFrame(() => { document.querySelector('iframe').contentDocument.querySelector('dialog.sv-confirm[open] .ui-button--primary').click(); });
    await wait(400);
    // let the world run further, then restore: the header clock must return to the saved boundary
    await wait(3000);
    const runClock = await inFrame(() => document.querySelector('iframe').contentDocument.querySelector('#sv-clock')?.textContent);
    await frame.locator('#sv-tab-load').click({ timeout: 12000 });
    await wait(200);
    await shot('f1-saves-load-review-1280x720');
    await frame.locator('#sv-action').click({ timeout: 12000 });
    await wait(200);
    await shot('f1-saves-load-confirm-1280x720');
    out.loadConfirm = await inFrame(() => {
      const d = document.querySelector('iframe').contentDocument;
      const dialogElement = d.querySelector('dialog.sv-confirm[open]');
      return { open: !!dialogElement, focusIsCancel: d.activeElement?.textContent === '취소' };
    });
    await inFrame(() => { document.querySelector('iframe').contentDocument.querySelector('dialog.sv-confirm[open] .ui-button--primary').click(); });
    await wait(600);
    await shot('f1-saves-restored-1280x720');
    out.restored = await inFrame(() => {
      const d = document.querySelector('iframe').contentDocument;
      return { reason: d.querySelector('#sv-reason')?.textContent, clock: d.querySelector('#sv-clock')?.textContent };
    });
    out.restoreClocks = { savedClock, runClock, restored: out.restored.clock };
    // focus after dialog close returns to the opener (#sv-action), not a detached button
    out.focusAfterDialog = await inFrame(() => {
      const d = document.querySelector('iframe').contentDocument;
      return { isAction: d.activeElement?.id === 'sv-action' };
    });

    // corrupt-save negative: garbage payload refuses load and keeps the surface honest
    await inFrame(() => {
      const w = document.querySelector('iframe').contentWindow;
      const pointer = JSON.parse(w.localStorage.getItem('seoul-composed-campaign-v2:active'));
      w.__fix1SavedPayload = w.localStorage.getItem(pointer.current);
      w.localStorage.setItem(pointer.current, '{corrupt');
    });
    await inFrame(() => { const d = document.querySelector('iframe').contentDocument; d.querySelector('#sv-tab-save').click(); });
    await wait(200);
    await inFrame(() => { const d = document.querySelector('iframe').contentDocument; d.querySelector('#sv-tab-load').click(); });
    await wait(300);
    await shot('f1-saves-corrupt-1280x720');
    out.corrupt = await inFrame(() => {
      const d = document.querySelector('iframe').contentDocument;
      return { corruptTitle: (d.querySelector('#sv-detail')?.textContent || '').includes('저장을 읽을 수 없다'),
        loadDisabled: d.querySelector('#sv-action')?.disabled };
    });
    // Private negative cases only: retain the real bytes, then force quota and incompatible envelope errors.
    await inFrame(() => {
      const w = document.querySelector('iframe').contentWindow;
      const pointer = JSON.parse(w.localStorage.getItem('seoul-composed-campaign-v2:active'));
      w.localStorage.setItem(pointer.current, w.__fix1SavedPayload);
      w.__fix1OriginalSetItem = w.Storage.prototype.setItem;
      w.Storage.prototype.setItem = function () { throw new w.DOMException('QA storage quota', 'QuotaExceededError'); };
      w.document.querySelector('#sv-tab-save').click();
      w.document.querySelector('#sv-action').click();
    });
    await wait(200);
    await inFrame(() => document.querySelector('iframe').contentDocument.querySelector('dialog.sv-confirm[open] .ui-button--primary').click());
    await wait(250);
    await shot('f1-saves-storage-error-1280x720');
    out.storageFailure = await inFrame(() => document.querySelector('iframe').contentDocument.querySelector('#sv-reason').textContent);
    await inFrame(() => {
      const w = document.querySelector('iframe').contentWindow;
      w.Storage.prototype.setItem = w.__fix1OriginalSetItem;
      const pointer = JSON.parse(w.localStorage.getItem('seoul-composed-campaign-v2:active'));
      const incompatible = JSON.parse(w.__fix1SavedPayload); incompatible.envelopeVersion = 999;
      w.localStorage.setItem(pointer.current, JSON.stringify(incompatible));
      w.document.querySelector('#sv-tab-load').click();
    });
    await wait(250);
    await shot('f1-saves-version-incompatible-1280x720');
    out.incompatible = await inFrame(() => ({ disabled: document.querySelector('iframe').contentDocument.querySelector('#sv-action').disabled }));
    await page.keyboard.press('Escape');
    await wait(300);

    // ---- settlement + reports mobile panes and dialogue panes are covered on the mobile tab
    await closeTab(page);

    // ---- mobile 390x844: pane navigation on selection, orders, settlement, reports, saves, dialogue
    const tab = await openTab(mobile);
    const mobileFrame = tab.frameLocator('iframe');
    await mobileFrame.getByRole('button', { name: '아무 키나 누르세요' }).click({ timeout: 10000 });
    await wait(600);
    await mobileFrame.getByRole('button', { name: '새 게임', exact: true }).click({ timeout: 10000 });
    await mobileFrame.locator('.ui-card[data-actor="K002"]').waitFor({ state: 'visible', timeout: 12000 });
    await wait(600);
    await tab.bringToFront();
    await wait(200);
    console.log('CAPTURE f1-selection-list-390x844 ' + Buffer.from(await tab.locator('iframe').screenshot({ type: 'png', margin: 0 })).toString('base64'));
    out.selectionMobile = await tab.evaluate(() => {
      const d = document.querySelector('iframe').contentDocument;
      const root = d.querySelector('.ui-select');
      return { pane: root.dataset.pane, rosterVisible: !!d.querySelector('.ui-select__dock:not(.ui-select__detail)').offsetParent,
        detailVisible: !!d.querySelector('.ui-select__detail').offsetParent, barButtons: d.querySelectorAll('.cs-panes__button').length };
    });
    // tapping a card opens the detail pane (map + facts); Back unwinds to the list with selection kept
    await mobileFrame.locator('.ui-card[data-actor="K002"]').click({ timeout: 12000 });
    await wait(300);
    await tab.bringToFront();
    console.log('CAPTURE f1-selection-detail-390x844 ' + Buffer.from(await tab.locator('iframe').screenshot({ type: 'png', margin: 0 })).toString('base64'));
    out.selectionDetail = await tab.evaluate(() => {
      const d = document.querySelector('iframe').contentDocument;
      return { pane: d.querySelector('.ui-select').dataset.pane, mapVisible: !!d.querySelector('#select-map').offsetParent,
        portraitVisible: !!d.querySelector('.ui-portrait').offsetParent };
    });
    await mobileFrame.locator('.cs-panes__button').first().click({ timeout: 12000 });
    await wait(300);
    out.backToList = await tab.evaluate(() => {
      const d = document.querySelector('iframe').contentDocument;
      return { pane: d.querySelector('.ui-select').dataset.pane,
        selectionKept: d.querySelector('.ui-card.is-selected')?.dataset.actor };
    });
    // proceed into the campaign and check the fixed surfaces' panes
    await mobileFrame.locator('.cs-panes__button').nth(1).click({ timeout: 12000 });
    await wait(300);
    await mobileFrame.locator('#select-confirm').click({ timeout: 12000 });
    await mobileFrame.locator('[data-start]').waitFor({ state: 'visible', timeout: 12000 });
    await mobileFrame.locator('[data-start]').click({ timeout: 12000 });
    await mobileFrame.locator('#cm-orders').waitFor({ state: 'visible', timeout: 15000 });
    const paneState = (selector) => tab.evaluate((rootSelector) => {
      const d = document.querySelector('iframe').contentDocument;
      const root = d.querySelector(rootSelector);
      if (!root) return null;
      return { pane: root.dataset.pane, docScroll: d.documentElement.scrollWidth <= d.documentElement.clientWidth };
    }, selector);
    // orders: list pane default; detail pane shows composer; back unwinds
    await tab.evaluate(() => { document.querySelector('iframe').contentDocument.querySelector('#cm-orders').click(); });
    await wait(500);
    await tab.bringToFront();
    console.log('CAPTURE f1-orders-list-390x844 ' + Buffer.from(await tab.locator('iframe').screenshot({ type: 'png', margin: 0 })).toString('base64'));
    out.ordersMobile = await paneState('.co');
    await tab.evaluate(() => { const d = document.querySelector('iframe').contentDocument; [...d.querySelectorAll('.cs-panes__button')].find((b) => b.getAttribute('aria-pressed') === 'false').click(); });
    await wait(400);
    await tab.bringToFront();
    console.log('CAPTURE f1-orders-detail-390x844 ' + Buffer.from(await tab.locator('iframe').screenshot({ type: 'png', margin: 0 })).toString('base64'));
    out.ordersDetail = await paneState('.co');
    // Back unwinds the open detail pane first (task26 §3); leaving the view may need a second press.
    await tab.evaluate(() => { document.querySelector('iframe').contentDocument.querySelector('[data-back]').click(); });
    await wait(300);
    await tab.evaluate(() => { document.querySelector('iframe').contentDocument.querySelector('[data-back]')?.click(); });
    await wait(500);
    // settlement: people list pane; detail = place + custody
    await tab.evaluate(() => {
      const d = document.querySelector('iframe').contentDocument;
      if (!d.querySelector('#cm-tab-sites')) throw new Error('not-on-map-after-orders-back');
      d.querySelector('#cm-tab-sites').click();
      const target = [...d.querySelectorAll('[data-region]')].find((p) => p.dataset.region === 'region:1147063000') || d.querySelector('[data-region]');
      target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      const siteRow = [...d.querySelectorAll('[data-pick]')].find((r) => r.dataset.pick.startsWith('osm:'));
      if (siteRow) siteRow.click();
      const entry = d.querySelector('#cm-open-settlement');
      if (entry) entry.click();
    });
    await wait(500);
    await tab.bringToFront();
    console.log('CAPTURE f1-settlement-list-390x844 ' + Buffer.from(await tab.locator('iframe').screenshot({ type: 'png', margin: 0 })).toString('base64'));
    out.settlementMobile = await paneState('.cs');
    await tab.evaluate(() => { const d = document.querySelector('iframe').contentDocument; [...d.querySelectorAll('.cs-panes__button')].find((b) => b.getAttribute('aria-pressed') === 'false').click(); });
    await wait(400);
    await tab.bringToFront();
    console.log('CAPTURE f1-settlement-detail-390x844 ' + Buffer.from(await tab.locator('iframe').screenshot({ type: 'png', margin: 0 })).toString('base64'));
    out.settlementDetail = await paneState('.cs');
    await tab.evaluate(() => { const d = document.querySelector('iframe').contentDocument; (d.querySelector('#cs-back') || d.querySelector('#cs-footer-back')).click(); });
    await wait(300);
    await tab.evaluate(() => { const d = document.querySelector('iframe').contentDocument; (d.querySelector('#cs-back') || d.querySelector('#cs-footer-back'))?.click(); });
    await wait(500);
    // reports (empty inbox mobile) and saves (list + detail) panes
    await tab.evaluate(() => { const d = document.querySelector('iframe').contentDocument; if (!d.querySelector('#cm-reports')) throw new Error('not-on-map-after-settlement-back'); d.querySelector('#cm-reports').click(); });
    await wait(400);
    await tab.bringToFront();
    console.log('CAPTURE f1-reports-list-390x844 ' + Buffer.from(await tab.locator('iframe').screenshot({ type: 'png', margin: 0 })).toString('base64'));
    out.reportsMobile = await paneState('.cr');
    await tab.evaluate(() => { document.querySelector('iframe').contentDocument.querySelector('#cr-back').click(); });
    await wait(300);
    await tab.evaluate(() => { const d = document.querySelector('iframe').contentDocument; [...d.querySelectorAll('button')].find((b) => (b.textContent || '').includes('저장 · 불러오기')).click(); });
    await wait(400);
    await tab.bringToFront();
    console.log('CAPTURE f1-saves-list-390x844 ' + Buffer.from(await tab.locator('iframe').screenshot({ type: 'png', margin: 0 })).toString('base64'));
    out.savesMobile = await paneState('.sv');
    await tab.evaluate(() => { const d = document.querySelector('iframe').contentDocument; [...d.querySelectorAll('.cs-panes__button')].find((b) => b.getAttribute('aria-pressed') === 'false').click(); });
    await wait(400);
    await tab.bringToFront();
    console.log('CAPTURE f1-saves-detail-390x844 ' + Buffer.from(await tab.locator('iframe').screenshot({ type: 'png', margin: 0 })).toString('base64'));
    out.savesDetail = await paneState('.sv');
    // dialogue panes through the TESTINPUT ingress (narrative-first detail, choices list)
    await tab.evaluate((payload) => {
      const d = document.querySelector('iframe').contentDocument;
      const state = { traits: true, switches: { 'TESTINPUT-note-ready': true }, applied: [] };
      d.defaultView.__qaDialogue = state;
      d.querySelector('#realtime').dispatchEvent(new CustomEvent('campaign:open-dialogue', { bubbles: true, detail: {
        document: JSON.parse(payload.doc), knownTraits: new Set(['TESTINPUT-meticulous']),
        getContext: () => ({ actor: { traits: state.traits ? [{ name: 'TESTINPUT-meticulous', causeId: 'x' }] : [] }, switches: state.switches }),
        onEffects: (effects, switches) => { state.applied.push(...effects.map(effect => effect.switchId)); state.switches = switches; },
      } }));
    }, { doc });
    await wait(500);
    await tab.bringToFront();
    console.log('CAPTURE f1-dialogue-detail-390x844 ' + Buffer.from(await tab.locator('iframe').screenshot({ type: 'png', margin: 0 })).toString('base64'));
    out.dialogueMobile = await paneState('.cd');
    await tab.evaluate(() => { const d = document.querySelector('iframe').contentDocument; [...d.querySelectorAll('.cs-panes__button')].find((b) => (b.textContent || '').includes('선택지')).click(); });
    await wait(400);
    await tab.bringToFront();
    console.log('CAPTURE f1-dialogue-choices-390x844 ' + Buffer.from(await tab.locator('iframe').screenshot({ type: 'png', margin: 0 })).toString('base64'));
    out.dialogueChoices = await paneState('.cd');
    await closeTab(tab);

    // Narrow viewport plus actual doubled typography tokens: layout/accessibility stress, not device emulation.
    const wide = await openTab(textscale);
    const wideFrame = wide.frameLocator('iframe');
    await wideFrame.getByRole('button', { name: '아무 키나 누르세요' }).click({ timeout: 10000 });
    await wait(400);
    await wideFrame.getByRole('button', { name: '새 게임', exact: true }).click({ timeout: 10000 });
    await wait(700);
    await wide.evaluate(() => {
      const d = document.querySelector('iframe').contentDocument;
      const styles = d.defaultView.getComputedStyle(d.documentElement);
      for (const name of ['--type-display', '--type-h1', '--type-h2', '--type-h3', '--type-body', '--type-label', '--type-caption']) {
        const value = Number.parseFloat(styles.getPropertyValue(name));
        if (Number.isFinite(value)) d.documentElement.style.setProperty(name, value * 2 + 'px');
      }
      d.querySelector('.cs-panes__button:last-child').click();
    });
    await wait(300);
    await wide.bringToFront();
    console.log('CAPTURE f1-selection-640x360 ' + Buffer.from(await wide.locator('iframe').screenshot({ type: 'png', margin: 0 })).toString('base64'));
    out.textScale = await wide.evaluate(() => {
      const d = document.querySelector('iframe').contentDocument;
      return { pane: d.querySelector('.ui-select')?.dataset.pane, noHorizontalScroll: d.documentElement.scrollWidth <= d.documentElement.clientWidth,
        actionsVisible: !!d.querySelector('.ui-select__actions')?.offsetParent };
    });
    await closeTab(wide);
    const checks = {
      selectionMap: out.selection.regions === 427 && out.selection.startHighlighted,
      search: out.searchHit.visible.length === 1 && out.searchHit.visible[0] === 'K568' && out.searchEmpty.visible === 0,
      confirmation: out.startConfirm.focusIsCancel && out.loadConfirm.focusIsCancel,
      savedRestore: out.restored.reason.startsWith('되돌림') && out.restoreClocks.runClock !== out.restoreClocks.restored,
      focus: out.focusAfterDialog.isAction,
      corrupt: out.corrupt.corruptTitle && out.corrupt.loadDisabled,
      storage: out.storageFailure.includes('저장 실패'),
      incompatible: out.incompatible.disabled,
      mobileSelection: out.selectionMobile.pane === 'list' && !out.selectionMobile.detailVisible && out.selectionDetail.pane === 'detail' && out.backToList.selectionKept === 'K002',
      mobilePanes: out.ordersMobile.pane === 'list' && out.ordersDetail.pane === 'detail' && out.settlementMobile.pane === 'list' && out.settlementDetail.pane === 'detail' && out.reportsMobile.pane === 'list' && out.savesDetail.pane === 'detail' && out.dialogueChoices.pane === 'list',
      light: out.lightTheme.theme === 'light' && out.lightTheme.canvas.toUpperCase() === '#F4F1E9',
      textScale: out.textScale.noHorizontalScroll && out.textScale.actionsVisible,
    };
    out.checks = checks;
    const failed = Object.entries(checks).filter(([, pass]) => !pass).map(([name]) => name);
    if (failed.length) throw new Error('fix1-acceptance-failed: ' + failed.join(', ') + ' · ' + JSON.stringify(out));
    console.log('RESULT ' + JSON.stringify(out));
  } finally {
    await closeTab(page).catch(() => {});
  }
}

const args = process.argv.slice(2);
if (args.length !== 4) { console.error('Required: <desktop-1280-url> <mobile-390-url> <textscale-640-url> <evidence-directory>'); process.exitCode = 2; }
else {
  const evidence = path.resolve(args[3]);
  await mkdir(path.join(evidence, 'captures'), { recursive: true });
  const doc = readFileSync(path.resolve('game/data/events/testinput-sealed-note.json'), 'utf8');
  const code = 'await (' + inspectCampaign.toString() + ')(' + args.slice(0, 3).map(value => JSON.stringify(value)).join(', ') + ', ' + JSON.stringify(doc) + ')';
  const child = spawn('aside-agent', ['repl', '--host', 'local', code], { stdio: ['ignore', 'pipe', 'pipe'] });
  const chunks = [];
  child.stdout.on('data', (b) => chunks.push(b)); child.stderr.on('data', (b) => chunks.push(b));
  const timer = setTimeout(() => child.kill('SIGTERM'), 300000);
  const exit = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  clearTimeout(timer);
  const output = Buffer.concat(chunks).toString();
  for (const match of output.matchAll(/^CAPTURE (\S+) ([A-Za-z0-9+/=]+)$/gm)) {
    await writeFile(path.join(evidence, 'captures', match[1] + '.png'), Buffer.from(match[2], 'base64'));
  }
  const match = output.match(/^RESULT (.+)$/m);
  if (exit !== 0 || !match) { console.error(output.replace(/^CAPTURE .+$/gm, '')); process.exitCode = 1; }
  else console.log(match[1]);
  if (exit === 0 && match) await writeFile(path.join(evidence, 'browser-result.json'), match[1] + '\n');
}
