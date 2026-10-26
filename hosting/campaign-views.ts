import { z } from '../engine/node_modules/zod/index.js';
import { mountCampaignMap } from '../game/ui/campaignMap.ts';
import type { MapView, CampaignActor } from '../game/ui/campaignMap.ts';
import { mountCampaignOrders } from '../game/ui/campaignOrders.ts';
import { mountCampaignSettlement, buildSettlementView } from '../game/ui/campaignSettlement.ts';
import { mountCampaignReports, buildInboxView } from '../game/ui/campaignReports.ts';
import { mountCampaignSaves } from '../game/ui/campaignSaves.ts';
import { mountCampaignDialogue } from '../game/ui/campaignDialogue.ts';
import type { EventDefinition, SwitchEffect } from '../game/src/events/definition.ts';
import { EventDataError, loadEvent } from '../game/src/events/definition.ts';
import type { EventContext } from '../game/src/events/pipeline.ts';
import { CAMPAIGN_SAVE_NAMESPACE } from '../game/src/campaign/saveCheckpoint.ts';
import { parseCampaignSave } from '../game/src/campaign/saveCheckpoint.ts';
import type { ProductionCampaign } from './campaign-runtime.ts';
import { mountCampaignControls } from './campaign-controls.ts';
import { summaryHash } from '../game/src/domain/eventLedger.ts';
import mapSource from '../game/data/campaign/map-view.json';
import identityMap from '../game/data/campaign/identity-map.json';

const rank = z.enum(['barony', 'county', 'duchy', 'kingdom', 'empire']);
// JSON module fields with literal types cross this presentation boundary exactly once.
const mapView: MapView = { ...mapSource, schema: z.literal('campaign-map-view.v1').parse(mapSource.schema),
  titles: mapSource.titles.map(title => ({ ...title, rank: rank.parse(title.rank) })) };

export function mountCampaignViews(parent: HTMLElement, options: {
  readonly runtime: ProductionCampaign; readonly actor: CampaignActor; readonly onTitle: () => void;
}): void {
  const { runtime, actor } = options;
  const { app, content } = runtime;
  let releaseView: () => void = () => {};
  let releaseControls: () => void = () => {};
  const switchView = (mount: () => { readonly release: () => void }): void => {
    releaseControls(); releaseView();
    releaseView = mount().release;
    releaseControls = mountCampaignControls(parent, runtime).release;
    parent.dataset.actor = actor.actorId;
    parent.dataset.scenario = content.data.scenario.id;
    parent.dispatchEvent(new CustomEvent('campaign:view', { bubbles: true, detail: { screen: parent.dataset.screen } }));
  };
  function map(): void {
    switchView(() => mountCampaignMap(parent, { view: mapView, identity: identityMap, actor,
      onBack: () => { releaseControls(); releaseView(); unsubscribe(); parent.removeEventListener('campaign:open-saves', onOpenSaves); parent.removeEventListener('campaign:open-dialogue', onOpenDialogue); options.onTitle(); },
      onOrders: orders, onOpenSite: settlement, onOpenReports: reports }));
  }
  function orders(): void {
    switchView(() => mountCampaignOrders(parent, { app, content, actor, onBack: map }));
  }
  function settlement(): void {
    switchView(() => mountCampaignSettlement(parent, {
      snapshot: () => buildSettlementView(runtime.state, content, actor.actorId),
      subscribe: listener => runtime.subscribe(listener), onBack: map, onOpenReports: reports, onOrders: orders,
    }));
  }
  function reports(): void {
    switchView(() => mountCampaignReports(parent, {
      snapshot: () => buildInboxView(runtime.state, content, actor.actorId),
      subscribe: listener => runtime.subscribe(listener), onBack: map, onOpenCommand: orders,
    }));
  }
  function saves(): void {
    switchView(() => mountCampaignSaves(parent, {
      content,
      reader: {
        readActive: () => runtime.storage.getItem(CAMPAIGN_SAVE_NAMESPACE + ':active'),
        readPayload: key => runtime.storage.getItem(key),
        parseSave: raw => parseCampaignSave(raw, content),
      },
      liveClock: () => ({ clockMs: runtime.state.clock.worldMilliseconds, speed: runtime.state.clock.speed }),
      subscribe: listener => runtime.subscribe(listener),
      save: () => runtime.save(),
      onBack: map,
      onSaved: detail => parent.dispatchEvent(new CustomEvent('campaign:saved', { bubbles: true, detail })),
    }));
  }
  /** Open request for the narrative dialogue surface (task26 §7): a document admitted through the
   * real loadEvent boundary plus the authoritative actor context the caller owns. Production
   * dispatches none today — the schema admits TESTINPUT provenance only — so this stays the
   * single honest entry path; no fixture is promoted to canon and no stock speech is fabricated. */
  type DialogueOpenDetail = {
    readonly document?: unknown;
    readonly knownTraits: ReadonlySet<string>;
    readonly getContext: () => EventContext;
    readonly onEffects?: (effects: readonly SwitchEffect[], switches: Readonly<Record<string, boolean>>) => void;
  };
  function dialogue(detail: DialogueOpenDetail): void {
    let admitted: EventDefinition | null = null; let blockedReason: string | undefined;
    if (detail.document !== undefined) {
      try { admitted = loadEvent(detail.document, detail.knownTraits); }
      catch (error) { blockedReason = error instanceof EventDataError ? error.detail : String(error); }
    }
    switchView(() => mountCampaignDialogue(parent, {
      event: admitted, blockedReason, context: detail.getContext,
      liveClock: () => ({ clockMs: runtime.state.clock.worldMilliseconds, speed: runtime.state.clock.speed }),
      subscribe: listener => runtime.subscribe(listener), onEffects: detail.onEffects, onBack: map,
    }));
  }
  // The page-owned session bar opens the save/load surface through a DOM event; views are swappable.
  const onOpenSaves = (): void => saves();
  parent.addEventListener('campaign:open-saves', onOpenSaves);
  const onOpenDialogue = (event: Event): void => { dialogue((event as CustomEvent<DialogueOpenDetail>).detail); };
  parent.addEventListener('campaign:open-dialogue', onOpenDialogue);
  // Public receipts contain only visible state and causal IDs, never remote world facts.
  const unsubscribe = runtime.subscribe(() => {
    const view = app.view(actor.actorId);
    parent.dataset.worldMilliseconds = String(view.worldMilliseconds);
    parent.dispatchEvent(new CustomEvent('campaign:change', { bubbles: true, detail: {
      worldMilliseconds: view.worldMilliseconds, revision: view.revision,
      orders: view.orders.map(order => ({ orderId: order.orderId, stage: order.stage })),
      reportIds: buildInboxView(runtime.state, content, actor.actorId).rows.map(row => row.reportId),
      visibleHash: summaryHash(view), eventIds: runtime.state.commands.events.map(event => event.id),
    } }));
  });
  map();
}
