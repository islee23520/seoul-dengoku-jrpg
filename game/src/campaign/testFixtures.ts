import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CampaignContent } from './content.ts';
import { CampaignBoundaryError } from './errors.ts';
import type { CampaignErrorCode } from './errors.ts';
import { createCampaignE0, parseCampaignState } from './state.ts';
import { nodeLocation } from './locations.ts';
import { summaryHash } from '../domain/eventLedger.ts';

const data = new URL('../../data/', import.meta.url);
export const packages = {
  manifest: await readFile(new URL('campaign/source-manifest.json', data), 'utf8'),
  atlas: await readFile(new URL('campaign/atlas.json', data), 'utf8'),
  identities: await readFile(new URL('campaign/identity-map.json', data), 'utf8'),
  scenario: await readFile(new URL('scenarios/townhall-s01-r1/scenario.json', data), 'utf8'),
  projection: await readFile(new URL('scenarios/townhall-s01-r1/projection.json', data), 'utf8'),
  operations: await readFile(new URL('scenarios/townhall-s01-r2/operations.json', data), 'utf8'),
};
export const content = CampaignContent.parse(packages);
export const e0 = createCampaignE0(content);
export const rejects = (run: () => unknown, code: CampaignErrorCode) => assert.throws(run, (error: unknown) => error instanceof CampaignBoundaryError && error.code === code);

export function reportedState(received: boolean) {
  const operation = content.data.operations.authority.mandates.find(m => m.id === 'S01-O');
  assert.ok(operation);
  const authority = operation.grants.map(grantId => {
    const grant = e0.grants.find(g => g.id === grantId);
    assert.ok(grant);
    return { grantId, version: grant.sourceVersion };
  });
  const fact = { id: 'observation:tap', version: 0, orderId: 'order:observation', sourcePersonId: 'K616', observedAt: 1476000,
    location: nodeLocation('s01:townhall:tap', content), causeId: 'cause:observation', evidence: { kind: 'raw-observation', nodeId: 's01:townhall:tap', measurementValue: null, calibrationReceipt: null, instrumentLabel: 'P-01', rawText: '20~30 표시 사이', unitLabel: 'kPa', uncertainties: ['small-graduations', 'parallax', 'uncalibrated'] } };
  const report = { id: 'report:observation', fact, recipient: 'K002', carrier: 'K616', createdAt: 1476000, deliveredAt: received ? 1542000 : null, receivedAt: received ? 1602000 : null, source: 'K616', omission: ['uncalibrated'], uncertainty: 'partial-evidence', causeId: fact.causeId };
  return parseCampaignState({ ...e0, revision: 1, clock: { ...e0.clock, worldMilliseconds: 1602000 },
    mandates: [{ origin: 'legacy-boundary', orderId: fact.orderId, causeId: fact.causeId, operation: operation.id, issuerPersonId: 'K002', recipientId: operation.recipient, authority,
      compositeVersion: summaryHash({ operation: operation.id, authority }), target: fact.location,
      issuerLocation: nodeLocation('s01:townhall:desk', content), recipientLocation: nodeLocation('s01:townhall:yard', content),
      route: ['s01:townhall:desk', 's01:townhall:entry', 's01:townhall:yard', 's01:townhall:cistern', 's01:townhall:tap'],
      stage: received ? 'receipt' : 'executing', issuedAt: 1002000, receivedAt: 1122000, acceptedAt: 1152000, returnAcceptedAt: null,
      workMilliseconds: 240000, reservationIds: [], pendingResultIds: [], appliedResultIds: [] }],
    facts: [fact], reports: [report],
    knowledge: e0.knowledge.map(k => ({ ...k, records: received && k.personId === 'K002' ? [{ reportId: 'report:observation', factId: fact.id, version: fact.version, receivedAt: 1602000, payloadHash: summaryHash(report) }] : [] })),
  }, content);
}
