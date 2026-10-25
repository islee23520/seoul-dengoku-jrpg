import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summaryHash } from '../domain/eventLedger.ts';
import { assertNever } from '../domain/errors.ts';
import { content, e0, rejects } from './testFixtures.ts';
import { acceptedOrder, checkRequest, readyState } from './authorityFixtures.ts';
import { assertComposedAuthority } from './authorityBasis.ts';
import { composeCampaignAuthority } from './authorityComposition.ts';
import { checkCampaignReadiness } from './authorityReadiness.ts';
import { parseCampaignState } from './state.ts';
import { nodeLocation } from './locations.ts';

const request = { operation: 'S01-L', issuerPersonId: 'K002', recipientId: 'K568', expectedRevision: 0 };
for (const boundary of ['effect', 'restore', 'readiness', 'admission'] as const) {
  for (const recomputed of [true, false]) test(boundary + ' rejects reversed references with ' + (recomputed ? 'recomputed' : 'original') + ' digest', () => {
    // Given the verifier's reverse-order proof over the same real grants.
    const state = readyState(), original = acceptedOrder('S01-L');
    const authority = [...original.authority].reverse();
    const forged = { ...original, authority, compositeVersion: recomputed ? summaryHash({ operation: original.operation, authority }) : original.compositeVersion };
    const changed = { ...state, mandates: [forged] };
    // When / Then each boundary rejects independently, not via an earlier probe.
    switch (boundary) {
      case 'effect': rejects(() => assertComposedAuthority(state, forged, { content, at: 66000 }), 'grant-version'); break;
      case 'restore': rejects(() => parseCampaignState(changed, content), 'grant-version'); break;
      case 'readiness': rejects(() => checkCampaignReadiness(changed, { ...checkRequest(state), expectedCompositeVersion: forged.compositeVersion }, content), 'grant-version'); break;
      case 'admission': rejects(() => composeCampaignAuthority(changed, request, content), 'grant-version'); break;
      default: assertNever(boundary);
    }
  });
}

test('source registry order does not change the canonical operation grant order or version', () => {
  // Given the same source grants stored in a different registry order.
  const original = composeCampaignAuthority(e0, request, content);
  // When the adapter reads them through the admitted operation definition.
  const reordered = composeCampaignAuthority({ ...e0, grants: [...e0.grants].reverse() }, request, content);
  // Then one operation still has exactly one canonical identity.
  assert.deepEqual(reordered.authority, original.authority);
  assert.equal(reordered.compositeVersion, original.compositeVersion);
});

for (const [kind, node] of [['observe-tap', 's01:townhall:tap'], ['observe-cistern', 's01:townhall:cistern']] as const) test(kind + ' requires supplied writing kit availability', () => {
  // Given K616 at the instrument, with paper, gauge and light but no usable writing kit.
  const base = readyState([acceptedOrder('S01-O')]);
  const state = parseCampaignState({ ...base,
    bodies: base.bodies.map(b => b.entityId === 'K616' ? { ...b, location: nodeLocation(node, content) } : b),
    tools: base.tools.map(t => t.id === content.data.operations.provisions.writingKit ? { ...t, available: false } : t) }, content);
  // When / Then observation cannot proceed using paper as a substitute for the actual tool.
  rejects(() => checkCampaignReadiness(state, { ...checkRequest(state), until: 186000, action: { kind } }, content), 'tool-unavailable');
});
