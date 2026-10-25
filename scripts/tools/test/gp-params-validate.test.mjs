import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { validate } from '../gp-params-validate.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const shipped = join(root, 'game/data/params/gp.proposal.json');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (path, value) => writeFileSync(path, JSON.stringify(value));
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'gp-approval-TEST-ONLY-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const proposal = join(dir, 'proposal.json');
  copyFileSync(shipped, proposal);
  const packet = JSON.parse(readFileSync(proposal));
  const manifest = JSON.parse(readFileSync(join(dirname(shipped), packet.scenarioDecisionManifest.path)));
  copyFileSync(join(dirname(shipped), packet.scenarioDecisionManifest.path), join(dir, packet.scenarioDecisionManifest.path));
  const options = { proposal, params: join(dir, 'params.json'), gddRoot: join(dir, 'gdd'), pocRoot: join(dir, 'poc'), scenarioRoot: join(dir, 'scenario') };
  for (const file of ['scenario-data.json', 'deck-v2/index.html']) {
    mkdirSync(dirname(join(options.scenarioRoot, file)), { recursive: true });
    copyFileSync(join(root, '.omo/evidence/seoul-dengoku-jrpg/task-33', file), join(options.scenarioRoot, file));
  }
  for (const source of packet.sources) {
    const destination = join(source.repo === 'gdd' ? options.gddRoot : options.pocRoot, source.path);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(homedir(), 'workspace', source.repo === 'gdd' ? 'seoul-dengoku-gdd' : 'seoul-dengoku', source.path), destination);
  }
  const proposalSha256 = hash(readFileSync(proposal));
  const decisions = Object.fromEntries(packet.decisions.map(d => [d.field, d.choices[0]]));
  const scenarioDecisions = Object.fromEntries(manifest.groups.map(group => [group.field, { value: group.choices[0], details: 'TEST-ONLY explicit fixture details; not a real owner decision' }]));
  const receipt = { schemaVersion: 1, role: 'owner', actor: 'TEST-ONLY-NOT-A-REAL-OWNER', rawResponse: 'TEST-ONLY fixture: choose ' + JSON.stringify(decisions), proposalSha256, binding: packet.binding, scenarioManifestSha256: packet.scenarioDecisionManifest.sha256, scenarioDecisions, decisions };
  const receiptPath = join(dir, 'TEST-ONLY-response.json');
  save(receiptPath, receipt);
  const approval = { by: receipt.actor, reference: 'TEST-ONLY-response.json', sha256: hash(readFileSync(receiptPath)) };
  const params = { schemaVersion: 1, status: 'approved', rulesVersion: 'SP-1.0.0', proposalSha256, binding: { ...packet.binding }, scenarioManifestSha256: packet.scenarioDecisionManifest.sha256, scenarioDecisions: Object.fromEntries(Object.entries(scenarioDecisions).map(([name, value]) => [name, { ...value, approval: { ...approval } }])), fields: Object.fromEntries(Object.entries(decisions).map(([name, value]) => [name, { value, approval: { ...approval } }])) };
  save(options.params, params);
  return { options, packet, params, receipt, receiptPath, persist() { save(options.params, params); }, updateReceipt() { save(receiptPath, receipt); for (const field of [...Object.values(params.fields), ...Object.values(params.scenarioDecisions)]) field.approval.sha256 = hash(readFileSync(receiptPath)); save(options.params, params); } };
}
function cli(options, extension = 'mjs') {
  return spawnSync(process.execPath, [join(root, 'scripts/tools/gp-params-validate.' + extension), ...Object.entries(options).flatMap(([key, value]) => [{ params: '--params', proposal: '--proposal', gddRoot: '--gdd-root', pocRoot: '--poc-root', scenarioRoot: '--scenario-root' }[key], value])], { encoding: 'utf8', cwd: tmpdir(), timeout: 10000 });
}

test('test-only complete field approvals pass library and both ordinary CLI entry points', t => {
  const f = fixture(t);
  assert.equal(validate(f.options).approvedFields, 14);
  for (const extension of ['mjs', 'js']) {
    const result = cli(f.options, extension);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /14 rule choices/);
  }
});

test('scoped owner evidence binds only two scenario policies and cannot act as a production pack', () => {
  const packet = JSON.parse(readFileSync(shipped));
  const manifestBytes = readFileSync(join(dirname(shipped), packet.scenarioDecisionManifest.path));
  const manifest = JSON.parse(manifestBytes);
  const receiptPath = join(dirname(shipped), packet.ownerDecisionReceipt);
  const receipt = JSON.parse(readFileSync(receiptPath));
  assert.equal(receipt.status, 'partial-owner-decision-evidence');
  const investigation = JSON.parse(readFileSync(join(dirname(shipped), packet.ownerInvestigationReceipt)));
  assert.equal(receipt.proposalSha256, investigation.proposalInputSha256);
  assert.equal(receipt.scenarioManifestSha256, investigation.scenarioManifestSha256);
  assert.equal(packet.scenarioDecisionManifest.sha256, hash(manifestBytes));
  assert.deepEqual(receipt.binding, packet.binding);
  assert.deepEqual(Object.keys(receipt.scenarioDecisions).sort(), ['remotePresentationAction', 'timePresentation']);
  for (const [field, choice] of Object.entries(receipt.scenarioDecisions)) {
    const group = manifest.groups.find(group => group.field === field);
    assert.equal(choice.group, group.id);
    assert.ok(group.choices.includes(choice.value));
  }
  assert.equal(receipt.scenarioDecisions.timePresentation.value, 'source-compatible-single-clock');
  assert.equal(receipt.scenarioDecisions.timePresentation.status, 'partially-decided');
  assert.ok(receipt.scenarioDecisions.timePresentation.unresolved.includes('peacetime-pause'));
  assert.ok(receipt.scenarioDecisions.timePresentation.unresolved.includes('peacetime-speed'));
  assert.equal(receipt.scenarioDecisions.remotePresentationAction.value, 'received-report-projection');
  assert.deepEqual(receipt.decisions, {});
  assert.deepEqual(receipt.unapprovedRuleFields, packet.decisions.map(decision => decision.field));
  assert.deepEqual(receipt.unapprovedScenarioFields, ['firstPlayableSlice', 'organizationTerms']);
  const result = cli({ params: receiptPath });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Pending or missing owner approval/);
});

test('canonical-location evidence selects only Q1 B scoped policies, not a production pack', () => {
  const packet = JSON.parse(readFileSync(shipped));
  const receiptPath = join(dirname(shipped), packet.ownerInvestigationReceipt);
  const receipt = JSON.parse(readFileSync(receiptPath));
  assert.equal(packet.status, 'pending');
  assert.equal(receipt.status, 'partial-owner-decision-evidence');
  assert.equal(receipt.question.id, 'Q1');
  assert.equal(receipt.question.option, 'B');
  assert.equal(receipt.scope, 'S01');
  assert.deepEqual(receipt.binding, packet.binding);
  const operations = JSON.parse(readFileSync(join(dirname(shipped), packet.ownerInvestigationRulesReceipt)));
  assert.deepEqual(receipt.decisions, { startLocationPolicy: 'canonical-only', scheduleConflictPolicy: 'reject-conflict', saveCheckpointPolicy: 'explicit-consistent-boundary' });
  assert.deepEqual(receipt.unapprovedRuleFields, packet.decisions.filter(d => !(d.field in receipt.decisions)).map(d => d.field));
  assert.deepEqual(Object.keys(receipt.scenarioDecisions).sort(), ['firstPlayableSlice', 'organizationTerms']);
  for (const [field, choice] of Object.entries(packet.scopedScenarioDecisions)) {
    assert.equal(choice.status, 'scoped-policy-decided');
    assert.equal(choice.scope, 'S01');
    assert.equal(choice.value, receipt.scenarioDecisions[field].value);
    assert.equal(choice.status, receipt.scenarioDecisions[field].status);
  }
  for (const decision of packet.decisions) {
    assert.equal(decision.status, decision.field in receipt.decisions || decision.field in operations.decisions ? 'scoped-policy-decided' : 'scoped-boundary-decided');
    if (decision.field in receipt.decisions) assert.deepEqual(decision.scopedSelection, { value: receipt.decisions[decision.field], scope: 'S01', receipt: packet.ownerInvestigationReceipt });
  }
  assert.equal(existsSync(join(root, 'game/data/params/gp.json')), false);
  const result = cli({ params: receiptPath });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Pending or missing owner approval/);
});

test('Q2 A selects only bounded investigation operation policies and preserves scenario statuses', () => {
  const packet = JSON.parse(readFileSync(shipped));
  const receiptPath = join(dirname(shipped), packet.ownerInvestigationRulesReceipt);
  const receipt = JSON.parse(readFileSync(receiptPath));
  assert.equal(receipt.status, 'partial-owner-decision-evidence');
  assert.equal(receipt.question.id, 'Q2');
  assert.equal(receipt.question.option, 'A');
  assert.equal(receipt.sourceResponse.questionId, 'investigation_operation_rules');
  assert.match(receipt.proposalInputSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(receipt.binding, packet.binding);
  assert.equal(receipt.scope, 'S01');
  assert.deepEqual(receipt.decisions, { travelCostPolicy: 'authored-edge-cost', laborDetailPolicy: 'named-roster', constructionScopePolicy: 'repair-first', cargoSplitPolicy: 'whole-consignment' });
  for (const [field, value] of Object.entries(receipt.decisions)) {
    const decision = packet.decisions.find(decision => decision.field === field);
    assert.equal(decision.status, 'scoped-policy-decided');
    assert.deepEqual(decision.scopedSelection, { value, scope: 'S01', receipt: packet.ownerInvestigationRulesReceipt });
  }
  assert.deepEqual(receipt.unapprovedRuleFields, packet.decisions.filter(decision => decision.status === 'scoped-boundary-decided').map(decision => decision.field));
  const manifest = JSON.parse(readFileSync(join(dirname(shipped), packet.scenarioDecisionManifest.path)));
  assert.equal(manifest.status, 'pending');
  for (const group of manifest.groups) {
    const prior = JSON.parse(readFileSync(join(dirname(shipped), group.scopedSelection.receipt))).scenarioDecisions[group.field];
    assert.equal(group.status, prior.status);
    assert.equal(group.scopedSelection.value, prior.value);
  }
  const result = cli({ params: receiptPath });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Pending or missing owner approval/);
});

test('Q3 A records exactly seven followup boundaries and leaves parameter approval pending', () => {
  const packet = JSON.parse(readFileSync(shipped));
  const receiptPath = join(dirname(shipped), packet.ownerFollowupBoundariesReceipt);
  const receipt = JSON.parse(readFileSync(receiptPath));
  assert.equal(receipt.status, 'partial-owner-decision-evidence');
  assert.equal(receipt.question.id, 'Q3');
  assert.equal(receipt.question.option, 'A');
  assert.equal(receipt.sourceResponse.questionId, 'followup_feature_boundaries');
  for (const sha of [receipt.sourceResponse.sha256, receipt.question.sha256, receipt.proposalInputSha256]) assert.match(sha, /^[a-f0-9]{64}$/);
  assert.equal(receipt.scope, 'followup-feature-boundaries');
  assert.deepEqual(receipt.decisions, { titleActivationPolicy: 'registered-title-contracts', overCapacityPolicy: 'offer-reorganization', successionDataPolicy: 'registered-institutions-only', educationScopePolicy: 'one-authored-skill', battleResolutionPolicy: 'shared-individual-resolver', reinforcementScopePolicy: 'authored-arrival-entry', peaceScopePolicy: 'registered-item-negotiation' });
  assert.deepEqual(packet.decisions.filter(d => d.status === 'scoped-boundary-decided').map(d => d.gp), ['GP-07', 'GP-08', 'GP-09', 'GP-10', 'GP-11', 'GP-12', 'GP-13']);
  for (const [field, value] of Object.entries(receipt.decisions)) {
    const decision = packet.decisions.find(d => d.field === field);
    assert.deepEqual(decision.scopedSelection, { value, scope: receipt.scope, receipt: packet.ownerFollowupBoundariesReceipt });
  }
  const manifest = JSON.parse(readFileSync(join(dirname(shipped), packet.scenarioDecisionManifest.path)));
  assert.equal(manifest.status, 'pending');
  assert.equal(manifest.stagedQuestions.status, 'scoped-selections-receipted');
  assert.equal(manifest.stagedQuestions.parameterStatus, 'pending-numeric-and-factual-inputs');
  for (const [id, option] of Object.entries({ Q1: 'B', Q2: 'A', Q3: 'A' })) {
    const selection = manifest.stagedQuestions.selections[id];
    const prior = JSON.parse(readFileSync(join(dirname(shipped), selection.receipt)));
    assert.equal(selection.option, option);
    assert.equal(prior.question.id, id);
    assert.equal(prior.question.option, option);
  }
  assert.deepEqual(receipt.otherUnapproved, ['all-numeric-functions', 'institutional-inputs', 'combat-renderer-adaptation', 'whole-game-approval', 'full-task26-completion']);
  const result = cli({ params: receiptPath });
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, /Pending or missing owner approval/);
});

test('real missing production pack and shipped pending packet fail both CLIs', () => {
  assert.equal(existsSync(join(root, 'game/data/params/gp.json')), false);
  for (const extension of ['mjs', 'js']) {
    for (const args of [[], ['--params', shipped]]) {
      const result = spawnSync(process.execPath, [join(root, 'scripts/tools/gp-params-validate.' + extension), ...args], { encoding: 'utf8', cwd: tmpdir(), timeout: 10000 });
      assert.equal(result.status, 1, result.stderr);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, args.length ? /Pending or missing owner approval/ : /ENOENT/);
    }
  }
});

const mutations = [
  ['missing field', f => { delete f.params.fields.startLocationPolicy; }, /missing or unsupported/],
  ['unsupported numeric field', f => { f.params.fields.damageMultiplier = { value: 1 }; }, /missing or unsupported/],
  ['unsupported choice', f => { f.params.fields.startLocationPolicy.value = 'anywhere'; }, /Unsupported value/],
  ['missing per-field approval', f => { delete f.params.fields.startLocationPolicy.approval; }, /missing or unsupported/],
  ['empty approval reference', f => { f.params.fields.startLocationPolicy.approval.reference = ''; }, /Missing approval evidence/],
  ['missing receipt', f => { f.params.fields.startLocationPolicy.approval.reference = 'absent.json'; }, /ENOENT/],
  ['stale receipt hash', f => { f.params.fields.startLocationPolicy.approval.sha256 = '0'.repeat(64); }, /Stale approval receipt/],
  ['stale proposal hash', f => { f.params.proposalSha256 = '0'.repeat(64); }, /Stale proposal approval/],
  ['pending status', f => { f.params.status = 'pending'; }, /Pending or missing/],
  ['unsupported version', f => { f.params.rulesVersion = 'SP-9'; }, /Unsupported parameter version/],
  ['top-level fake approval', f => { f.params.approvedBy = 'someone'; }, /missing or unsupported/],
  ['stale approved scenario', f => { f.params.binding.scenarioSha256 = '0'.repeat(64); }, /Stale approved scenario/],
  ['stale approved deck', f => { f.params.binding.deckSha256 = '0'.repeat(64); }, /Stale approved scenario/],
  ['stale approved revision', f => { f.params.binding.revision = 'old'; }, /Stale approved scenario/],
  ['stale approved manifest', f => { f.params.scenarioManifestSha256 = '0'.repeat(64); }, /Stale approved scenario/],
  ['missing scenario decision', f => { delete f.params.scenarioDecisions.organizationTerms; }, /missing or unsupported/],
  ['missing scenario details', f => { f.params.scenarioDecisions.firstPlayableSlice.details = ''; }, /Missing explicit scenario details/],
  ['scenario field forced into GP', f => { f.params.fields.firstPlayableSlice = f.params.scenarioDecisions.firstPlayableSlice; }, /missing or unsupported/],
];
for (const [name, mutate, expected] of mutations) test(name + ' fails library and actual CLI', t => {
  const f = fixture(t); mutate(f); f.persist();
  assert.throws(() => validate(f.options), expected);
  const result = cli(f.options);
  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stderr, expected);
});
for (const [name, mutate, expected] of [
  ['not owner', f => { f.receipt.role = 'agent'; }, /Missing owner response/],
  ['no original response', f => { f.receipt.rawResponse = ''; }, /Missing owner response/],
  ['wrong actor', f => { f.receipt.actor = 'other'; }, /Missing owner response/],
  ['receipt stale proposal', f => { f.receipt.proposalSha256 = '0'.repeat(64); }, /stale proposal/],
  ['field not approved', f => { delete f.receipt.decisions.startLocationPolicy; }, /did not approve field/],
  ['different approved value', f => { f.receipt.decisions.startLocationPolicy = f.packet.decisions[0].choices[1]; }, /did not approve field/],
  ['unsupported receipt field', f => { f.receipt.decisions.growth = 5; }, /Unsupported receipt decision/],
  ['receipt stale scenario', f => { f.receipt.binding = { ...f.receipt.binding, scenarioSha256: '0'.repeat(64) }; }, /stale scenario/],
  ['receipt stale deck', f => { f.receipt.binding = { ...f.receipt.binding, deckSha256: '0'.repeat(64) }; }, /stale scenario/],
  ['receipt stale revision', f => { f.receipt.binding = { ...f.receipt.binding, revision: 'old' }; }, /stale scenario/],
  ['receipt missing scenario group', f => { delete f.receipt.scenarioDecisions.timePresentation; }, /missing or unsupported/],
  ['receipt different scenario detail', f => { f.receipt.scenarioDecisions.firstPlayableSlice = { ...f.receipt.scenarioDecisions.firstPlayableSlice, details: 'TEST-ONLY DIFFERENT' }; }, /did not approve field/],
]) test(name + ' rejects even with a matching receipt hash', t => {
  const f = fixture(t); mutate(f); f.updateReceipt();
  assert.throws(() => validate(f.options), expected);
  assert.equal(cli(f.options).status, 1);
});

test('changed source, source manifest, proposal mapping and malformed JSON fail closed', t => {
  const f = fixture(t);
  const source = f.packet.sources[0];
  const sourcePath = join(f.options.gddRoot, source.path);
  const original = readFileSync(sourcePath);
  writeFileSync(sourcePath, 'stale');
  assert.throws(() => validate(f.options), /Stale source/);
  writeFileSync(sourcePath, original);
  f.packet.sources[0].sha256 = '0'.repeat(64); save(f.options.proposal, f.packet);
  assert.throws(() => validate(f.options), /Unsupported source manifest/);
  copyFileSync(shipped, f.options.proposal);
  const wrong = JSON.parse(readFileSync(shipped)); wrong.decisions[0].field = 'damage'; save(f.options.proposal, wrong);
  assert.throws(() => validate(f.options), /Unsupported proposal decision/);
  copyFileSync(shipped, f.options.proposal);
  writeFileSync(f.options.params, '{');
  assert.throws(() => validate(f.options), SyntaxError);
  assert.equal(cli(f.options).status, 1);
});

for (const [name, mutate, expected] of [
  ['unapproved scoped field', f => { f.packet.decisions[6].status = 'scoped-policy-decided'; save(f.options.proposal, f.packet); }, /Unsupported proposal decision/],
  ['expanded Q3 selection', f => { f.packet.decisions[6].scopedSelection = { value: 'registered-title-contracts', scope: 'S01', receipt: 'gp.investigation-rules.receipt.json' }; save(f.options.proposal, f.packet); }, /Unsupported boundary selection/],
  ['wrong Q3 scoped choice', f => { f.packet.decisions[6].scopedSelection.value = 'control-only-until-canon'; save(f.options.proposal, f.packet); }, /Unsupported boundary selection/],
  ['wrong Q3 scoped receipt', f => { f.packet.decisions[10].scopedSelection.receipt = 'gp.investigation-rules.receipt.json'; save(f.options.proposal, f.packet); }, /Unsupported boundary selection/],
  ['wrong Q2 scoped receipt', f => { f.packet.decisions[1].scopedSelection.receipt = 'gp.owner-canonical-location.receipt.json'; save(f.options.proposal, f.packet); }, /Unsupported scoped selection/],
  ['wrong Q2 scoped choice', f => { f.packet.decisions[3].scopedSelection.value = 'aggregate-with-transfers'; save(f.options.proposal, f.packet); }, /Unsupported scoped selection/],
  ['expanded scoped boundary', f => { f.packet.decisions[0].scopedSelection.scope = 'S01+S06'; save(f.options.proposal, f.packet); }, /Unsupported scoped selection/],
  ['wrong scoped choice', f => { f.packet.decisions[0].scopedSelection.value = 'canonical-or-explicit-scenario'; save(f.options.proposal, f.packet); }, /Unsupported scoped selection/],
  ['proposal revision', f => { f.packet.proposalVersion = 1; save(f.options.proposal, f.packet); }, /Stale scenario/],
  ['proposal scenario', f => { f.packet.binding.scenarioSha256 = '0'.repeat(64); save(f.options.proposal, f.packet); }, /Stale scenario/],
  ['proposal deck', f => { f.packet.binding.deckSha256 = '0'.repeat(64); save(f.options.proposal, f.packet); }, /Stale scenario/],
  ['scenario source', f => { writeFileSync(join(f.options.scenarioRoot, 'scenario-data.json'), '{}'); }, /Stale scenario source/],
  ['deck source', f => { writeFileSync(join(f.options.scenarioRoot, 'deck-v2/index.html'), 'stale'); }, /Stale deck source/],
  ['manifest bytes', f => { writeFileSync(join(dirname(f.options.proposal), f.packet.scenarioDecisionManifest.path), '{}'); }, /Stale scenario decision manifest/],
  ['GP coverage', f => { f.packet.decisions[0].scenarioCoverage.owner = 'wrong'; save(f.options.proposal, f.packet); }, /Stale scenario GP coverage/],
  ['group coverage', f => { f.packet.decisions[0].ownerDecisionGroups = []; save(f.options.proposal, f.packet); }, /Wrong scenario group coverage/],
]) test(name + ' cannot be bypassed by rehashing the proposal', t => {
  const f = fixture(t); mutate(f);
  f.params.proposalSha256 = hash(readFileSync(f.options.proposal));
  f.receipt.proposalSha256 = f.params.proposalSha256;
  f.updateReceipt();
  assert.throws(() => validate(f.options), expected);
  assert.equal(cli(f.options).status, 1);
});

test('unknown, duplicate and missing CLI argument values fail instead of bypassing validation', () => {
  for (const args of [['--run'], ['--params'], ['--params', 'x', '--params', 'y'], ['--toString', 'x']]) {
    const result = spawnSync(process.execPath, [join(root, 'scripts/tools/gp-params-validate.mjs'), ...args], { encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Usage:/);
  }
});
