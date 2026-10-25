import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

export const allocationPath = 'lore/relations/opening-feudal-allocation.json';
export const railPath = 'lore/places/regular-line-adjacency.json';
export const titleSelectors = Object.freeze([
  '/existingTitleBindings[holdingId=holding:yangcheon]',
  '/titles[id=title:duchy-gu-11470-S01]', '/titles[id=title:kingdom-s02]',
]);
export const railConsumedFields = Object.freeze(['/stationIdsByCode', '/lines/*/id', '/lines/*/paths']);
const prohibited = new Set(['__proto__', 'prototype', 'constructor']);
export class SelectorError extends Error {
  constructor(code, detail) { super(`${code}: ${detail}`); this.code = code; }
}
const fail = (code, detail) => { throw new SelectorError(code, detail); };
function immutable(value) {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) immutable(child);
    Object.freeze(value);
  }
  return value;
}
function leaves(value, path) {
  if (value === null || typeof value !== 'object' || Object.keys(value).length === 0) return [[path, value]];
  return Object.entries(value).flatMap(([key, child]) => {
    if (prohibited.has(key)) fail('E_SELECTOR_PATH', key);
    return leaves(child, `${path}/${key}`);
  });
}
// Only own-property segments, array wildcards and unique equality filters. No evaluation.
export function resolveSelector(source, selector) {
  if (typeof selector !== 'string' || !selector.startsWith('/') || selector.length > 512) fail('E_SELECTOR_PATH', String(selector));
  let rows = [{ path: '', value: source }];
  for (const segment of selector.slice(1).split('/')) {
    const match = /^([A-Za-z][A-Za-z0-9]*)(?:\[([A-Za-z][A-Za-z0-9]*)=([A-Za-z0-9:_-]+)\])?$/u.exec(segment);
    if (segment !== '*' && (!match || prohibited.has(segment) || prohibited.has(match[2]))) fail('E_SELECTOR_PATH', segment);
    rows = rows.flatMap(row => {
      if (segment === '*') {
        if (!Array.isArray(row.value) || !row.value.length) fail('E_SELECTOR_EMPTY', row.path);
        return row.value.map((value, index) => ({ path: `${row.path}/${index}`, value }));
      }
      const [, key, filter, wanted] = match;
      if (row.value === null || typeof row.value !== 'object' || Array.isArray(row.value) || !Object.hasOwn(row.value, key)) fail('E_SELECTOR_UNKNOWN', `${row.path}/${key}`);
      const value = row.value[key], path = `${row.path}/${key}`;
      if (!filter) return [{ path, value }];
      if (!Array.isArray(value)) fail('E_SELECTOR_PATH', path);
      const matches = value.flatMap((item, index) => {
        if (item === null || typeof item !== 'object' || !Object.hasOwn(item, filter)) fail('E_SELECTOR_UNKNOWN', `${path}/${filter}`);
        return item[filter] === wanted ? [{ path: `${path}/${index}`, value: item }] : [];
      });
      if (matches.length !== 1) fail(matches.length ? 'E_SELECTOR_AMBIGUOUS' : 'E_SELECTOR_EMPTY', segment);
      return matches;
    });
  }
  if (!rows.length) fail('E_SELECTOR_EMPTY', selector);
  return immutable(structuredClone(rows));
}
export function selectDependencies(source, selectors) {
  if (!Array.isArray(selectors) || !selectors.length || new Set(selectors).size !== selectors.length) fail('E_SELECTOR_PATH', 'nonempty unique selectors required');
  return immutable(selectors.flatMap(selector => resolveSelector(source, selector)));
}
// Compare concrete paths AND values, never output field counts or selector presence.
export function validateDependencies(source, selectors, consumedFields = railConsumedFields) {
  const selected = selectDependencies(source, selectors);
  const actual = new Map(selected.flatMap(row => leaves(row.value, row.path)));
  for (const row of selectDependencies(source, consumedFields)) {
    for (const [path, value] of leaves(row.value, row.path)) {
      if (!actual.has(path) || !isDeepStrictEqual(actual.get(path), value)) fail('E_SELECTOR_DEPENDENCY', path);
    }
  }
  return selected;
}
export function consumeRail(source, selectors = railConsumedFields) {
  const selected = validateDependencies(source, selectors);
  const values = new Map(selected.map(row => [row.path, row.value]));
  // Restrict the consumer boundary to the declared input, not the original source.
  const stationIdsByCode = values.get('/stationIdsByCode');
  const lines = source.lines.map((_, index) => ({ id: values.get(`/lines/${index}/id`), paths: values.get(`/lines/${index}/paths`) }));
  if (!stationIdsByCode || lines.some(line => !line.id || !line.paths)) fail('E_SELECTOR_DEPENDENCY', 'canonical consumed selectors required');
  return immutable(structuredClone({ stationIdsByCode, lines }));
}
export function checkTitles(source, selectors = titleSelectors) {
  const selected = validateDependencies(source, selectors, titleSelectors);
  const rows = selected.map(row => row.value);
  const binding = rows.find(row => row.holdingId === 'holding:yangcheon');
  const title = rows.find(row => row.id === 'title:duchy-gu-11470-S01');
  const parent = rows.find(row => row.id === 'title:kingdom-s02');
  if (!binding || !title || !parent || binding.titleId !== title.id || title.parentTitleId !== parent.id
    || title.holderPersonId !== 'K002' || parent.holderPersonId !== 'K029') fail('E_SELECTOR_RELATION', 'expected K002/K029 binding');
  return immutable({ binding, title, parent });
}
async function fileHash(path) {
  const hash = createHash('sha256');
  for await (const bytes of createReadStream(path)) hash.update(bytes);
  return hash.digest('hex');
}
async function storage(path) {
  if (!(await lstat(path)).isFile()) fail('E_SELECTOR_STORAGE', 'regular database required');
  for (const suffix of ['-wal', '-shm', '-journal']) {
    try { await lstat(path + suffix); }
    catch (error) { if (error instanceof Error && error.code === 'ENOENT') continue; throw error; }
    fail('E_SELECTOR_STORAGE', suffix);
  }
  const handle = await open(path, 'r');
  try {
    const bytes = Buffer.alloc(16); await handle.read(bytes, 0, 16, 0);
    if (bytes.toString() !== 'SQLite format 3\0') fail('E_SELECTOR_STORAGE', 'SQLite magic required');
  } finally { await handle.close(); }
}
export async function readSource(wikiRoot) {
  const root = await realpath(resolve(wikiRoot)), path = join(root, 'data/canonical/wiki-cast.sqlite');
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env: { ...process.env, GIT_MASTER: '1' } }).trim();
  const head = git('rev-parse', 'HEAD');
  if (git('status', '--porcelain', '--untracked-files=no')) fail('E_SELECTOR_DIRTY', 'tracked source changes');
  await storage(path);
  const before = await fileHash(path);
  const load = name => import(pathToFileURL(join(root, `scripts/cast-sqlite/${name}.mjs`)).href);
  const { openReadOnly } = await load('db');
  const { readFeudalAllocationInputs, FEUDAL_ALLOCATION_SOURCE_HASH } = await load('feudal-allocation-inputs');
  const { readRailSourceDocument, RAIL_SOURCE_HASHES } = await load('rail-source-documents');
  const db = openReadOnly(path);
  let allocation, rail;
  try {
    allocation = readFeudalAllocationInputs(db);
    rail = readRailSourceDocument(db, { logicalPath: railPath, expectedSourceHash: RAIL_SOURCE_HASHES[railPath] });
  } finally { db.close(); }
  await storage(path);
  if (await fileHash(path) !== before || git('rev-parse', 'HEAD') !== head || git('status', '--porcelain', '--untracked-files=no')) fail('E_SELECTOR_STALE', 'source changed during read');
  return immutable({ allocation, rail, provenance: { head, databaseSha256: before,
    sources: [{ path: allocationPath, sha256: FEUDAL_ALLOCATION_SOURCE_HASH }, { path: railPath, sha256: RAIL_SOURCE_HASHES[railPath] }] } });
}
async function main(args) {
  const options = new Map();
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (!['--wiki-root', '--check', '--title-selector', '--rail-selectors'].includes(key) || options.has(key)) fail('E_SELECTOR_USAGE', 'unknown or duplicate option');
    if (key === '--check') { options.set(key, true); continue; }
    const value = args[++index];
    if (!value || value.startsWith('--')) fail('E_SELECTOR_USAGE', 'missing value');
    options.set(key, value);
  }
  if (!options.has('--wiki-root') || !options.has('--check')) fail('E_SELECTOR_USAGE', '--wiki-root and --check required');
  const source = await readSource(options.get('--wiki-root'));
  const titles = checkTitles(source.allocation, options.has('--title-selector') ? [titleSelectors[0], options.get('--title-selector'), titleSelectors[2]] : titleSelectors);
  const selectors = options.has('--rail-selectors') ? options.get('--rail-selectors').split(',') : railConsumedFields;
  const input = consumeRail(source.rail, selectors);
  const { regularLineGraph } = await import(pathToFileURL(join(resolve(options.get('--wiki-root')), 'scripts/regular-line-graph.mjs')).href);
  const graph = regularLineGraph(input, [...new Set(Object.values(input.stationIdsByCode))]);
  console.log(JSON.stringify({ status: 'PASS', contract: 'campaign-source-selectors.v1', ...source.provenance,
    titles, railSelectors: selectors, dependencies: selectDependencies(source.rail, selectors).map(row => ({ path: row.path,
      sha256: createHash('sha256').update(JSON.stringify(row.value)).digest('hex') })), graphEdges: graph.edges.length, publication: false }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await main(process.argv.slice(2)); }
  catch (error) { if (!(error instanceof Error)) throw error; console.error(error.message); process.exitCode = 1; }
}
