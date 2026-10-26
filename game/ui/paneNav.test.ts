import test from 'node:test';
import assert from 'node:assert/strict';
import { mountPaneNav } from './paneNav.ts';
import type { PaneNavSnapshot } from './paneNav.ts';

/** Minimal DOM test seam: no browser package, layout engine, network, or runtime projection. */
class ElementFixture {
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  children: ElementFixture[] = [];
  parent: ElementFixture | null = null;
  scrollTop = 0;
  id = '';
  className = '';
  ariaLabel = '';
  type = '';
  textContent = '';
  isConnected = true;
  offsetParent: object | null = {};
  classList = { remove: (name: string) => { this.className = this.className.split(' ').filter(value => value !== name).join(' '); } };
  readonly ownerDocument: DocumentFixture;
  constructor(ownerDocument: DocumentFixture) { this.ownerDocument = ownerDocument; }
  append(...children: ElementFixture[]) { for (const child of children) { child.parent = this; this.children.push(child); } }
  prepend(child: ElementFixture) { child.parent = this; this.children.unshift(child); }
  remove() {
    if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null;
    if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this);
    this.isConnected = false;
  }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  hasAttribute(name: string) { return this.attributes.has(name); }
  addEventListener() {}
  focus() { this.ownerDocument.activeElement = this; }
  contains(candidate: ElementFixture): boolean { return candidate === this || this.children.some(child => child.contains(candidate)); }
  querySelectorAll<T>(selector: string): T[] {
    const descendants = this.children.flatMap(child => [child, ...child.querySelectorAll<ElementFixture>('all')]);
    return descendants.filter(child => selector === 'all' || selector.startsWith('button') || child.attributes.get('aria-pressed') === 'true' || child.attributes.get('aria-selected') === 'true' || child.className.split(' ').includes('is-selected')) as T[];
  }
  querySelector<T>(selector: string): T | null { return this.querySelectorAll<T>(selector)[0] ?? null; }
}
class DocumentFixture {
  activeElement: ElementFixture | null = null;
  frames = new Map<number, FrameRequestCallback>();
  nextFrame = 0;
  defaultView = {
    requestAnimationFrame: (callback: FrameRequestCallback) => { const id = ++this.nextFrame; this.frames.set(id, callback); return id; },
    cancelAnimationFrame: (id: number) => { this.frames.delete(id); },
  };
  createElement() { return new ElementFixture(this); }
  querySelector() { return null; }
  paint() { const frames = [...this.frames.values()]; this.frames.clear(); for (const callback of frames) callback(0); }
}
function mountFixture(doc: DocumentFixture, selectedId = 'K568', initialState?: PaneNavSnapshot) {
  const root = doc.createElement(), body = doc.createElement(), row = doc.createElement();
  row.dataset.paneId = selectedId; row.setAttribute('aria-pressed', 'true');
  body.append(row); root.append(body);
  const handle = mountPaneNav({ root: root as unknown as HTMLElement, listBody: body as unknown as HTMLElement,
    listPanes: [body as unknown as HTMLElement], detailPanes: [], labels: { list: '명단', detail: '상세' }, initialState });
  return { root, body, row, handle };
}

test('list scroll and selected identity survive detail rerender/remount, then Back restores row', () => {
  const doc = new DocumentFixture();
  const first = mountFixture(doc);
  first.body.scrollTop = 238; first.row.focus();
  first.handle.showDetail();
  const snapshot = first.handle.snapshot();
  assert.deepEqual(snapshot, { mode: 'detail', selectedId: 'K568', listScrollTop: 238, focusRef: 'pane-back' });
  first.handle.release();
  const next = mountFixture(doc, 'K568', snapshot);
  doc.paint();
  assert.equal(next.root.dataset.pane, 'detail');
  assert.equal(next.body.scrollTop, 238);
  assert.equal(doc.activeElement?.dataset.paneBack, '', 'detail Back receives focus after remount');
  assert.equal(next.handle.unwind(), true);
  assert.equal(next.body.scrollTop, 238);
  assert.equal(doc.activeElement, next.row);
  assert.equal(next.handle.unwind(), false);
});

test('a missing selected identity returns to list top without focusing a stale row', () => {
  const doc = new DocumentFixture();
  const next = mountFixture(doc, 'K616', { mode: 'detail', selectedId: 'K568', listScrollTop: 238, focusRef: 'K568' });
  doc.paint();
  assert.equal(next.root.dataset.pane, 'list');
  assert.equal(next.body.scrollTop, 0);
  assert.notEqual(doc.activeElement, next.row);
  assert.equal(doc.activeElement?.dataset.paneBack, '');
});

test('restore is deferred until paint and release cancels pending focus work', () => {
  const doc = new DocumentFixture();
  const next = mountFixture(doc);
  next.handle.restore({ mode: 'list', selectedId: 'K568', listScrollTop: 91 });
  assert.equal(next.body.scrollTop, 0);
  doc.paint();
  assert.equal(next.body.scrollTop, 91);
  assert.equal(doc.activeElement, next.row);
  next.handle.restore({ mode: 'detail', selectedId: 'K568', listScrollTop: 123 });
  next.handle.release(); doc.paint();
  assert.equal(next.body.scrollTop, 91);
});
