export type CampaignErrorCode = 'shape' | 'content-hash' | 'content-link' | 'location-scope' | 'person-scope'
  | 'authority-source' | 'grant-version' | 'custody' | 'inventory' | 'cross-link' | 'report-unreceived'
  | 'report-link' | 'clock' | 'stale-version' | 'inherited-option' | 'duplicate-id';

/** Safe reason codes only: errors do not disclose hidden world values. */
export class CampaignBoundaryError extends Error {
  readonly name = 'CampaignBoundaryError';
  readonly code: CampaignErrorCode;
  constructor(code: CampaignErrorCode) { super(code); this.code = code; }
}
export function requireBoundary(condition: boolean, code: CampaignErrorCode): asserts condition {
  if (!condition) throw new CampaignBoundaryError(code);
}
export function ownInput(value: unknown): void {
  if (typeof value !== 'object' || value === null) return;
  requireBoundary(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null, 'inherited-option');
  for (const key of Object.keys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    requireBoundary(descriptor !== undefined && 'value' in descriptor, 'inherited-option');
    ownInput(descriptor.value);
  }
}
