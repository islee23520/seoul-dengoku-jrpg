#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const supported = [
  [
    "GP-01",
    "startLocationPolicy",
    [
      "canonical-only",
      "canonical-or-explicit-scenario"
    ]
  ],
  [
    "GP-02",
    "travelCostPolicy",
    [
      "authored-edge-cost",
      "poc-edge-tick"
    ]
  ],
  [
    "GP-03",
    "scheduleConflictPolicy",
    [
      "hold-conflict",
      "reject-conflict"
    ]
  ],
  [
    "GP-04",
    "laborDetailPolicy",
    [
      "aggregate-with-transfers",
      "named-roster"
    ]
  ],
  [
    "GP-05",
    "constructionScopePolicy",
    [
      "repair-first",
      "authored-build-chain"
    ]
  ],
  [
    "GP-06",
    "cargoSplitPolicy",
    [
      "whole-consignment",
      "identified-splits"
    ]
  ],
  [
    "GP-07",
    "titleActivationPolicy",
    [
      "control-only-until-canon",
      "registered-title-contracts"
    ]
  ],
  [
    "GP-08",
    "overCapacityPolicy",
    [
      "manual-reorganization",
      "offer-reorganization"
    ]
  ],
  [
    "GP-09",
    "successionDataPolicy",
    [
      "registered-institutions-only",
      "author-one-institution-first"
    ]
  ],
  [
    "GP-10",
    "educationScopePolicy",
    [
      "one-authored-skill",
      "authored-skill-catalog"
    ]
  ],
  [
    "GP-11",
    "battleResolutionPolicy",
    [
      "shared-individual-resolver",
      "explicit-aggregate-allocation"
    ]
  ],
  [
    "GP-12",
    "reinforcementScopePolicy",
    [
      "closed-initial-roster",
      "authored-arrival-entry"
    ]
  ],
  [
    "GP-13",
    "peaceScopePolicy",
    [
      "registered-casus-endings",
      "registered-item-negotiation"
    ]
  ],
  [
    "GP-14",
    "saveCheckpointPolicy",
    [
      "explicit-consistent-boundary",
      "also-authored-milestones"
    ]
  ]
];
const sourceLocks = [
  {
    "repo": "gdd",
    "path": "canon/locales/ko-KR/root/open-decisions.json",
    "sha256": "2443b74a67bac906361818bb56d259000cf8d780c1a33cadda07ce0450918afa"
  },
  {
    "repo": "gdd",
    "path": "canon/locales/ko-KR/rules/campaign-progression.json",
    "sha256": "8e7da86e041b5fd8508d3f31c471351fe4cae858d4b01324bf4f41871d159d44"
  },
  {
    "repo": "gdd",
    "path": "canon/locales/ko-KR/system-design/singleplayer-design-sp-1-0-0.json",
    "sha256": "633265f37815e8d581b52426a84eec2bd1a1e987b2e05bd614b8f9752877a9bd"
  },
  {
    "repo": "poc",
    "path": "GAME/Assets/Janseon/Core/RouteDomain.cs",
    "sha256": "4b78d828a4415d8b4bd8153595bf93d3280205a51d4f50ab84fad6b851cac936"
  },
  {
    "repo": "poc",
    "path": "GAME/Assets/Janseon/Core/CampaignTurnDomain.cs",
    "sha256": "e1b111bf2f667c328d8582ed69bed104e0c1c274a5f3b73e2fcf740713a48ba6"
  },
  {
    "repo": "poc",
    "path": "GAME/Assets/Janseon/Core/Battle/Sim/BattleSim.cs",
    "sha256": "bd73ce0aa2484fdcdf0a7eb241937fce65e4ade5d779f8312dafcfbc65e39ff5"
  },
  {
    "repo": "poc",
    "path": "GAME/Assets/Janseon/Data/Repositories/BattleSetupRepository.cs",
    "sha256": "a3150e3268056d7786f5f06db73868c1a7b0945b54bcf1611d19bb1ef08de1d3"
  }
];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const scenarioBinding = {"revision":"lord-scenario-gp-v2","scenarioSha256":"08536eebbadd1a2bd6cb2c0d55b18c56096edbb4ae0a4c892f7a89094d08f02f","deckSha256":"bb700a96f6459b2b1cfcdb2f967191dba6a22c0b7db889405737c76a4e882ec3"};
const scenarioManifestSha256 = 'c44e91e003e0ec1d4260aee11c91121dfa8513c1fb2318c7c7198a1b9548c03c';
function bindingMatches(value) {
  return object(value) && Object.keys(value).length === 3 && Object.entries(scenarioBinding).every(([key, expected]) => value[key] === expected);
}
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
function requireThat(condition, message) { if (!condition) throw new Error(message); }
function keys(value, expected, label) {
  requireThat(object(value), label + ' must be an object');
  requireThat(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), label + ' has missing or unsupported fields');
}
function json(path) { return JSON.parse(readFileSync(path, 'utf8')); }

export function validate({ params = resolve(root, 'game/data/params/gp.json'), proposal = resolve(root, 'game/data/params/gp.proposal.json'), gddRoot = resolve(homedir(), 'workspace/seoul-dengoku-gdd'), pocRoot = resolve(homedir(), 'workspace/seoul-dengoku'), scenarioRoot = resolve(root, '.omo/evidence/seoul-dengoku-jrpg/task-33') } = {}) {
  const proposalBytes = readFileSync(proposal);
  const pending = JSON.parse(proposalBytes);
  requireThat(pending.schemaVersion === 1 && pending.status === 'pending' && pending.rulesVersion === 'SP-1.0.0', 'Unsupported proposal version/status');
  requireThat(pending.proposalVersion === 2 && bindingMatches(pending.binding), 'Stale scenario/deck/version binding');
  keys(pending.scenarioDecisionManifest, ['path', 'sha256'], 'Scenario manifest reference');
  requireThat(pending.scenarioDecisionManifest.path === 'gp.scenario-decisions.proposal.json' && pending.scenarioDecisionManifest.sha256 === scenarioManifestSha256, 'Stale scenario manifest reference');
  const manifestBytes = readFileSync(resolve(dirname(proposal), pending.scenarioDecisionManifest.path));
  requireThat(digest(manifestBytes) === scenarioManifestSha256, 'Stale scenario decision manifest');
  const manifest = JSON.parse(manifestBytes);
  const scenarioBytes = readFileSync(resolve(scenarioRoot, 'scenario-data.json'));
  requireThat(digest(scenarioBytes) === scenarioBinding.scenarioSha256, 'Stale scenario source');
  requireThat(digest(readFileSync(resolve(scenarioRoot, 'deck-v2/index.html'))) === scenarioBinding.deckSha256, 'Stale deck source');
  const scenario = JSON.parse(scenarioBytes);
  requireThat(JSON.stringify(pending.sources) === JSON.stringify(sourceLocks), 'Unsupported source manifest');
  for (const source of sourceLocks) {
    const sourcePath = resolve(source.repo === 'gdd' ? gddRoot : pocRoot, source.path);
    requireThat(digest(readFileSync(sourcePath)) === source.sha256, 'Stale source: ' + source.path);
  }
  requireThat(Array.isArray(pending.decisions) && pending.decisions.length === supported.length, 'Proposal must cover GP-01 through GP-14');
  for (const [index, [gp, field, choices]] of supported.entries()) {
    const decision = pending.decisions[index];
    const boundaryValue = { titleActivationPolicy: 'registered-title-contracts', overCapacityPolicy: 'offer-reorganization', successionDataPolicy: 'registered-institutions-only', educationScopePolicy: 'one-authored-skill', battleResolutionPolicy: 'shared-individual-resolver', reinforcementScopePolicy: 'authored-arrival-entry', peaceScopePolicy: 'registered-item-negotiation' }[field];
    const scopedValue = { startLocationPolicy: 'canonical-only', travelCostPolicy: 'authored-edge-cost', scheduleConflictPolicy: 'reject-conflict', laborDetailPolicy: 'named-roster', constructionScopePolicy: 'repair-first', cargoSplitPolicy: 'whole-consignment', saveCheckpointPolicy: 'explicit-consistent-boundary' }[field];
    const scopedReceipt = ['travelCostPolicy', 'laborDetailPolicy', 'constructionScopePolicy', 'cargoSplitPolicy'].includes(field) ? 'gp.investigation-rules.receipt.json' : 'gp.owner-canonical-location.receipt.json';
    requireThat(decision.gp === gp && decision.field === field && decision.kind === 'rule-choice' && decision.status === (boundaryValue ? 'scoped-boundary-decided' : scopedValue ? 'scoped-policy-decided' : 'pending') && JSON.stringify(decision.choices) === JSON.stringify(choices), 'Unsupported proposal decision: ' + gp);
    if (scopedValue) {
      keys(decision.scopedSelection, ['value', 'scope', 'receipt'], 'Scoped selection: ' + gp);
      requireThat(decision.scopedSelection.value === scopedValue && decision.scopedSelection.scope === 'S01' && decision.scopedSelection.receipt === scopedReceipt, 'Unsupported scoped selection: ' + gp);
    } else if (boundaryValue) {
      keys(decision.scopedSelection, ['value', 'scope', 'receipt'], 'Boundary selection: ' + gp);
      requireThat(decision.scopedSelection.value === boundaryValue && decision.scopedSelection.scope === 'followup-feature-boundaries' && decision.scopedSelection.receipt === 'gp.followup-boundaries.receipt.json', 'Unsupported boundary selection: ' + gp);
    } else requireThat(!Object.hasOwn(decision, 'scopedSelection'), 'Unapproved scoped selection: ' + gp);
    requireThat(decision.source === 'canon/locales/ko-KR/rules/campaign-progression.json#gameplay-unknown.20261003.matrix/' + gp, 'Wrong canonical GP anchor: ' + gp);
    const row = scenario.gpChangeMatrix[index];
    const coverage = { question: row.originalQuestion, boundary: row.originalBoundary, owner: row.originalOwner, scenarios: row.scenarios, acceptance: row.acceptance, outsideScenarioSubset: row.outsideScenarioSubset, status: row.coverageStatus };
    requireThat(JSON.stringify(decision.scenarioCoverage) === JSON.stringify(coverage), 'Stale scenario GP coverage: ' + gp);
    requireThat(JSON.stringify(decision.ownerDecisionGroups) === JSON.stringify(manifest.groups.filter(group => group.gp.includes(gp)).map(group => group.id)), 'Wrong scenario group coverage: ' + gp);
  }
  const approved = json(params);
  requireThat(approved.status === 'approved', 'Pending or missing owner approval');
  keys(approved, ['schemaVersion', 'status', 'rulesVersion', 'proposalSha256', 'binding', 'scenarioManifestSha256', 'scenarioDecisions', 'fields'], 'Parameters');
  const proposalSha256 = digest(proposalBytes);
  requireThat(approved.schemaVersion === 1 && approved.rulesVersion === pending.rulesVersion, 'Unsupported parameter version');
  requireThat(approved.proposalSha256 === proposalSha256, 'Stale proposal approval');
  requireThat(bindingMatches(approved.binding) && approved.scenarioManifestSha256 === scenarioManifestSha256, 'Stale approved scenario/deck/version binding');
  keys(approved.fields, supported.map(([, field]) => field), 'Parameter fields');
  keys(approved.scenarioDecisions, manifest.groups.map(group => group.field), 'Scenario decisions');
  const contracts = [...supported.map(([, field, choices]) => ({ field, choices, scenarioDecision: false })), ...manifest.groups.map(group => ({ field: group.field, choices: group.choices, scenarioDecision: true }))];
  for (const { field, choices, scenarioDecision } of contracts) {
    const entry = (scenarioDecision ? approved.scenarioDecisions : approved.fields)[field];
    keys(entry, scenarioDecision ? ['value', 'details', 'approval'] : ['value', 'approval'], field);
    if (scenarioDecision) requireThat(text(entry.details), 'Missing explicit scenario details: ' + field);
    requireThat(choices.includes(entry.value), 'Unsupported value: ' + field);
    keys(entry.approval, ['by', 'reference', 'sha256'], field + ' approval');
    const approval = entry.approval;
    requireThat(text(approval.by) && text(approval.reference) && /^[a-f0-9]{64}$/.test(approval.sha256), 'Missing approval evidence: ' + field);
    const receiptBytes = readFileSync(resolve(dirname(params), approval.reference));
    requireThat(digest(receiptBytes) === approval.sha256, 'Stale approval receipt: ' + field);
    const receipt = JSON.parse(receiptBytes);
    keys(receipt, ['schemaVersion', 'role', 'actor', 'rawResponse', 'proposalSha256', 'binding', 'scenarioManifestSha256', 'scenarioDecisions', 'decisions'], 'Approval receipt');
    requireThat(receipt.schemaVersion === 1 && receipt.role === 'owner' && receipt.actor === approval.by && text(receipt.rawResponse), 'Missing owner response: ' + field);
    requireThat(receipt.proposalSha256 === proposalSha256, 'Receipt refers to stale proposal: ' + field);
    requireThat(bindingMatches(receipt.binding) && receipt.scenarioManifestSha256 === scenarioManifestSha256, 'Receipt has stale scenario/deck/version binding: ' + field);
    requireThat(object(receipt.decisions) && Object.keys(receipt.decisions).length > 0, 'Missing receipt decisions');
    for (const [name, value] of Object.entries(receipt.decisions)) {
      const contract = supported.find(([, candidate]) => candidate === name);
      requireThat(contract && contract[2].includes(value), 'Unsupported receipt decision: ' + name);
    }
    keys(receipt.scenarioDecisions, manifest.groups.map(group => group.field), 'Receipt scenario decisions');
    for (const group of manifest.groups) {
      const choice = receipt.scenarioDecisions[group.field];
      keys(choice, ['value', 'details'], 'Receipt ' + group.field);
      requireThat(group.choices.includes(choice.value) && text(choice.details), 'Missing scenario decision/details: ' + group.field);
    }
    requireThat(scenarioDecision ? receipt.scenarioDecisions[field].value === entry.value && receipt.scenarioDecisions[field].details === entry.details : receipt.decisions[field] === entry.value, 'Owner did not approve field/value: ' + field);
  }
  return { approvedFields: supported.length, scenarioDecisions: manifest.groups.length, proposalSha256 };
}

export function main(args = process.argv.slice(2)) {
  try {
    const options = {};
    const names = { '--params': 'params', '--proposal': 'proposal', '--gdd-root': 'gddRoot', '--poc-root': 'pocRoot', '--scenario-root': 'scenarioRoot' };
    for (let index = 0; index < args.length; index += 2) {
      const name = Object.hasOwn(names, args[index]) ? names[args[index]] : undefined;
      requireThat(name && text(args[index + 1]) && !args[index + 1].startsWith('--') && !(name in options), 'Usage: gp-params-validate.mjs [--params file] [--proposal file] [--gdd-root dir] [--poc-root dir] [--scenario-root dir]');
      options[name] = resolve(args[index + 1]);
    }
    const result = validate(options);
    console.log('GP approval validation passed: ' + result.approvedFields + ' rule choices and ' + result.scenarioDecisions + ' scenario decisions; numerical coefficients remain unresolved.');
    return 0;
  } catch (error) {
    console.error('GP approval validation failed: ' + error.message);
    return 1;
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
