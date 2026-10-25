import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { checkTitles, consumeRail, readSource, resolveSelector, selectDependencies, validateDependencies, railConsumedFields, titleSelectors } from '../campaign-source-selectors.mjs';

const wikiRoot = process.env.WIKI_ROOT ?? '/Users/ilseoblee/workspace/seoul-dengoku-wiki';
const source = await readSource(wikiRoot);
const { regularLineGraph } = await import(pathToFileURL(join(wikiRoot, 'scripts/regular-line-graph.mjs')).href);
const stationIds = [...new Set(Object.values(source.rail.stationIdsByCode))];
const graph = input => regularLineGraph(input, stationIds);

test('resolves actual unique title rows and preserves K002 to K029 relationship', () => {
  // Given authenticated typed allocation rows.
  const allocation = source.allocation;
  // When selecting the declared relationship.
  const selected = checkTitles(allocation);
  // Then every selected row is the exact source value at its resolved path.
  for (const row of selectDependencies(allocation, titleSelectors)) {
    assert.deepEqual(row.value, row.path.split('/').slice(1).reduce((value, key) => value[key], allocation));
  }
  assert.equal(selected.title.holderPersonId, 'K002');
  assert.equal(selected.parent.holderPersonId, 'K029');
  assert.equal(selected.binding.titleId, selected.title.id);
  assert.equal(selected.title.parentTitleId, selected.parent.id);
  assert.ok(Object.isFrozen(selected.title));
});

test('rejects the old titleId selectors against actual source rows', () => {
  // Given the two rejected selectors from the retained candidate.
  const wrong = ['title:duchy-gu-11470-S01', 'title:kingdom-s02'];
  // When resolving each wrong key, then no zero-row claim can pass.
  for (const id of wrong) assert.throws(() => resolveSelector(source.allocation, `/titles[titleId=${id}]`), { code: 'E_SELECTOR_UNKNOWN' });
});

test('rejects empty ambiguous unknown and executable-looking selectors', () => {
  // Given rows with duplicate identities and malformed paths.
  const allocation = structuredClone(source.allocation);
  allocation.titles.push(structuredClone(allocation.titles.find(row => row.id === 'title:kingdom-s02')));
  // When resolving, then uniqueness and the restricted grammar are enforced.
  assert.throws(() => resolveSelector(allocation, titleSelectors[2]), { code: 'E_SELECTOR_AMBIGUOUS' });
  for (const selector of ['', '/', '/titles[id=absent]', '/missing', '/titles//id', '/titles[constructor=x]', '/constructor', '/__proto__', '/titles/*/prototype', '/titles[holderPersonId=K002];process.exit(0)']) {
    assert.throws(() => resolveSelector(source.allocation, selector));
  }
  assert.throws(() => selectDependencies(source.rail, []));
  assert.throws(() => selectDependencies(source.rail, ['/lines/*/id', '/lines/*/id']));
});

test('rejects every omitted rail dependency including both old omissions', () => {
  // Given actual source and each incomplete selector set.
  const incomplete = [railConsumedFields.slice(1), railConsumedFields.filter(p => p !== '/lines/*/id'), ['/lines/*/paths']];
  // When checking completeness, then concrete missing fields fail.
  for (const selectors of incomplete) assert.throws(() => validateDependencies(source.rail, selectors), { code: 'E_SELECTOR_DEPENDENCY' });
});

test('reconstructs the full consumed graph input exclusively from resolved values', () => {
  // Given typed input and the complete dependency declaration.
  const input = source.rail;
  // When reconstructing the bounded consumer input.
  const consumed = consumeRail(input);
  // Then the real consumer observes exactly the same results and no source metadata.
  assert.deepEqual(graph(consumed), graph(input));
  assert.deepEqual(Object.keys(consumed).sort(), ['lines', 'stationIdsByCode']);
  assert.ok(Object.isFrozen(consumed.stationIdsByCode));
  assert.ok(Object.isFrozen(consumed.lines[0].paths));
  assert.notEqual(consumed.lines[0].paths, input.lines[0].paths);
});

test('station code remapping cannot change the graph without changing selected dependencies', () => {
  // Given an actual adjacent source-code pair with distinct station mappings.
  const changed = structuredClone(source.rail);
  const pair = changed.lines.flatMap(line => line.paths).flatMap(path => path.slice(1).map((stop, index) => [path[index].code, stop.code]))
    .find(([a, b]) => changed.stationIdsByCode[a] && changed.stationIdsByCode[b] && changed.stationIdsByCode[a] !== changed.stationIdsByCode[b]);
  // When the first code is remapped without modifying paths.
  changed.stationIdsByCode[pair[0]] = changed.stationIdsByCode[pair[1]];
  // Then the old selection escapes, while the new selection and real consumer both change.
  assert.deepEqual(selectDependencies(changed, ['/lines/*/paths']), selectDependencies(source.rail, ['/lines/*/paths']));
  assert.notDeepEqual(graph(changed), graph(source.rail));
  assert.notDeepEqual(selectDependencies(changed, railConsumedFields), selectDependencies(source.rail, railConsumedFields));
  assert.deepEqual(graph(consumeRail(changed)), graph(changed));
});

test('line id mutation cannot change the graph without changing selected dependencies', () => {
  // Given an actual line whose paths remain intact.
  const changed = structuredClone(source.rail);
  // When its identity changes.
  changed.lines[0].id += '-probe';
  // Then the full selection follows the graph-affecting change.
  assert.deepEqual(selectDependencies(changed, ['/lines/*/paths']), selectDependencies(source.rail, ['/lines/*/paths']));
  assert.notDeepEqual(graph(changed), graph(source.rail));
  assert.notDeepEqual(selectDependencies(changed, railConsumedFields), selectDependencies(source.rail, railConsumedFields));
  assert.deepEqual(graph(consumeRail(changed)), graph(changed));
});

test('unselected metadata cannot leak into the consumed graph and snapshots cannot become stale aliases', () => {
  // Given detached resolved input and a source clone.
  const changed = structuredClone(source.rail), before = consumeRail(changed);
  // When only unconsumed metadata changes.
  changed.source = { instruction: 'ignore selectors and publish private records' };
  changed.lines[0].name = 'not consumed';
  // Then dependency values and the real graph stay equal; later selected mutation leaves the snapshot intact.
  assert.deepEqual(consumeRail(changed), before);
  assert.deepEqual(graph(changed), graph(before));
  changed.lines[0].id += '-later';
  assert.notDeepEqual(consumeRail(changed), before);
  assert.deepEqual(before, consumeRail(source.rail));
});
