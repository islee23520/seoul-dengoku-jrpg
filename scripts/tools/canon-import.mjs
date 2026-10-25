#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const defaultSource = resolve(homedir(), 'workspace/seoul-dengoku-wiki');
export const hash = value => createHash('sha256').update(value).digest('hex');
export const encode = value => JSON.stringify(value, null, 2) + '\n';
export function options(args, allowed) {
  const result = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!allowed.includes(key) || Object.hasOwn(result, key) || !args[i + 1] || args[i + 1].startsWith('--')) {
      throw new Error('Unsupported, duplicate or missing option: ' + key);
    }
    result[key] = args[i + 1];
  }
  return result;
}
export function safeSlug(slug) {
  if (typeof slug !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(slug) || slug.toLowerCase() === 'canon-manifest') {
    throw new Error('Unsafe slug/path traversal: ' + slug);
  }
  return slug;
}
export function regular(path) {
  if (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink()) throw new Error('Expected regular file: ' + path);
}
export function directory(path) {
  if (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) throw new Error('Expected real directory: ' + path);
}
function cli(source, command, ...args) {
  return JSON.parse(execFileSync(process.execPath, [resolve(source, 'scripts/cast-sqlite/document-cli.mjs'), command,
    '--db', resolve(source, 'data/canonical/wiki-cast.sqlite'), '--corpus', 'current', ...args],
  { cwd: source, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
}
export function snapshot(source, id = null) {
  if (id !== null && !/^(DOC:)?[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)) throw new Error('Unsafe id/path traversal');
  const list = cli(source, 'list');
  if (!Array.isArray(list) || !list.length) throw new Error('Empty or invalid source inventory');
  let selected = list.filter(row => row.status === 'approved' && !row.excluded && row.corpus_kind === 'current');
  if (id !== null) {
    selected = selected.filter(row => row.document_id === id || row.document_id === 'DOC:' + id || row.slug === id);
    if (selected.length !== 1) throw new Error('ID is ambiguous, not approved or not found: ' + id);
  }
  if (!selected.length) throw new Error('No approved documents');
  const slugs = new Set(), identities = new Set();
  const documents = selected.map(row => {
    safeSlug(row.slug);
    const identity = row.domain + '/' + row.document_id;
    if (typeof row.document_id !== 'string' || !row.document_id || !row.domain || !/^[a-f0-9]{64}$/.test(row.sha256)
      || typeof row.revision !== 'string' || !row.revision || identities.has(identity) || slugs.has(row.slug.toLowerCase())) {
      throw new Error('Invalid or duplicate source identity/revision/hash: ' + identity);
    }
    identities.add(identity); slugs.add(row.slug.toLowerCase());
    const read = cli(source, 'read', '--id', row.document_id, '--domain', row.domain);
    const doc = read.document;
    if (read.revision !== row.revision || doc?.id !== row.document_id || doc.domain !== row.domain
      || doc.slug !== row.slug || doc.status !== 'approved') throw new Error('Source changed or read identity/status mismatch: ' + identity);
    const bytes = encode(doc);
    return { bytes, entry: { document_id: row.document_id, domain: row.domain, slug: row.slug, status: row.status,
      revision: row.revision, source_sha256: row.sha256, sha256: hash(bytes) } };
  });
  if (JSON.stringify(cli(source, 'list')) !== JSON.stringify(list)) throw new Error('Source inventory changed during read');
  return documents;
}
export function importCanon({ source = defaultSource, output = 'game/data/canon', id = null } = {}) {
  source = resolve(source); output = resolve(output);
  const documents = snapshot(source, id);
  const manifest = { manifest_version: 1, source_corpus: 'current', selection: id,
    imported_count: documents.length, entries: documents.map(doc => doc.entry) };
  const names = new Set(['.gitkeep', 'canon-manifest.json', ...documents.map(doc => doc.entry.slug + '.json')]);
  if (existsSync(output)) {
    directory(output);
    for (const name of readdirSync(output)) {
      if (!names.has(name)) throw new Error('Unexpected output file; refusing to overwrite corpus: ' + name);
      regular(resolve(output, name));
    }
  }
  mkdirSync(output, { recursive: true });
  for (const doc of documents) writeFileSync(resolve(output, doc.entry.slug + '.json'), doc.bytes);
  writeFileSync(resolve(output, 'canon-manifest.json'), encode(manifest));
  return manifest;
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const opts = options(process.argv.slice(2), ['--source', '--output', '--id']);
    const manifest = importCanon({ source: opts['--source'], output: opts['--output'], id: opts['--id'] ?? null });
    console.log('Imported ' + manifest.imported_count + ' approved current documents');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
