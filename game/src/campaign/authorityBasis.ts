import { summaryHash } from '../domain/eventLedger.ts';
import { assertNever } from '../domain/errors.ts';
import type { CampaignContent } from './content.ts';
import type { CampaignState } from './stateSchemas.ts';
import { CampaignBoundaryError, requireBoundary } from './errors.ts';

/** Canonical order is the admitted operation.grants order: designation, then recipient access. */
export function campaignAuthorityAt(state: CampaignState, operationId: CampaignState['mandates'][number]['operation'], context: { readonly content: CampaignContent; readonly at: number }) {
  const { scenario, operations, manifest } = context.content.data;
  const operation = operations.authority.mandates.find(m => m.id === operationId);
  requireBoundary(operation !== undefined, 'authority-source');
  requireBoundary(manifest.selection.court.some(p => p.personId === operation.recipient && p.liegePersonId === operations.authority.designator && p.status === 'active'), 'recipient-unavailable');
  const expiresAt = Math.min(state.clock.closedAt ?? Infinity, operations.clock.scheduledCloseSeconds * 1000);
  requireBoundary(context.at >= 0 && context.at < expiresAt, 'authority-expired');
  const grants = operation.grants.map(grantId => {
    const source = scenario.rights.grants.find(g => g.id === grantId);
    const current = state.grants.find(g => g.id === grantId)?.revisions.filter(r => r.effectiveAt <= context.at).at(-1);
    requireBoundary(source !== undefined && source.issuer === operations.authority.issuer && current !== undefined && current.issuer === source.issuer, 'authority-source');
    switch (current.state) {
      case 'valid': break;
      case 'revoked': throw new CampaignBoundaryError('authority-revoked');
      case 'expired': throw new CampaignBoundaryError('authority-expired');
      default: assertNever(current.state);
    }
    return { ...source, version: current.version };
  });
  requireBoundary(grants.length === 2 && grants.some(g => g.recipient === operations.authority.designator && g.delegationDepth === 'named-two-only') &&
    grants.some(g => g.recipient === operation.recipient && g.delegationDepth === 'none'), 'authority-source');
  const authority = grants.map(g => ({ grantId: g.id, version: g.version }));
  return {
    operation: operation.id, issuerPersonId: operations.authority.designator, recipientId: operation.recipient,
    grants, authority, compositeVersion: summaryHash({ operation: operation.id, authority }),
    effectiveAt: operations.clock.epochSeconds * 1000, expiresAt, subdelegation: false as const,
    original: { ...scenario.ledger, keyTransfer: operations.authority.keyTransfer, wholeOriginal: operations.authority.wholeOriginal },
  };
}

/** Recheck at the effect time, not at subjective notice receipt or original issue. */
export function assertComposedAuthority(state: CampaignState, order: CampaignState['mandates'][number], context: { readonly content: CampaignContent; readonly at: number }): void {
  const basis = campaignAuthorityAt(state, order.operation, context);
  requireBoundary(order.issuerPersonId === basis.issuerPersonId && order.recipientId === basis.recipientId, 'authority-source');
  requireBoundary(order.authority.length === basis.authority.length && basis.authority.every((a, index) => order.authority[index]?.grantId === a.grantId && order.authority[index]?.version === a.version) &&
    order.compositeVersion === basis.compositeVersion, 'grant-version');
}
