#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { defaultSource, directory, hash, options, regular, safeSlug, snapshot } from './canon-import.mjs';

export function checkCanon({ source = defaultSource, manifest = 'game/data/canon/canon-manifest.json' } = {}) {
  manifest = resolve(manifest);
  const output = dirname(manifest);
  directory(output); regular(manifest);
  const value = JSON.parse(readFileSync(manifest, 'utf8'));
  if (value.manifest_version !== 1 || value.source_corpus !== 'current' || value.selection !== null
    || !Array.isArray(value.entries) || value.entries.length !== value.imported_count) throw new Error('Invalid/full-corpus manifest required');
  const names = new Set(), identities = new Set();
  for (const entry of value.entries) {
    safeSlug(entry.slug);
    const identity = entry.domain + '/' + entry.document_id;
    if (entry.status !== 'approved' || names.has(entry.slug.toLowerCase()) || identities.has(identity)) throw new Error('Non-approved or duplicate entry');
    names.add(entry.slug.toLowerCase()); identities.add(identity);
    const file = resolve(output, entry.slug + '.json');
    regular(file);
    if (hash(readFileSync(file)) !== entry.sha256) throw new Error('Output hash mismatch: ' + entry.slug);
  }
  const expectedNames = ['canon-manifest.json', ...value.entries.map(entry => entry.slug + '.json')].sort();
  const files = readdirSync(output).filter(name => name !== '.gitkeep').sort();
  if (JSON.stringify(files) !== JSON.stringify(expectedNames)) throw new Error('Output inventory mismatch');
  const live = snapshot(resolve(source));
  if (live.length !== value.imported_count) throw new Error('Stale manifest count');
  for (let i = 0; i < live.length; i++) {
    const entry = value.entries[i], expected = live[i].entry;
    if (Object.keys(entry).length !== Object.keys(expected).length || Object.keys(expected).some(key => entry[key] !== expected[key])) {
      throw new Error('Stale manifest identity/status/revision/source or output hash: ' + expected.document_id);
    }
  }
  return value;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const opts = options(process.argv.slice(2), ['--source', '--manifest']);
    const manifest = checkCanon({ source: opts['--source'], manifest: opts['--manifest'] });
    console.log('Verified ' + manifest.imported_count + ' approved documents against current source and output bytes');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
