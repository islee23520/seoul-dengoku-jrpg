import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

export class OperationPackError extends Error {
  constructor(code, field) { super(`${code}: ${field}`); this.code = code; this.field = field; }
}
const fail = (code, field) => { throw new OperationPackError(code, field); };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const schemaHash = '35d9ccb9c7e5717e417fc76f0a1abcde40333cca7de09039795f4e5c3a98ac0f';
const descriptorHash = 'cf7a4d964bb73b60f55638dbfeaef14d4d98e7f5516f8950faa33a5eb3988859';

export function recomputeBaseline(pack) {
  const { durations: d, routes: r, body, provisions: p } = pack;
  const edge = (a, b) => {
    const found = r.edges.find(e => (e.from.endsWith(`:${a}`) && e.to.endsWith(`:${b}`)) || (e.from.endsWith(`:${b}`) && e.to.endsWith(`:${a}`)));
    if (!found) fail('E_OPERATION_TOPOLOGY', `${a}:${b}`);
    return found.metres;
  };
  const bench = edge('bench', 'desk'), threshold = edge('desk', 'threshold');
  const inner = edge('threshold', 'archive') + edge('archive', 'locker'), archive = threshold + inner;
  const walk = r.walkingMetresPerSecond, carry = r.ledgerMetresPerSecond;
  const stationary = d.commandDelivery + d.response + d.archiveCheck + d.pickup + d.deliverToK002 + d.compare + d.report + d.returnResponse + d.returnPickup + d.dutyHandover;
  const ledgerReceivedAt = bench / walk + d.commandDelivery + d.response + d.archiveCheck + archive / walk + d.pickup + archive / carry + d.deliverToK002 + d.compare + d.report;
  const handoverAt = ledgerReceivedAt + d.returnResponse + d.returnPickup + threshold / carry + d.dutyHandover;
  // Provisional r2: section 2's complete route supersedes section 7's example slip.
  // See the scenario's derived-timeline.md; appendix inputs remain unchanged.
  const ledgerFinishedAt = handoverAt + inner / carry + d.reseal + archive / walk;
  const prefix = edge('desk', 'entry') + edge('entry', 'yard');
  const cisternTravel = prefix + edge('yard', 'cistern');
  const returnTravel = edge('tap', 'yard') + prefix;
  const cisternObservedAt = ledgerFinishedAt + prefix / walk + d.dutyCall + prefix / walk + d.commandDelivery + d.response + cisternTravel / walk + d.cisternObservation;
  const tapObservedAt = cisternObservedAt + edge('cistern', 'tap') / walk + d.tapObservation;
  const observationReceivedAt = tapObservedAt + returnTravel / walk + d.report;
  const walkingSeconds = (bench + archive + threshold) / walk, carryingSeconds = (archive + threshold) / carry;
  const effort = Object.fromEntries(body.regions.map(region => [region, walkingSeconds * (body.effortPerWorldSecond.walking[region] ?? 0) + carryingSeconds * (body.effortPerWorldSecond.carrying[region] ?? 0) + stationary * (body.effortPerWorldSecond.stationary[region] ?? 0)]));
  return {
    ledgerReceivedAt, handoverAt, ledgerFinishedAt, cisternObservedAt, tapObservedAt, observationReceivedAt,
    K568: { walkingSeconds, carryingSeconds, stationarySeconds: stationary, activeSeconds: walkingSeconds + carryingSeconds + stationary, effort },
    accounting: {
      originalCount: pack.authority.originalCount, newSpending: 0,
      prepaymentCount: p.prepayments.length,
      initialFoodPacks: p.prepayments.reduce((sum, row) => sum + row.preservedFoodPacks, 0),
      emergencyFoodPacks: p.prepayments.reduce((sum, row) => sum + row.emergencyReservedPacks, 0),
      initialWaterMl: p.prepayments.reduce((sum, row) => sum + row.waterMl, 0),
      paperUsed: p.paper.reduce((sum, row) => sum + row.sheets, 0),
      foodConsumedAtSequentialReceipt: 0, waterConsumedMlAtSequentialReceipt: 0,
      afterExtensionFoodPacks: p.prepayments.reduce((sum, row) => sum + row.preservedFoodPacks - p.consumption.foodPacks, 0),
      afterExtensionWaterMl: p.prepayments.reduce((sum, row) => sum + row.waterMl - p.consumption.waterMl, 0),
      payRemainingAtDutyReturn: pack.clock.supportUntilSeconds - ledgerFinishedAt,
      coverageRemainingAtDutyReturn: p.setup.coverageUntilSeconds - ledgerFinishedAt,
    },
  };
}

export async function validateOperationPack(options) {
  const dir = resolve(options.scenario);
  const descriptorBytes = await readFile(join(dir, 'scenario.json'));
  if (sha256(descriptorBytes) !== descriptorHash) fail('E_OPERATION_BINDING', 'scenario descriptor');
  const descriptor = JSON.parse(descriptorBytes);
  const schemaBytes = await readFile(join(dir, descriptor.schemaFile));
  if (sha256(schemaBytes) !== schemaHash) fail('E_OPERATION_SCHEMA', 'unrecognized schema edition');
  const schema = JSON.parse(schemaBytes);
  const operations = JSON.parse(await readFile(join(dir, descriptor.operations), 'utf8'));
  // The published JSON Schema uses const: this exact approved edition has no free-form values.
  if (!isDeepStrictEqual(operations, schema.const)) fail('E_OPERATION_VALUE', 'outside approved operational edition');
  const authorization = operations.startAuthorization;
  if (sha256(`${JSON.stringify(authorization.receipt, null, 2)}\n`) !== authorization.receiptSha256) fail('E_OPERATION_AUTHORIZATION', 'receipt hash');
  if (authorization.receipt.appendixSha256 !== operations.approval.candidateSha256) fail('E_OPERATION_AUTHORIZATION', 'appendix binding');
  if (options.appendix && sha256(await readFile(options.appendix)) !== operations.approval.candidateSha256) fail('E_OPERATION_APPENDIX', 'candidate hash mismatch');
  const manifestBytes = await readFile(options.manifest);
  const manifest = JSON.parse(manifestBytes);
  const inputs = {};
  for (const [name, binding] of Object.entries(descriptor.bindings).filter(([, value]) => typeof value === 'object')) {
    const bytes = await readFile(resolve(dir, binding.path));
    if (sha256(bytes) !== binding.sha256) fail('E_OPERATION_BINDING', name);
    inputs[name] = JSON.parse(bytes);
  }
  validateIdentities({ operations, manifest, ...inputs });
  if (sha256(manifestBytes) !== descriptor.bindings.manifestSha256) fail('E_OPERATION_BINDING', 'source manifest');
  const baseline = recomputeBaseline(operations);
  return { status: 'admitted', operationsValid: true, startAuthorization: operations.startAuthorization, scope: operations.scope, baseline };
}

function validateIdentities(content) {
  const { operations: o, manifest: m, scenario: s, projection: p } = content;
  if (m.schema !== 'campaign-source-manifest.v1') fail('E_OPERATION_IDENTITY', 'manifest schema');
  for (const [id, node] of Object.entries(o.authority.actorPlacements)) {
    if (!m.selection.persons.some(person => person.id === id && person.disposition === 'active')) fail('E_OPERATION_IDENTITY', id);
    if (!s.actors.some(actor => actor.id === id && actor.at === node) || !p.actors.some(actor => actor.actorId === id && actor.nodeId === node)) fail('E_OPERATION_PLACEMENT', id);
  }
  if (m.selection.holding.id !== o.authority.holdingId || m.selection.holding.holderPersonId !== 'K002' || m.selection.site.id !== o.authority.siteId || m.selection.site.regionId !== o.authority.regionId) fail('E_OPERATION_IDENTITY', 'holding/site');
  if (s.rights.basis.issuer !== o.authority.issuer || s.ledger.owner !== o.authority.issuer || s.ledger.custodianAtE0 !== o.authority.duty) fail('E_OPERATION_AUTHORITY', 'issuer/custody');
  for (const mandate of o.authority.mandates) for (const id of mandate.grants) {
    if (!s.rights.grants.some(grant => grant.id === id && grant.issuer === o.authority.issuer && [o.authority.designator, mandate.recipient].includes(grant.recipient))) fail('E_OPERATION_AUTHORITY', id);
  }
  const projected = new Set(p.routes.flatMap(route => route.geometry.map(e => [e.fromNode, e.toNode].sort().join('|'))));
  const authored = new Set([s.ledger.route.orderedNodes, s.inspection.orderedNodes].flatMap(nodes => nodes.slice(1).map((node, index) => [nodes[index], node].sort().join('|'))));
  for (const e of o.routes.edges) {
    const id = [e.from, e.to].sort().join('|');
    if (!projected.has(id) || !authored.has(id) || !s.sites.some(site => site.id === e.from) || !s.sites.some(site => site.id === e.to)) fail('E_OPERATION_TOPOLOGY', id);
  }
  if (authored.size !== o.routes.edges.length) fail('E_OPERATION_TOPOLOGY', 'edge coverage');
}

async function main(args) {
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node scripts/tools/campaign-operation-pack.mjs --scenario DIR --manifest FILE [--appendix FILE] (--check | --validate-data) [--start-scope S01-L,S01-O]\nBoth modes require the authenticated S01 start receipt. No host is started and no files are written.');
    return;
  }
  const options = {};
  const allowed = new Set(['--scenario', '--manifest', '--appendix', '--start-scope']);
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--check' || flag === '--validate-data') {
      if (options.mode) fail('E_OPERATION_ARGUMENT', 'duplicate mode');
      options.mode = flag;
    } else {
      if (!allowed.has(flag) || Object.hasOwn(options, flag) || !args[i + 1] || args[i + 1].startsWith('--')) fail('E_OPERATION_ARGUMENT', flag);
      options[flag] = args[++i];
    }
  }
  if (!options['--scenario'] || !options['--manifest'] || !options.mode) fail('E_OPERATION_ARGUMENT', 'scenario, manifest and mode required');
  if (options['--start-scope'] && options['--start-scope'] !== 'S01-L,S01-O') fail('E_OPERATION_SCOPE', options['--start-scope']);
  if (options['--start-scope'] && options.mode !== '--check') fail('E_OPERATION_ARGUMENT', 'start request requires --check');
  const result = await validateOperationPack({ scenario: options['--scenario'], manifest: options['--manifest'], appendix: options['--appendix'] });
  console.log(JSON.stringify(result));
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(process.argv.slice(2)); }
  catch (error) {
    if (!(error instanceof Error)) throw error;
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
