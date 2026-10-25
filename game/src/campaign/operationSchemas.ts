import { z } from '../../../engine/node_modules/zod/index.js';

const text = z.string();
const n = z.number();
const strings = z.array(text).readonly();
const yes = z.literal(true), no = z.literal(false);
export const clockRules = z.strictObject({ unit: text, worldMillisecondsPerSecond: z.literal(1000), worldSecondsPerRealSecond: n,
  peaceSpeeds: z.array(n).readonly(), hostIntegrationMaxRealMilliseconds: n, epochSeconds: n, scheduledCloseSeconds: n,
  dawnSeconds: n, supportUntilSeconds: n, closeRule: text, offlineAccrual: no, automaticPause: no, battleAdmission: z.null() }).readonly();
export const durations = z.strictObject({ commandDelivery: n, dutyCall: n, revocationNotice: n, response: n, returnResponse: n,
  archiveCheck: n, pickup: n, deliverToK002: n, returnPickup: n, dutyHandover: n, compare: n, compareRow: n,
  cisternObservation: n, tapObservation: n, report: n, reseal: n, minimumRest: n, eat: n, drink: n }).readonly();
export const routeRules = { kind: text, metresPerTile: z.null(), walkingMetresPerSecond: n, ledgerMetresPerSecond: n,
  ledgerMassKg: n, tiredMultiplier: n, stackTiredMultipliers: no, escortMatchesCarrier: yes, unsupported: strings };
export const consumptionRules = z.strictObject({ eatOncePerPerson: yes, drinkOncePerPerson: yes, foodPacks: n, waterMl: n,
  extendsToSeconds: n, earlyConsumptionDoesNotExtendDeadline: yes, windowStartSeconds: n, windowEndSeconds: n,
  reservationSecondsPerPerson: n, uncoveredItemsIndependent: yes }).readonly();
export const provisionRules = { consumption: consumptionRules, paperConsumedOnFirstRecord: yes, refundOnCancel: no,
  writingKit: text, writingKitAt: text, lights: text, lightsUntilSeconds: n,
  afterSupport: z.strictObject({ pay: text, food: text, water: text, newLabor: text, newTravel: text,
    preserveCustody: yes, automaticRescue: no, automaticDeath: no }).readonly() };
const effort = z.strictObject({ 'left-arm': n.optional(), 'right-arm': n.optional(), 'left-leg': n.optional(),
  'right-leg': n.optional(), head: n.optional(), torso: n.optional() }).readonly();
export const bodyRules = { conflictingExistingState: text,
  effortPerWorldSecond: z.strictObject({ walking: effort, carrying: effort, stationary: effort, waiting: effort }).readonly(),
  required: z.strictObject({ walking: strings, carrying: strings, stationary: strings }).readonly(),
  tiredAtEffortSeconds: n, restRequiredAtEffortSeconds: n, restRecoveryPerWorldSecond: n, effortFloor: n, accounting: text,
  oneActivityPerPerson: yes, restRequiresSafeLocationAndConsent: yes, interruptedRestPreservesElapsedRecovery: yes,
  restHealsDamageDiseaseThirst: no, missingCoverage: text, unsupportedSafeReturn: text, refundOnCancel: no };
export const ledgerRow = z.discriminatedUnion('id', [
  z.strictObject({ id: z.literal('L01-1'), eventId: text, atSeconds: n, unit: text, bundles: z.strictObject({ A: n, B: n, C: n }).readonly() }).readonly(),
  z.strictObject({ id: z.literal('L01-2'), eventId: text, atSeconds: n, coverTotal: n, writerPersonId: z.null(), conclusion: text }).readonly(),
  z.strictObject({ id: z.literal('L01-3'), eventId: text, atSeconds: n, instrumentLabel: text, rawText: text, unitLabel: text }).readonly(),
  z.strictObject({ id: z.literal('L01-4'), requestId: text, atSeconds: n, rawText: text, signatureSlots: n, signedSlots: n,
    signerPersonId: z.null(), pressureText: text, attachmentPresent: no }).readonly(),
]);
export const rawReading = z.strictObject({ instrumentLabel: text, rawText: text, unitLabel: text,
  calibrationReceipt: z.null(), measurementValue: z.null(), uncertainties: strings }).readonly();
export const evidenceRules = z.strictObject({ ledgerRows: z.array(ledgerRow).readonly(),
  observations: z.array(rawReading.unwrap().extend({ siteId: text, observer: text, observedAt: text, quality: text.optional() }).readonly()).readonly(),
  reportStatus: text, ledgerComparer: text, receivedAt: text, knowledgeBeforeReceipt: no, calibratedCommit: no,
  normalityJudgment: no, causeJudgment: no }).readonly();
export const orderingRules = z.strictObject({ phases: strings, tieBreak: strings, duplicateIds: text,
  arrivalsAtDeadlineEligible: yes, arrivalsAfterDeadlineEligible: no, automaticSave: no }).readonly();
export const responseRules = z.strictObject({ states: strings, recheckBeforeAccept: yes, refuseOn: strings, K568: strings,
  K616: strings, tired: text, conflict: text, automaticQueue: no, preserveExistingReservation: yes, observationStages: strings }).readonly();
