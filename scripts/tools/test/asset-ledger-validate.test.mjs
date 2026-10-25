import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync, realpathSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const sha = data => createHash('sha256').update(data).digest('hex');
const schema = JSON.parse(readFileSync(join(repository, 'game/assets/ledger/schema.json')));

function fixture(t, source = true) {
  const temporary = realpathSync(tmpdir());
  const owner = realpathSync(mkdtempSync(join(temporary, 'asset-ledger-test-')));
  assert.ok(owner.startsWith(temporary + sep));
  assert.ok(!repository.startsWith(owner + sep));
  const root = join(owner, 'repo');
  const bounded = name => {
    const result = resolve(owner, name);
    assert.ok(result.startsWith(owner + sep), `mutation escapes owned fixture: ${name}`);
    return result;
  };
  const put = (name, data) => {
    const path = bounded(name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
    return path;
  };
  mkdirSync(join(root, 'scripts/tools'), { recursive: true });
  cpSync(join(repository, 'scripts/tools/asset-ledger-validate.mjs'), bounded('repo/scripts/tools/asset-ledger-validate.mjs'));
  cpSync(join(repository, 'game/assets/ledger'), bounded('repo/game/assets/ledger'), { recursive: true });
  cpSync(join(repository, 'engine/ASSET-LICENSE.md'), put('repo/engine/ASSET-LICENSE.md', ''));
  put('sibling-sentinel', 'preserve');
  const entry = Object.fromEntries(Object.keys(schema.properties.assets.items.properties).map(key =>
    [key, schema.properties.assets.items.properties[key].type === 'boolean' ? true : 'fixture']));
  Object.assign(entry, {
    asset_id: 'fixture-tile', title: 'Test tile', author_or_seller: 'Fixture artist', source_store: 'fixture',
    asset_page_url: 'https://example.test/tile', acquired_at: '2026-10-24', reviewed_at: '2026-10-24',
    license_name_version: 'CC-BY-4.0', license_url: 'https://creativecommons.org/licenses/by/4.0/legalcode',
    source_filename: 'game/assets/tile.png', source_hash: sha('source pixels'),
    derived_filename: '', derived_hash: '', derivation_notes: '', review_status: 'approved', usage: 'repository',
  });
  entry.license_snapshot_or_hash = `sha256:${sha(readFileSync(join(root, 'game/assets/ledger/licenses/CC-BY-4.0.txt')))}`;
  entry.attribution_text = `${entry.author_or_seller}; ${entry.asset_page_url}; ${entry.license_url}`;
  entry.proof_id = 'fixture-proof';
  const map = { schema_version: 1, root: owner, receipts: { 'fixture-proof': 'receipt.json' }, sources: {} };
  if (source) put('repo/game/assets/tile.png', 'source pixels');
  const proof = () => put('receipt.json', JSON.stringify({ ...entry, paid: false }));
  const run = (raw, receiptRaw, mode = 'cli') => {
    proof();
    if (receiptRaw !== undefined) put('receipt.json', receiptRaw);
    put('repo/game/assets/ledger/ledger.json', raw ?? JSON.stringify({ schema_version: 2, assets: [entry] }));
    const mapPath = put('proof-map.json', JSON.stringify(map));
    const args = ['scripts/tools/asset-ledger-validate.mjs', '--ledger', 'game/assets/ledger/ledger.json'];
    if (mode === 'cli') args.push('--proof-map', mapPath);
    return spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', env: { ...process.env, ASSET_PROOF_MAP: mode === 'env' ? mapPath : '' } });
  };
  t.after(() => {
    assert.equal(readFileSync(join(owner, 'sibling-sentinel'), 'utf8'), 'preserve');
    assert.equal(realpathSync(owner), owner);
    assert.ok(owner.startsWith(temporary + sep) && owner !== temporary);
    rmSync(owner, { recursive: true });
  });
  return { root, owner, entry, map, put, run };
}
function rejected(result, reason) {
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, reason);
  assert.doesNotMatch(result.stdout, /valid:/);
}

test('valid nonempty source-only admission checks real bytes', t => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /valid: 1 entries/);
  assert.ok(result.stdout.includes(join(f.root, 'game/assets')));
});
test('derived asset uses its own hash, not the source hash', t => {
  const f = fixture(t);
  f.entry.derived_filename = 'game/assets/derived.png';
  f.entry.derived_hash = sha('derived pixels');
  f.entry.derivation_notes = 'Recolored; original credit retained';
  f.put('repo/game/assets/derived.png', 'derived pixels');
  assert.equal(f.run().status, 0);
  f.entry.derived_hash = f.entry.source_hash;
  rejected(f.run(), /derived_hash mismatch/);
});
for (const key of ['commercial_game_allowed', 'editing_allowed', 'public_repo_original_allowed', 'game_build_redistribution_allowed']) {
  test(`explicit permission denial: ${key}`, t => {
    const f = fixture(t);
    f.entry[key] = false;
    rejected(f.run(), /permission denied/);
  });
}
test('derived repository permission denial', t => {
  const f = fixture(t);
  Object.assign(f.entry, { derived_filename: 'game/assets/derived.png', derived_hash: sha('derived'), public_repo_derivative_allowed: false });
  f.put('repo/game/assets/derived.png', 'derived');
  rejected(f.run(), /permission denied/);
});
test('stale_state: same CLI observes tampered source then restored bytes', t => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  f.put('repo/game/assets/tile.png', 'tampered');
  rejected(f.run(), /source_hash mismatch/);
  f.put('repo/game/assets/tile.png', 'source pixels');
  assert.equal(f.run().status, 0);
});
for (const name of ['extra.png', 'extra.json', 'ledger-hidden/extra.png', 'ledger/extra.png']) {
  test(`unregistered file cannot hide: ${name}`, t => {
    const f = fixture(t);
    f.put(`repo/game/assets/${name}`, 'unregistered');
    rejected(f.run(), /unregistered asset/);
  });
}
test('malformed_input: invalid JSON and field types fail without success output', t => {
  const f = fixture(t);
  rejected(f.run('{'), /rejected/);
  const badEntry = { ...f.entry }; delete badEntry.asset_id;
  rejected(f.run(JSON.stringify({ schema_version: 2, assets: [badEntry] })), /missing asset_id/);
  rejected(f.run(JSON.stringify({ schema_version: 2, assets: null })), /malformed ledger/);
});
test('misleading_success_output: denial with missing source never prints success', t => {
  const f = fixture(t);
  f.entry.commercial_game_allowed = false;
  f.entry.source_filename = 'game/assets/missing.png';
  f.entry.source_hash = 'wrong';
  rejected(f.run(), /permission denied/);
});
test('missing source cannot be registered', t => {
  const f = fixture(t);
  f.entry.source_filename = 'game/assets/missing.png';
  rejected(f.run(), /ENOENT/);
});
test('KADOKAWA RTP rejected regardless of permission assertions', t => {
  const f = fixture(t);
  f.entry.asset_id = 'KADOKAWA-RTP-VX-Ace';
  rejected(f.run(), /RTP forbidden/);
});
for (const origin of ['fixture', 'easyrpg', 'joseon']) {
  test(`attribution required for ${origin}`, t => {
    const f = fixture(t);
    f.entry.source_store = origin;
    f.entry.attribution_text = '';
    rejected(f.run(), /attribution/);
  });
}
test('CC-BY-SA requires sharealike flag', t => {
  const f = fixture(t);
  f.entry.license_name_version = 'CC-BY-SA-4.0';
  f.entry.license_url = 'https://creativecommons.org/licenses/by-sa/4.0/legalcode';
  f.entry.license_snapshot_or_hash = `sha256:${sha(readFileSync(join(f.root, 'game/assets/ledger/licenses/CC-BY-SA-4.0.txt')))}`;
  f.entry.attribution_text = `${f.entry.author_or_seller}; ${f.entry.asset_page_url}; ${f.entry.license_url}`;
  f.entry.sharealike_obligation = false;
  rejected(f.run(), /sharealike/);
});
for (const license of ['', 'CC-BY-NC-4.0', 'CC-BY-ND-4.0', 'itch.io terms', 'custom unrestricted']) {
  test(`unsupported permissions rejected: ${license || 'missing license'}`, t => {
    const f = fixture(t);
    f.entry.license_name_version = license;
    rejected(f.run(), /license_name_version|unsupported license/);
  });
}
test('license notice tampering rejected despite matching self-declared hash', t => {
  const f = fixture(t);
  f.put('repo/game/assets/ledger/licenses/CC-BY-4.0.txt', 'Permission is denied.');
  f.entry.license_snapshot_or_hash = `sha256:${sha('Permission is denied.')}`;
  rejected(f.run(), /license snapshot tampered/);
});
test('acquisition evidence cannot live inside repository or be assertion-only prose', t => {
  const f = fixture(t);
  f.map.receipts['fixture-proof'] = 'repo/proof.json';
  f.put('repo/proof.json', '{}');
  rejected(f.run(), /outside repository/);
  f.map.receipts['fixture-proof'] = 'missing-proof.json';
  rejected(f.run(), /unreadable/);
  f.map.receipts['fixture-proof'] = 'receipt.json';
  rejected(f.run(undefined, 'I assert permission'), /rejected/);
  rejected(f.run(undefined, JSON.stringify({ ...f.entry, source_hash: 'fabricated', paid: false })), /proof mismatch/);
});
test('paid source remains outside repository while permitted derivative is admitted', t => {
  const f = fixture(t, false);
  f.put('private/source.png', 'source pixels');
  f.entry.source_filename = 'external:paid-source';
  f.map.sources['paid-source'] = 'private/source.png';
  f.entry.public_repo_original_allowed = false;
  f.entry.derived_filename = 'game/assets/derived.png';
  f.entry.derived_hash = sha('derived pixels');
  f.entry.derivation_notes = 'Recolored';
  f.put('repo/game/assets/derived.png', 'derived pixels');
  assert.equal(f.run(undefined, JSON.stringify({ ...f.entry, paid: true })).status, 0);
  f.entry.source_filename = 'game/assets/derived.png';
  delete f.map.sources['paid-source'];
  rejected(f.run(undefined, JSON.stringify({ ...f.entry, paid: true })), /paid originals/);
});
test('CC0 source admitted under reviewed public domain dedication', t => {
  const f = fixture(t);
  f.entry.license_name_version = 'CC0-1.0';
  f.entry.license_url = 'https://creativecommons.org/publicdomain/zero/1.0/legalcode';
  f.entry.license_snapshot_or_hash = `sha256:${sha(readFileSync(join(f.root, 'game/assets/ledger/licenses/CC0-1.0.txt')))}`;
  f.entry.attribution_text = '';
  assert.equal(f.run().status, 0);
});
test('path traversal and duplicate IDs rejected', t => {
  const f = fixture(t);
  f.entry.source_filename = '../sibling-sentinel';
  rejected(f.run(), /path escapes root/);
  rejected(f.run(JSON.stringify({ schema_version: 2, assets: [f.entry, f.entry] })), /duplicate asset_id/);
});
test('bundle admitted only as engine reference; derived commit rejected', t => {
  const f = fixture(t, false);
  Object.assign(f.entry, { source_store: 'oprn-bundle', usage: 'engine-reference(game-use)',
    license_name_version: 'OPRN-GAME-1.0', license_url: 'engine/ASSET-LICENSE.md',
    public_repo_original_allowed: false, public_repo_derivative_allowed: false,
    source_filename: 'engine/public/assets/tile.png' });
  f.entry.license_snapshot_or_hash = `sha256:${sha(readFileSync(join(f.root, 'engine/ASSET-LICENSE.md')))}`;
  f.put('repo/engine/public/assets/tile.png', 'source pixels');
  assert.equal(f.run().status, 0);
  f.entry.derived_filename = 'game/assets/tile.png';
  f.entry.derived_hash = f.entry.source_hash;
  f.entry.derivation_notes = 'Permission asserted in prose';
  rejected(f.run(), /repository derivatives forbidden/);
});
test('symlink asset cannot escape scan', t => {
  const f = fixture(t);
  symlinkSync(join(f.owner, 'sibling-sentinel'), join(f.root, 'game/assets/link.png'));
  rejected(f.run(), /symlink forbidden/);
});
test('dirty_worktree: unrelated sibling content is preserved by passing and failing validation', t => {
  const f = fixture(t);
  f.put('repo/unrelated-dirty.txt', 'user edits');
  assert.equal(f.run().status, 0);
  f.entry.commercial_game_allowed = false;
  rejected(f.run(), /permission denied/);
  assert.equal(readFileSync(join(f.root, 'unrelated-dirty.txt'), 'utf8'), 'user edits');
});

test('explicit map CLI and environment work; missing proof fails closed', t => {
  const f = fixture(t);
  assert.equal(f.run(undefined, undefined, 'env').status, 0);
  rejected(f.run(undefined, undefined, 'none'), /missing external proof map/);
  delete f.map.receipts['fixture-proof'];
  rejected(f.run(), /missing external receipt/);
});
for (const id of ['../receipt', '/private/receipt', 'https://example.test/proof', 'a'.repeat(97), '__proto__']) {
  test('invalid or unregistered proof ID rejected: ' + id, t => {
    const f = fixture(t);
    f.entry.proof_id = id;
    f.map.receipts = {};
    rejected(f.run(), /invalid proof_id|missing external receipt/);
  });
}
test('unknown map ID cannot be smuggled alongside valid evidence', t => {
  const f = fixture(t);
  f.map.receipts.extra = 'receipt.json';
  rejected(f.run(), /unknown proof map ID/);
});
for (const name of ['../sibling-sentinel', 'nested/../../receipt.json', '/private/receipt.json', 'https://example.test/receipt.json']) {
  test('external receipt mapping rejects path escape: ' + name, t => {
    const f = fixture(t);
    f.map.receipts['fixture-proof'] = name;
    rejected(f.run(), /contained relative paths/);
    assert.ok(!f.run().stderr.includes(f.owner));
  });
}
test('escaping directory symlink and repository symlink target are rejected', t => {
  const f = fixture(t);
  f.put('bounded/keep', 'owned');
  symlinkSync(f.owner, join(f.owner, 'bounded/escape'));
  f.map.root = join(f.owner, 'bounded');
  f.map.receipts['fixture-proof'] = 'escape/receipt.json';
  rejected(f.run(), /escapes root/);
  f.map.root = f.owner;
  f.put('repo/proof.json', '{}');
  symlinkSync(join(f.root, 'proof.json'), join(f.owner, 'linked.json'));
  f.map.receipts['fixture-proof'] = 'linked.json';
  rejected(f.run(), /not a regular file/);
});
test('public URLs and old absolute proof paths cannot replace a receipt', t => {
  const f = fixture(t);
  f.entry.proof_location = 'https://example.test/license';
  rejected(f.run(), /unknown field proof_location/);
  delete f.entry.proof_location;
  rejected(f.run(undefined, JSON.stringify({ ...f.entry, license_name_version: 'CC-BY-NC-4.0', paid: false })), /proof mismatch/);
  rejected(f.run(undefined, JSON.stringify({ ...f.entry, paid: 'true' })), /paid acquisition/);
});
test('external source missing, hash mismatch, and absolute ledger path fail closed', t => {
  const f = fixture(t, false);
  f.entry.source_filename = 'external:source';
  rejected(f.run(), /missing external source/);
  f.map.sources.source = 'source.bin';
  f.put('source.bin', 'wrong bytes');
  rejected(f.run(), /source_hash mismatch/);
  f.entry.source_filename = join(f.owner, 'source.bin');
  f.map.sources = {};
  rejected(f.run(), /repository relative/);
});
