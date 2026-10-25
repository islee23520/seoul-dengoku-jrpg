import { readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs';
import { resolve, relative, dirname, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const schema = JSON.parse(readFileSync(resolve(ROOT, 'game/assets/ledger/schema.json'), 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const normalizedHash = text => sha(text.replace(/\r\n/g, '\n').trimEnd() + '\n');
const policies = {
  'CC0-1.0': ['https://creativecommons.org/publicdomain/zero/1.0/legalcode', 'CC0-1.0.txt'],
  'CC-BY-4.0': ['https://creativecommons.org/licenses/by/4.0/legalcode', 'CC-BY-4.0.txt'],
  'CC-BY-SA-4.0': ['https://creativecommons.org/licenses/by-sa/4.0/legalcode', 'CC-BY-SA-4.0.txt'],
  'OPRN-GAME-1.0': ['engine/ASSET-LICENSE.md', null],
};
// Hashes bind the policy to the reviewed canonical notices, not self-declared booleans.
const noticeHashes = {
  'CC0-1.0': 'a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499',
  'CC-BY-4.0': '9e5f1b3c610b9c2da5c313bf81d577a7d1acec686bdb0384edefa6df0f90cd94',
  'CC-BY-SA-4.0': '23ee78c8bae49cf08ea2f0c84945c66b987ebe4520881fb51b3dad4fb43d07c2',
  'OPRN-GAME-1.0': '30384972cf3471276b6359e36674fcc4933c95023d573d663cf88eef9e252a18',
};
const inside = (root, file) => file === root || file.startsWith(root + sep);
function fileAt(root, name) {
  const file = resolve(root, name);
  if (!inside(root, file)) throw Error(`path escapes root: ${name}`);
  const actual = realpathSync(file);
  if (!inside(root, actual) || !lstatSync(file).isFile()) throw Error(`not a regular contained file: ${name}`);
  return file;
}

const logicalId = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/;
function externalFiles(mapPath, root, ledger) {
  if (!mapPath) throw Error('missing external proof map: supply --proof-map or ASSET_PROOF_MAP');
  try {
    if (!isAbsolute(mapPath) || inside(root, resolve(mapPath)) || inside(root, realpathSync(mapPath)) || !lstatSync(mapPath).isFile()) {
      throw Error('proof map must be a regular file outside repository');
    }
    const map = JSON.parse(readFileSync(mapPath, 'utf8'));
    if (!map || map.schema_version !== 1 || typeof map.root !== 'string' || !isAbsolute(map.root) ||
        Object.keys(map).some(key => !['schema_version', 'root', 'receipts', 'sources'].includes(key))) throw Error('invalid proof map');
    const externalRoot = realpathSync(map.root);
    if (inside(root, externalRoot) || !lstatSync(externalRoot).isDirectory()) throw Error('proof root must be outside repository');
    const result = { receipts: Object.create(null), sources: Object.create(null) };
    for (const kind of ['receipts', 'sources']) {
      const expected = new Set(ledger.assets.map(entry => kind === 'receipts' ? entry?.proof_id :
        (typeof entry?.source_filename === 'string' && entry.source_filename.startsWith('external:') ? entry.source_filename.slice(9) : null)).filter(Boolean));
      const entries = map[kind];
      if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw Error('invalid proof map ' + kind);
      for (const [id, name] of Object.entries(entries)) {
        if (!logicalId.test(id) || !expected.has(id)) throw Error('unknown proof map ID');
        if (typeof name !== 'string' || !name || isAbsolute(name) || name.includes('\\') || name.split('/').some(part => !part || part === '.' || part === '..')) {
          throw Error('proof map paths must be contained relative paths');
        }
        const file = fileAt(externalRoot, name);
        if (inside(root, realpathSync(file))) throw Error('proof map file must be outside repository');
        result[kind][id] = file;
      }
    }
    return result;
  } catch (error) {
    // Never include private paths from filesystem/JSON errors in publication logs.
    if (error.code || error instanceof SyntaxError) throw Error('external proof map or mapped file unreadable');
    if (/path escapes|not a regular contained/.test(error.message)) throw Error('proof map file escapes root or is not a regular file');
    throw error;
  }
}

export function validateLedger(ledger, root = ROOT, proofMap = process.env.ASSET_PROOF_MAP) {
  root = realpathSync(root);
  const errors = [];
  const assetsRoot = resolve(root, 'game/assets');
  const registered = new Set();
  const ids = new Set();
  if (!ledger || ledger.schema_version !== 2 || !Array.isArray(ledger.assets) ||
      Object.keys(ledger).some(key => !['schema_version', 'assets'].includes(key))) {
    return ['malformed ledger: expected schema_version=2 and assets array'];
  }
  let external;
  try { external = externalFiles(proofMap, root, ledger); }
  catch (error) { return [error.message]; }
  for (const entry of ledger.assets) {
    try {
      const def = schema.properties.assets.items;
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw Error('entry must be an object');
      for (const key of def.required) {
        if (typeof entry[key] !== def.properties[key].type) throw Error(`invalid or missing ${key}`);
      }
      for (const key of Object.keys(entry)) if (!def.properties[key]) throw Error(`unknown field ${key}`);
      for (const key of ['asset_id', 'title', 'author_or_seller', 'source_store', 'asset_page_url',
        'download_url_or_order_id', 'license_name_version', 'license_url', 'license_snapshot_or_hash',
        'proof_id', 'source_filename', 'source_hash', 'tool_and_version', 'grid_and_dimensions',
        'palette_or_transparency_notes', 'engine_import_id', 'reviewer']) {
        if (!entry[key].trim()) throw Error(`empty ${key}`);
      }
      if (ids.has(entry.asset_id)) throw Error('duplicate asset_id');
      ids.add(entry.asset_id);
      if (entry.review_status !== 'approved') throw Error('review_status must be approved');
      for (const key of ['acquired_at', 'reviewed_at']) {
        if (!/^\d{4}-\d{2}-\d{2}(T.*)?$/.test(entry[key]) || !Number.isFinite(Date.parse(entry[key]))) throw Error(`invalid ${key}`);
      }
      const identity = [entry.asset_id, entry.source_store, entry.author_or_seller, entry.asset_page_url,
        entry.source_filename, entry.derived_filename, entry.engine_import_id, entry.license_name_version].join(' ');
      if (/kadokawa|enterbrain|rpg[ _-]?maker|(?:^|[ /_-])(?:rm2k3?|rm200[03]|rtp[-_ ]?(?:vx|xp|ace|mv|mz))(?:[ /_-]|$)/i.test(identity) ||
          (/\brtp\b/i.test(identity) && !/easyrpg/i.test(identity))) throw Error('proprietary RTP forbidden');
      const policy = policies[entry.license_name_version];
      if (!policy) throw Error('unsupported license permissions');
      if (entry.license_url !== policy[0]) throw Error('license_url does not match supported policy');
      const licenseFile = fileAt(root, policy[1] ? `game/assets/ledger/licenses/${policy[1]}` : policy[0]);
      const notice = readFileSync(licenseFile, 'utf8');
      if (normalizedHash(notice) !== noticeHashes[entry.license_name_version]) throw Error('license snapshot tampered');
      if (entry.license_snapshot_or_hash !== `sha256:${sha(readFileSync(licenseFile))}`) throw Error('license snapshot hash mismatch');
      if (!logicalId.test(entry.proof_id)) throw Error('invalid proof_id');
      const proof = external.receipts[entry.proof_id];
      if (!proof) throw Error('missing external receipt for proof_id');
      // Acquisition receipt binds the source bytes and the license applied by the rights holder.
      let receipt;
      try { receipt = JSON.parse(readFileSync(proof, 'utf8')); }
      catch { throw Error('external receipt unreadable or invalid JSON'); }
      for (const key of ['asset_id', 'asset_page_url', 'author_or_seller', 'license_name_version', 'source_hash']) {
        if (receipt[key] !== entry[key]) throw Error(`proof mismatch: ${key}`);
      }
      if (typeof receipt.paid !== 'boolean') throw Error('proof must declare paid acquisition');
      if (receipt.paid && !entry.source_filename.startsWith('external:')) throw Error('paid originals must stay outside repository');
      for (const key of ['commercial_game_allowed', 'editing_allowed', 'game_build_redistribution_allowed']) {
        if (entry[key] !== true) throw Error(`permission denied: ${key}`);
      }
      const bundle = /oprn|joseon|beodeul/i.test(identity) || entry.license_name_version === 'OPRN-GAME-1.0';
      if ((entry.license_name_version.startsWith('CC-BY') || /easyrpg|joseon|beodeul/i.test(identity)) &&
          (!entry.attribution_text.trim() || !entry.attribution_text.includes(entry.author_or_seller) ||
           !entry.attribution_text.includes(entry.license_url) || !entry.attribution_text.includes(entry.asset_page_url))) {
        throw Error('attribution must retain author, source and license URL');
      }
      if (entry.license_name_version === 'CC-BY-SA-4.0' && !entry.sharealike_obligation) throw Error('sharealike obligation required');
      if (bundle) {
        if (entry.usage !== 'engine-reference(game-use)' || entry.public_repo_original_allowed ||
            entry.public_repo_derivative_allowed || entry.derived_filename || entry.derived_hash ||
            !entry.source_filename.startsWith('engine/public/assets/')) throw Error('bundle requires engine-reference(game-use); repository derivatives forbidden');
      } else if (entry.usage !== 'repository') throw Error('usage must be repository');
      for (const kind of ['source', 'derived']) {
        const name = entry[`${kind}_filename`];
        const hash = entry[`${kind}_hash`];
        if (!name) {
          if (hash) throw Error(`${kind}_hash without filename`);
          continue;
        }
        let file;
        if (kind === 'source' && name.startsWith('external:')) {
          const id = name.slice(9);
          if (!logicalId.test(id)) throw Error('invalid external source ID');
          file = external.sources[id];
          if (!file) throw Error('missing external source for ID');
        } else {
          if (isAbsolute(name)) throw Error('asset paths must be repository relative or external IDs');
          file = fileAt(root, name);
          if (!bundle && !inside(assetsRoot, file)) throw Error('repository assets must be under game/assets');
          if (inside(resolve(assetsRoot, 'ledger'), file)) throw Error('asset cannot be ledger metadata');
          if (!bundle && !entry[kind === 'source' ? 'public_repo_original_allowed' : 'public_repo_derivative_allowed']) throw Error(`permission denied: public repository ${kind}`);
          if (registered.has(file)) throw Error(`duplicate asset file: ${name}`);
          registered.add(file);
        }
        if (!/^[a-f0-9]{64}$/.test(hash) || sha(readFileSync(file)) !== hash) throw Error(`${kind}_hash mismatch: ${name}`);
      }
      if (entry.derived_filename && !entry.derivation_notes.trim()) throw Error('derived asset requires change notice');
    } catch (error) { errors.push(`${entry?.asset_id ?? 'entry'}: ${error.message}`); }
  }
  const metadata = new Set(['ledger/ledger.json', 'ledger/schema.json', 'ledger/README.md',
    ...Object.values(policies).filter(p => p[1]).map(p => `ledger/licenses/${p[1]}`)]);
  function scan(dir) {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const file = resolve(dir, item.name);
      if (item.isSymbolicLink()) { errors.push(`symlink forbidden: ${relative(root, file)}`); continue; }
      if (item.isDirectory()) { scan(file); continue; }
      const name = relative(assetsRoot, file).split(sep).join('/');
      if (item.name === '.gitkeep' && lstatSync(file).size === 0) continue;
      if (!metadata.has(name) && !registered.has(file)) errors.push(`unregistered asset: ${relative(root, file)}`);
    }
  }
  try { scan(assetsRoot); } catch (error) { errors.push(`asset scan failed: ${error.message}`); }
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const opts = {};
    for (let i = 0; i < args.length; i += 2) {
      if (!['--ledger', '--proof-map'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || Object.hasOwn(opts, args[i])) {
        throw Error('usage: node scripts/tools/asset-ledger-validate.mjs --ledger <path|-> [--proof-map <external-map>]');
      }
      opts[args[i]] = args[i + 1];
    }
    if (!opts['--ledger']) throw Error('missing --ledger');
    const ledger = JSON.parse(readFileSync(opts['--ledger'] === '-' ? 0 : resolve(process.cwd(), opts['--ledger']), 'utf8'));
    const errors = validateLedger(ledger, ROOT, opts['--proof-map'] ?? process.env.ASSET_PROOF_MAP);
    if (errors.length) throw Error(errors.join('\n'));
    console.log(`Asset ledger valid: ${ledger.assets.length} entries; scanned ${resolve(ROOT, 'game/assets')}`);
  } catch (error) {
    console.error(`Asset ledger rejected: ${error.message}`);
    process.exitCode = 1;
  }
}
