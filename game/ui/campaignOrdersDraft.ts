import { ordersStrings as s } from './campaignOrdersModel.ts';
import type { OperationBrief, OrdersCatalog, OrderDetailView, OrderRowView, OrderAuthorityResult } from './campaignOrdersModel.ts';
const esc = (value: string): string => value.replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');

/** Pure roster and draft presentation, shared by initial render and every selection update. */
export function renderOrderDraft(input: {
  readonly catalog: OrdersCatalog; readonly selectedPersonId: string; readonly rosterFilter: 'named' | 'all';
  readonly row: OrdersCatalog['court'][number] | null; readonly brief: OperationBrief | null; readonly notice: string | null;
}): { readonly rosterRows: string; readonly composer: string } {
  const { catalog, selectedPersonId, rosterFilter, row, brief, notice } = input;
  const rowHtml = (fact: string, value: string): string => '<div class="co-fact"><dt>' + esc(fact) + '</dt><dd>' + value + '</dd></div>';
  const list = (label: string, items: readonly string[]): string => items.length ? '<p class="co-label">' + esc(label) + '</p><ul class="co-list">' + items.map(i => '<li>' + esc(i) + '</li>').join('') + '</ul>' : '';
    const rosterRows = catalog.court
      .filter(member => rosterFilter === 'all' || member.eligible)
      .map(member => '<button class="ui-button co-row" type="button" data-pane-id="' + esc(member.personId) + '" data-pick="' + esc(member.personId) + '" data-person-id="' + esc(member.personId) + '" aria-pressed="' + (member.personId === selectedPersonId) + '">'
        + '<span class="co-row__name">' + esc(member.name) + '</span>'
        + '<span class="co-row__meta">' + (member.status === 'active' ? s.active : s.retired) + (member.operationId ? ' · ' + esc(member.operationId) : '') + '</span>'
        + (member.personId === selectedPersonId ? '<span class="co-check" aria-hidden="true">✓</span>' : '')
        + '</button>').join('')
      + (row && !row.eligible && row.reason ? '<p class="co-reason" data-unavailable-for="' + esc(row.personId) + '">' + esc(row.reason) + '</p>' : '');

    const composer = !row
      ? '<p class="co-empty">' + esc(s.selectRecipient) + '</p>'
      : '<div class="co-brief">'
      + '<h3 class="co-heading">' + esc(row.name) + ' · <span class="co-id" data-person-id="' + esc(row.personId) + '">' + esc(row.personId) + '</span></h3>'
      + (brief
        ? '<button class="ui-button co-action is-selected" type="button" data-pick="' + esc(row.personId) + '" aria-pressed="true">'
          + '<span class="co-row__name">' + esc(brief.label) + ' · <span class="co-id">' + esc(brief.id) + '</span></span>'
          + '<span class="co-row__meta">' + esc(brief.targetName) + '</span><span class="co-check" aria-hidden="true">✓</span></button>'
          + list(s.scope, brief.scope) + list(s.exclusions, brief.exclusions)
          + '<dl class="co-facts">'
          + rowHtml(s.delivery, esc(brief.deliveryNote))
          + rowHtml(s.response, esc(String(brief.responseSeconds)) + esc(s.seconds) + ' · 독립 판단')
          + (brief.original ? rowHtml(s.original, esc(brief.original.name) + ' ' + esc(String(brief.original.count)) + '건 전체 · 보관 ' + esc(brief.original.containerName) + ' · 열쇠 ' + esc(brief.original.keyNote)) : '')
          + (brief.observations.length ? rowHtml(s.observations, brief.observations.map(o => esc(o.siteName)).join(' · ')) : '')
          + '</dl>'
        : '<p class="co-reason">' + esc(row.reason ?? '') + '</p>')
      + (notice ? '<p class="co-reason" role="alert">' + esc(notice) + '</p>' : '')
      + '</div>';

  return { rosterRows, composer };
}

export function renderIssuedOrders(input: {
  readonly rows: readonly OrderRowView[]; readonly reportsByOrder: ReadonlyMap<string, number>;
  readonly catalog: OrdersCatalog; readonly selectedOrderId: string | null;
  readonly detail: OrderDetailView | null;
}): string {
  const { rows, reportsByOrder, catalog, selectedOrderId, detail } = input;
  const rowHtml = (fact: string, value: string): string => '<div class="co-fact"><dt>' + esc(fact) + '</dt><dd>' + value + '</dd></div>';
    const ordersList = rows.length
      ? rows.map(o => {
        const reports = reportsByOrder.get(o.orderId) ?? 0;
        return '<section class="co-order' + (o.orderId === selectedOrderId ? ' is-selected' : '') + '" data-order-id="' + esc(o.orderId) + '">'
          + '<header class="co-order__head"><button class="ui-button co-order__title" type="button" data-order="' + esc(o.orderId) + '">'
          + esc(catalog.operations.find(op => op.id === o.operation)?.label ?? o.operation) + ' · '
          + esc(catalog.court.find(c => c.personId === o.recipientId)?.name ?? o.recipientId)
          + '<span class="co-row__meta">' + esc(o.stageLabel) + (o.cancellationPending ? ' · ' + esc(s.withdrawnPending) : '') + '</span></button>'
          + (o.terminal || o.cancellationPending ? '' : '<button class="ui-button co-order__cancel" type="button" data-cancel-request="' + esc(o.orderId) + '">' + esc(s.requestCancel) + '</button>')
          + '</header>'
          + (o.orderId === selectedOrderId ? '<dl class="co-facts">'
            + rowHtml(s.orderTimeline, detail?.milestones.length
              ? detail.milestones.map(event => esc(event.label) + ' ' + Math.floor(event.at / 1000) + esc(s.seconds)).join(' → ')
              : esc('기록된 진행 시각 없음'))
            + rowHtml('현재 상태', esc(o.stageLabel))
            + (detail?.reason ? rowHtml('사유', esc(detail.reason)) : '')
            + rowHtml(s.recipient + ' 수신', o.receivedAt === null ? esc(s.notYet) : esc(o.receivedAt) + esc(s.seconds))
            + rowHtml('수락', o.acceptedAt === null ? esc(s.notYet) : esc(o.acceptedAt) + esc(s.seconds))
            + rowHtml('수신 보고', reports > 0 ? esc(String(reports)) + '건 수신' : esc(s.notYet))
            + (o.operation === 'S01-L' ? rowHtml('원장 반환', detail?.original
              ? esc(detail.original.unresolvedReturn ? '반환 미해결 · 실물 보존' : detail.original.returnState === 'resealed' ? '재봉인 완료' : detail.original.returnState === 'stored' ? '보관 중' : '반환 절차 중')
                + ' · 보유 ' + esc(catalog.court.find(person => person.personId === detail.original!.custodian)?.name ?? detail.original.custodian)
                + ' · 위치 ' + esc(detail.original.location.kind === 'node' ? detail.original.location.nodeId : detail.original.location.kind === 'edge-progress' ? detail.original.location.from + ' → ' + detail.original.location.to : '현장')
                + ' · 확인 ' + Math.floor(detail.asOf / 1000) + esc(s.seconds)
              : esc('현재 보유자·위치·반환 상태 미확인')) : '')
            + '</dl>' : '')
          + '</section>';
      }).join('')
      : '<p class="co-empty">' + esc(s.noOrders) + '</p>';

  return ordersList;
}

export function renderOrderAuthority(basis: OrderAuthorityResult | null, catalog: OrdersCatalog): string {
  const rowHtml = (fact: string, value: string): string => '<div class="co-fact"><dt>' + esc(fact) + '</dt><dd>' + value + '</dd></div>';
  const short = (hash: string): string => hash.slice(0, 12);
    const authority = basis
      ? (basis.ok
        ? '<dl class="co-facts">'
        + rowHtml(s.issuer, esc(catalog.issuerName))
        + basis.basis.grants.map(g => {
          const grant = catalog.operations.flatMap(o => o.grants).find(x => x.grantId === g.grantId);
          return rowHtml(s.grants, esc(grant?.recipientName ?? g.grantId) + ' · <span class="co-id" title="' + esc(g.version) + '">' + esc(short(g.version)) + '</span>');
        }).join('')
        + rowHtml(s.compositeVersion, '<span class="co-id" data-composite-version="' + esc(basis.basis.compositeVersion) + '" title="' + esc(basis.basis.compositeVersion) + '">' + esc(short(basis.basis.compositeVersion)) + '</span>')
        + rowHtml('운영 종료', esc(String(basis.basis.expiresAtWorldSeconds)) + esc(s.seconds))
        + '</dl>'
        : '<p class="co-reason" role="alert">' + esc(basis.reason) + '</p>')
      : '<p class="co-empty">' + esc(s.selectRecipient) + '</p>';

  return authority;
}
