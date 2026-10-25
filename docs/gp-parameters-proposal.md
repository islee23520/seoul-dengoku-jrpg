# GP-01~14 소유자 결정 패킷 (task 26 / lord-scenario-gp-v2)

상태: **미승인 / checkbox 26 열림**. 이 정합화는 새 승인 요청이 아니다. 후속 실제 결정은 루트 세션에서만 수집한다. 이 패킷은 승인 응답이 아니며, 제품용 gp.json은 만들지 않는다. A/B는 소유자가 판단할 설계 대안이지 정본 확정값이 아니다. 범위를 좁힌 POC 대안을 고르는 것은 전체 GP 항목 완료가 아니다.

## 최종 시나리오와의 판본 결속·대체

- proposalVersion **2**, binding revision **lord-scenario-gp-v2**. 이전 proposal SHA-256 9f9f3d3198c6b625867fe97052eeabbdde9a970081f762c08183078c6062c779와 task-29/30의 56장 GP deck은 **결정 근거로 대체**한다. 읽기 확인을 승인으로 재사용하지 않는다.
- 최종 task-33/scenario-data.json SHA-256: 08536eebbadd1a2bd6cb2c0d55b18c56096edbb4ae0a4c892f7a89094d08f02f.
- 게시된 task-33/deck-v2/index.html SHA-256: bb700a96f6459b2b1cfcdb2f967191dba6a22c0b7db889405737c76a4e882ec3 ([private deck](https://evidence.linalab.io/evidence/seoul-dengoku-jrpg-lord-pov-review-v2-99590c34-89cb-48c7-a7cf-332a2aff1233/)). final-independent-review.md의 PASS_FOR_PRIVATE_EXPLANATORY_PUBLICATION 및 upload-receipt.json의 게시/본문 확인은 설명 자료 준비 상태다. 모든 13개 gameplay acceptance는 UNRUN이며 구현/규칙/플레이 승인이 아니다.
- **이미 정해진 방향**: 선택한 봉건 영주의 POV, 가신의 채용·유지·실제 위임 능력 확장. 이를 다시 묻지 않는다. 무소속 모험가는 명시 예외다. 자동 월턴/턴당 기본 행동예산/고정 2D 턴전투는 승인 가정에서 제거한다. 2D 저작 도구 선택은 시간 정책 승인이 아니다.
- 실제 개막 예시는 K002 이서담의 title/holding/court와 K568 백산석·K616 성달현의 상보 업무다. K001은 개인 주군이고 K029는 지리 parent다. 13 관계/9 active/4 retired-current를 보존하며 두 가신 배정은 전체 명부가 아니다. 신정2동은 업무 위치일 뿐 정확 시작역/씬/타일은 null이다. typed office·소유·가용 건강·고용/수리/동원 권한을 추정하지 않는다.
- 카드 draft/past, admission current-reviewed, public_admission unrecorded, household draft/source-projection/existing-only, retained-current rights와 current-catalog-input court를 구분한다. approved 문서만으로 source 사실의 존재를 제한하지 않으며 source 존재를 플레이/게시 승인으로 올리지 않는다. 원천 시나리오의 작성 당시 pending-review/no-upload 문구는 final review/게시 영수증이 전달 상태에 한해 대체했다.

## 네 결정 묶음과 실제 범위 선택

실제 Q1 B 응답 `첫 조사 시나리오: 정본 위치 확정 후 시작`은 `gp.owner-canonical-location.receipt.json`에 원문과 질문/계약 출처 해시로 보존했다. S01에 한해 D1 `s01-investigation-only`, D4 `slice-specific-bounded-contracts`, GP-01 `canonical-only`, GP-03 `reject-conflict`, GP-14 `explicit-consistent-boundary`를 선택했다. 정본 위치·실제 권원·가용성 없이는 시작 차단, 충돌은 이유와 함께 거절 후 수정 요청, 저장은 일관 경계에서 명시적으로만 한다. 자동저장/대기 명령은 선택하지 않았다. 제한 조사·실제 통지·즉시 권한 철회·안전 보관/인계 조건만 포함하며 지출·재위임·밸브 개방 권한을 만들지 않는다.

기존 `gp.owner-time-remote.receipt.json`의 단일 시계·실제 이동·실시간 무일시정지 전투·보고 중심 원격 선택은 보존한다. D2는 부분 결정이고 나머지 시간 세부 사항은 미정이다. Q2/Q3, 다른 11개 GP 필드, 정확 배치/스폰, 수치·임금·건강, 실제 권원/가용성은 미승인이다. 아래 manifest는 원래 제안/의존 관계로 유지하고 실제 범위 상태는 proposal의 `scopedScenarioDecisions`와 세 `scopedSelection`에 기록한다. GP 전체 수락이나 task26 완료가 아니다.

이 항목은 GP-15 같은 새 의미 ID가 아니다. gp.scenario-decisions.proposal.json을 별도 제안 manifest로 두고 기존 14 GP 필드와 연결한다. 추천은 선택값이 아니며 수치·배치·권원 입력을 승인하지 않는다.

- **D1 firstPlayableSlice**: S01/A01: K002의 판단, K568 원장 대조와 K616 현장 보고를 먼저 검증한다. 정확 scene/spawn·조사 접근·실물 원장·현재 가용성은 별도 저작/승인이 필요하다. 다른 채용/의료/동원/계승 fixture는 해당 slice 선택 시에만 필요하다. 추천 s01-investigation-only; 대안 explicit-expanded-slice. 관련 GP-01, GP-04, GP-05, GP-06, GP-07, GP-10.
- **D2 timePresentation**: C05/C06 및 S04: 단일 시계·실제 전략 이동·source realtime/no-pause battle·즉시 battle signal을 보존하는 표현부터 검토한다. campaign advance/pause/speed·정산 cadence·off-screen fidelity·renderer 정합의 구체 계약은 아직 없다. event-driven test stepping은 플레이 pause 승인이 아니다. 추천 source-compatible-single-clock; 대안 explicit-reviewed-timing-adaptation. 관련 GP-02, GP-03, GP-06, GP-11, GP-12, GP-14.
- **D3 remotePresentationAction**: C07 및 A05/AX4: 수신한 보고·관측 시각·출처 중심 표시를 권고한다. 원격 imagery를 선택해도 현장 인물 지식 또는 정당한 전달 전 camera-only 행동은 거부한다. 현 지식/권한 계약 변경은 이 두 안 밖의 별도 제안이다. 추천 received-report-projection; 대안 bounded-imagery-with-knowledge-gate. 관련 GP-02, GP-03, GP-12, GP-14.
- **D4 organizationTerms**: C01-C04/C08/C09 및 S06/S07: 선택 slice의 철회 객관효력/통지/safe-custody, 유지·보수·휴식·위임·재위임 한계부터 명시한다. 고용 관계·작위·office·소유·보관·지휘·숙련을 분리한다. 보편 민간 capacity 공식이나 군사 정원 재사용을 선결하지 않는다. 추천 slice-specific-bounded-contracts; 대안 explicit-expanded-organization-contracts. 관련 GP-03, GP-04, GP-05, GP-06, GP-07, GP-08, GP-09, GP-10, GP-13, GP-14.

### 실제 14개 필드와 최종 시나리오 coverage

원 질문/확정 경계/담당 영역은 proposal의 scenarioCoverage에 최종 시나리오 원문으로 보존한다. 기존 field/choice ID는 바꾸지 않는다. 아래는 의존 관계이며 GP 전체 수락/완료가 아니다.

| GP | 실제 필드 | 시나리오 / 설계 acceptance (UNRUN) | 결정 묶음 |
| --- | --- | --- | --- |
| GP-01 | startLocationPolicy | S01, S06 / A01,A06 | D1 |
| GP-02 | travelCostPolicy | S01, S02, S04 / A01,A02,A04 | D2, D3 |
| GP-03 | scheduleConflictPolicy | S01, S05, S06, S07 / A01,A05,A06,A07,AX1,AX2 | D2, D3, D4 |
| GP-04 | laborDetailPolicy | S02, S03, S05, S06 / A02,A03,A05,A06 | D1, D4 |
| GP-05 | constructionScopePolicy | S03, S05 / A03,A05 | D1, D4 |
| GP-06 | cargoSplitPolicy | S02, S04, S05 / A02,A04,A05,AX3 | D1, D2, D4 |
| GP-07 | titleActivationPolicy | S01, S07, S08 / A01,A07,A08,AX1 | D1, D4 |
| GP-08 | overCapacityPolicy | S04, S06 / A04,A06 | D4 |
| GP-09 | successionDataPolicy | S08 / A08,AX5 | D4 |
| GP-10 | educationScopePolicy | S03, S06 / A03,A06 | D1, D4 |
| GP-11 | battleResolutionPolicy | S04 / A04,AX4 | D2 |
| GP-12 | reinforcementScopePolicy | S04, S08 / A04,A08,AX4 | D2, D3 |
| GP-13 | peaceScopePolicy | S04, S07, S08 / A04,A07,A08 | D4 |
| GP-14 | saveCheckpointPolicy | S01, S02, S03, S04, S05, S06, S07, S08 / A01-A08,AX1-AX5 | D2, D3, D4 |

GP-08 정원 감소, GP-10 완전 교육 progression, GP-09 혼인, GP-13 강화/소멸은 이 시나리오 subset 밖이다. 기존 title/select/start UI, 서울 negative boundary, graph/단일 원장, 가격/시장 접근 acceptance를 지우거나 대체하지 않는다.

## 실제 근거와 우선권

- GDD revision `49f57de3f7f6a7fb234c04c98dda1bf27809705e`; POC revision `02feb7a847d11b0fa03dd71885e9ee0a3cc75967`. 정확한 파일 SHA-256은 [pending packet](../game/data/params/gp.proposal.json)의 sources에 있다. JSON의 source.sha256은 원래 Markdown 해시이며 현재 JSON 바이트 해시와 다르다.
- `seoul-dengoku-gdd/canon/locales/ko-KR/root/open-decisions.json#gameplay-unknown.entry.20261003.body`: GP 원장으로 연결하며 시제품 배치·시간·가격·정원·피해는 확정 근거가 아니라고 명시한다. source.b7/b13/b19의 미정/수치 금지 항목도 유지한다.
- 실제 14개 질문은 `canon/locales/ko-KR/rules/campaign-progression.json#gameplay-unknown.20261003.matrix`의 GP-01~14 행이다. 같은 문서 status는 승인 전 값 없음/행동 거절/시나리오 범위를 요구하고 order는 권한·보존·저장부터 결정하도록 한다.
- SP 파일은 root 아래가 아닌 `canon/locales/ko-KR/system-design/singleplayer-design-sp-1-0-0.json`이다. sp1.b4/b100/b109는 빈 데이터·함수·비용·기간의 창작과 POC로 공백을 닫는 것을 금지한다. b54는 국가별 계승 입력이다. b107/b108은 과거 공유 세계·호스트·오프라인 대행을 단일 본체·NPC·단일 캠페인으로 대체한다. GP-03의 전략 연락과 달리 전투 하달은 b112의 즉시 시스템 신호다.

## POC 조사: 상수와 주입 입력의 구분

원천 루트: `seoul-dengoku/GAME/Assets/Janseon/`. 아래는 현재 파일의 실제 위치이며 과거 계획의 줄 번호를 그대로 가정하지 않는다.

| 현재 코드 앵커 | 관찰 | 제안에 쓸 수 있는 범위 / 감도 |
| --- | --- | --- |
| Core/RouteDomain.cs:174-191, 401-419, 465-490 | 3역은 영등포-신도림-구로, 직행 없음. 성공한 엣지마다 Tick.Next(), HopCount+1 | GP-02 B의 **엣지당 한 단계** 실험 후보. 두 엣지 여행은 두 단계지만 실제 시간/속도 단위가 아니며 긴/짧은 엣지 차이를 지운다. 날짜·월·속도로 승격하지 않는다. |
| Core/CampaignTurnDomain.cs:44-60, 143-180 | MovementRules는 모든 태세의 양수 multiplier와 EdgeCost 함수를 외부에 요구한다. spent > RemainingBudget * Multiplier이면 거절 | GP-02 A의 입력 구조 참고. multiplier가 커지면 같은 예산의 통과 가능 비용이 증가한다. 현재 파일에는 수치 기본값이 없으며 예산/보정을 추정하지 않는다. 자동 월턴·명령 포인트 기본값의 근거가 아니다. |
| Core/Battle/Sim/BattleSim.cs:10-65, 133-160 | 명시 setup/context/definition/navigation을 요구하고 MoraleBase, DecisionIntervalSeconds 등을 definition에서 받는다 | GP-11의 입력 경계 참고. 실시간 판단 간격을 바꾸면 판단 빈도가 변하나 새 전투 피해 계수가 되지 않는다. 이 범위에서 1.0/1.2/0.8 피해 기본값을 얻을 수 없다. |
| Data/Repositories/BattleSetupRepository.cs:74-90, 104-118 | 저작 rules의 사기·항복·기간·판단 간격과 개별 power/HP/속도/쿨다운을 투영 | GP-11 후보를 저작할 위치이지 승인 증거가 아니다. 이동속도, 피해, 성장, 조우확률을 GP-01/02/03에 재명명하지 않는다. |

## 소유자에게 보낼 질문 묶음

각 행에서 A 또는 B를 선택하거나 수정안을 적어 달라. **규칙 선택만 승인**하며 오른쪽 미정 입력은 승인되지 않는다. 수치 계수는 원장 근거·단위·정확한 값/함수·감도·별도 소유자 응답이 생긴 뒤 필드 단위로 다시 제안한다. 묶음 전체 자동 승인/기본 선택은 없다. A/B의 UI·원장 영향은 아래에 적었다.

결정 순서: GP-01/03/04/14 → GP-02/05/06 → GP-07/08/09/10 → GP-11/12/13.

### GP-01 시작 자격·소재지

규칙 필드: `startLocationPolicy`. 출처: matrix GP-01 행; SP sp1.b8; sp1.b17.

- A `canonical-only`: 확정 소재지 근거가 없거나 충돌하면 선택 목록은 유지하되 시작 실행을 차단한다.
- B `canonical-or-explicit-scenario`: 정본 소재지를 우선하고 누락만 별도 승인 시나리오 배치로 해소한다. 충돌은 계속 차단한다.
- 영향/감도: 시작 가능한 범위가 좁아지는 대신 잘못된 스폰이 없다. B는 배치 원장과 별도 위치 승인 부담이 생긴다.
- 별도 미정 입력: 연령·구금 세부 제한, 누락/충돌 장소 원장.

### GP-02 이동·정보

규칙 필드: `travelCostPolicy`. 출처: matrix GP-02 행; SP sp1.b75; sp1.b92.

- A `authored-edge-cost`: 거리·수단·상태별 저작 비용과 태세 보정을 공급받고 미등록 경로의 시간 계산을 차단한다.
- B `poc-edge-tick`: POC의 엣지당 Tick.Next() 모델을 3역 비교 실험 후보로만 검토한다. 실제 거리·수단 대응 전 제품 적용은 차단한다.
- 영향/감도: A는 거리와 화물의 차이를 표현한다. B는 두 엣지가 두 단계가 되지만 길이·수단 차이를 지우므로 제품 계약 충족 근거가 아니다. 두 안 모두 관측 출처·취득 시각을 보존한다.
- 별도 미정 입력: 속도 단위·태세 보정·화물 보정·정보 노후화·정찰 사건.

### GP-03 명령·일정

규칙 필드: `scheduleConflictPolicy`. 출처: matrix GP-03 행; SP sp1.b11; sp1.b12; sp1.b13; sp1.b112.

- A `hold-conflict`: 배타 일정 충돌을 보류하고 원인 해소 후 같은 명령의 권한·경로·예약을 재검사한다.
- B `reject-conflict`: 충돌 명령을 이유와 함께 거절하고 변경된 일정으로 새 요청을 받는다.
- 영향/감도: A는 대기 명령과 재평가 상태를 저장해야 한다. B는 사용자의 재요청이 늘지만 예약 순서가 명료하다. 전달·수신·수락·실행은 분리하며 전투 즉시 하달은 SP 예외다.
- 별도 미정 입력: 전략 연락 시간·비용·위임 범위·수락 함수; 자동 월턴/명령 포인트 기본값은 폐기한다.

### GP-04 생활·인구·노동

규칙 필드: `laborDetailPolicy`. 출처: matrix GP-04 행; SP sp1.b8; sp1.b21.

- A `aggregate-with-transfers`: 집계 노동을 기본으로 하고 개인 명부 진입/복귀를 원인 사건으로 보존한다.
- B `named-roster`: 지원 범위의 노동을 개인 명부로 예약하며 집계와 개인 사이 전이를 기록한다.
- 영향/감도: A는 명부 크기를 줄이고 B는 특정 인물 예약 충돌을 직접 보여준다. 두 안 모두 한 인력 한 예약과 부족 손실 단일 정산을 지킨다.
- 별도 미정 입력: 소비량·임금·배급·부족의 노동/기분 영향량과 마감 순서.

### GP-05 생산·시설·건설

규칙 필드: `constructionScopePolicy`. 출처: matrix GP-05 행; SP sp1.b13; sp1.b21.

- A `repair-first`: 확정 입력이 있는 수리 단계부터 등록하고 신규 건설은 미정으로 둔다.
- B `authored-build-chain`: 저작된 신규 시설의 단계 체인까지 등록하되 필요한 노동·도구·재료가 없는 단계는 중단한다.
- 영향/감도: A는 플레이 가능한 생산 범위를 줄인다. B는 단계별 비용·기간·소유권 이전 검증이 더 필요하다. 사용한 자재 자동 환급과 수요 없는 무한 생산은 둘 다 금지한다.
- 별도 미정 입력: 자원/시설 목록·단계 비용·기간·해체 회수량.

### GP-06 화물·경제 마감

규칙 필드: `cargoSplitPolicy`. 출처: matrix GP-06 행; SP sp1.b61; sp1.b62; sp1.b65.

- A `whole-consignment`: 분할 발송을 지원하지 않고 발송 단위 전체의 검증된 도착만 마감에 포함한다.
- B `identified-splits`: 원천 화물 ID를 참조하는 분할 단위를 지원하고 각각 검증 도착·잔량을 보존한다.
- 영향/감도: A는 부분 배송이 안 된다. B는 일부 도착 재고를 쓸 수 있지만 분할 총량과 중복 도착 차단이 더 복잡하다. 같은 시각 검증 도착 후 예약·생산·소비 순서는 고정이다.
- 별도 미정 입력: 마감 주기·분할 단위·봉쇄 중 소유/보관 계약.

### GP-07 영토·작위·인준

규칙 필드: `titleActivationPolicy`. 출처: matrix GP-07 행; SP sp1.b38; sp1.b39; sp1.b40.

- A `control-only-until-canon`: 작위 입력이 없는 영역은 실효 통제만 표시하고 작위 수여·통합은 차단한다.
- B `registered-title-contracts`: 위키 확정 ID·영역·계약·인준 입력이 갖춰진 작위만 수여 경로를 연다.
- 영향/감도: A는 미배정 작위를 만들지 않는 좁은 POC다. B는 법적 권리와 운영 인수의 별도 진행을 제공한다. 점령을 권리·재산·주민 협력으로 자동 전환하지 않는다.
- 별도 미정 입력: 실제 작위령·취득/통합 비용·기간·인준 입력.

### GP-08 가변 정원·동원

규칙 필드: `overCapacityPolicy`. 출처: matrix GP-08 행; SP sp1.b31; sp1.b8.

- A `manual-reorganization`: 초과 인원을 보존하고 추가 모집/합류를 차단하며 플레이어의 실제 재편 요청을 기다린다.
- B `offer-reorganization`: 같은 보존·모집 제한 아래 분리/새 지휘관 배정 제안만 만들고 동의·자원 검사 후 실행한다.
- 영향/감도: A는 수동 관리가 많다. B는 제안 UI와 지휘관 가용성 검사가 추가된다. 자동 인원 삭제·공통 상한·미승인 초과 페널티는 없다.
- 별도 미정 입력: 지휘관 개인 입력·국가/정착지 수준의 정원 산식·재편 비용.

### GP-09 혼인·계승

규칙 필드: `successionDataPolicy`. 출처: matrix GP-09 행; SP sp1.b47; sp1.b49; sp1.b51; sp1.b54; sp1.b57.

- A `registered-institutions-only`: 기존 확정 제도 입력을 갖춘 항목만 실행하고 빈 후보/동의/인준 입력은 보류한다.
- B `author-one-institution-first`: 한 국가의 후보·동의·인준·재산 계약 입력부터 별도 저작/승인하고 그 범위만 실행한다.
- 영향/감도: A는 많은 국가가 공석/분쟁으로 남을 수 있다. B는 좁은 국가에서 검증을 마칠 수 있지만 국가별 데이터 승인을 추가로 받아야 한다. 혼인이 주장 생성이나 모든 권한 복사가 되지 않는다.
- 별도 미정 입력: 국가별 후보/선거/시험/인준·혼인 동의·영구 구금 상세.

### GP-10 기술·교육·복구

규칙 필드: `educationScopePolicy`. 출처: matrix GP-10 행; SP sp1.b70; sp1.b72; sp1.b73.

- A `one-authored-skill`: 한 기술의 교사·기록·도구·실습 필수 여부를 저작한 후 그 교육만 연다.
- B `authored-skill-catalog`: 기술별 요구를 명시한 목록을 저작하고 입력이 완전한 기술만 교육/복구한다.
- 영향/감도: A는 검증 범위가 작고 B는 콘텐츠 저작이 많다. 기록만으로 숙련 해금하지 않고 중단 시 진척을 보존하며 모든 기술에 같은 요구를 강제하지 않는다.
- 별도 미정 입력: 기술별 요구·교육 기간/비용·성과 함수·복구 조건.

### GP-11 개인 전투·자동 실행

규칙 필드: `battleResolutionPolicy`. 출처: matrix GP-11 행; SP sp1.b31; sp1.b108; sp1.b111.

- A `shared-individual-resolver`: 표현 방식과 별개로 자동/수동 모두 동일 개인 판정기를 쓰고 자동 판단 정책만 분리한다.
- B `explicit-aggregate-allocation`: 집계 계산도 쓰려면 개인별 손실 배분·중복 방지 계약을 별도 승인한 후 같은 결과 원장에 연결한다.
- 영향/감도: A는 개인별 검증량이 많다. B는 큰 부대 비용을 줄일 수 있지만 개인 손실 중복/배분 계약 없이는 실행 불가다. POC 실시간 초 단위를 턴 피해 계수로 그대로 옮기지 않는다.
- 별도 미정 입력: 명중/피해 함수·작전력 단위·장비/태세 보정·자동 정책; B 배분 계약.

### GP-12 조우·진입·퇴장

규칙 필드: `reinforcementScopePolicy`. 출처: matrix GP-12 행; SP sp1.b31; sp1.b32; sp1.b93.

- A `closed-initial-roster`: 초기 참가자만 있는 시나리오로 범위를 제한하고 후발 증원이 필요한 시나리오는 잠근다.
- B `authored-arrival-entry`: 허용 증원 조건·진입 경로·실제 도착이 모두 확인된 후발 참가자를 편입한다.
- 영향/감도: A는 증원 기능이 비활성인 좁은 POC다. B는 동시 도착/종료 경합과 초기 태세·지휘권 검사가 추가된다. 원격 관전으로 현장 참가를 만들거나 ResultId를 두 번 적용하지 않는다.
- 별도 미정 입력: 진입 지점·초기 태세·퇴로·본체 포획/이탈·종료 경합 순서.

### GP-13 외교·전쟁·강화·소멸

규칙 필드: `peaceScopePolicy`. 출처: matrix GP-13 행; SP sp1.b25; sp1.b52; sp1.b121; sp1.b122; sp1.b126; sp1.b127.

- A `registered-casus-endings`: 등록 명분의 요구 관철·백지 강화·항복·무효 종료만 지원하고 가격 미등록 개별 협상은 잠근다.
- B `registered-item-negotiation`: 가격 판본·처분 권한·이행 가능성을 갖춘 항목에 한해 중간 협상을 추가한다.
- 영향/감도: A는 협상 범위가 좁다. B는 항목별 가격과 수락 함수가 필요하며 V<=W 자동 수락은 금지다. ±100 강제 명분 종결과 조직의 비자동 소멸은 유지한다.
- 별도 미정 입력: 명분 목록/비용·휴전/배상·항목 가격/수락 계수·영토 없는 조직 소멸 조건.

### GP-14 관측·저장·세션

규칙 필드: `saveCheckpointPolicy`. 출처: matrix GP-14 행; SP sp1.b88; sp1.b89; sp1.b93; sp1.b94; sp1.b107.

- A `explicit-consistent-boundary`: 수락/결과 적용이 끝난 일관 경계의 명시 저장을 지원한다.
- B `also-authored-milestones`: 같은 일관 경계에서 저작된 행동 이정표의 자동 체크포인트도 만든다.
- 영향/감도: A는 저장 동작이 단순하고 B는 장애 시 손실 구간을 줄이지만 저장 트리거를 저작해야 한다. 둘 다 단일 캠페인, 관측자별 정보, 판본/RNG/예약/ResultId를 복원한다. 종료는 사망이나 온라인 이탈이 아니다.
- 별도 미정 입력: 자동 저장 이정표 목록·보존 정책·호환/마이그레이션 계약; 네트워크/호스트는 제외.

## 승인 계약과 검증

`gp.proposal.json`은 pending 목록이며 실행 값이 아니다. 이 버전의 검증기는 위 14개 **규칙 필드와 열거값만** 지원한다. 수치 필드를 임의 추가하면 거절한다. 계수를 등록하려면 이 패킷/허용 필드/테스트를 먼저 확장하고 재승인해야 한다. GP 범주 승인이 모든 하위 수치의 승인이 되지 않는다.

미래 gp.json은 schemaVersion:1, status:approved, rulesVersion:SP-1.0.0, proposalSha256, binding, scenarioManifestSha256, fields(정확히 14개), scenarioDecisions(정확히 네 묶음)를 요구한다. binding은 위 revision/scenarioSha256/deckSha256과 정확히 일치해야 한다. 각 GP 필드는 value와 approval {by, reference, sha256}; 각 scenarioDecisions 항목은 value, details, approval을 갖는다. details는 선택 slice의 실제 배치·권원·시간/표현·원격 표시·철회/유지 계약 등 명시 입력 또는 검토 가능한 저작 참조를 실제 응답 그대로 남긴다. 옵션 이름만으로 공백을 닫지 않는다.

승인 reference는 gp.json 기준 실제 응답 JSON 경로이며 sha256은 그 바이트 해시다. 응답은 schemaVersion:1, role:owner, actor, rawResponse, proposalSha256, binding, scenarioManifestSha256, decisions(14 GP 값), scenarioDecisions(각 value/details)를 요구한다. 각 값과 details가 응답에 정확히 묶여야 한다. 로컬 검증기는 신원을 인증하지 않는다. 운영자는 실제 사용자 메시지에서만 원문을 옮겨야 하며 TEST-ONLY fixture는 신원/실제 승인 증거가 아니다. 외부의 실제 응답 수집 없이는 gp.json을 만들지 않는다.

현재 proposal SHA-256: aead414fca65272e138b70841f38f61c3ceb4d990ddc6a301c15ef1efacbbbfd; 별도 manifest SHA-256: 3c46f6f33443cded1af47a74b7a420a4706efd59845a0fc4591e237821602ad4. 승인값이 아닌 바이트 결속이다. 두 실제 응답의 입력 proposal 해시 ca39d29edc09a78b00f7a8ab545e1f3cd10eb56c13707ba84d3c55652b464684는 질문 당시의 역사적 근거이며 현재 proposal의 해시로 바꾸지 않는다. receipt를 가리키는 proposal과 receipt 사이에 현재 바이트 해시 순환을 만들지 않는다. proposal/manifest/시나리오/deck/판본 변경은 재검토·재승인을 요구하며 validator의 명시 lock 변경 없이 stale 결속을 재해시해 통과시킬 수 없다. 수치는 여전히 미정이다.

기본 node scripts/tools/gp-params-validate.mjs는 gp.json 부재로 exit 1, --params game/data/params/gp.proposal.json도 pending이므로 exit 1이다. .js도 동일 CLI다. 지원 인자는 --params, --proposal, --gdd-root, --poc-root, --scenario-root뿐이다. 기본 scenario-root는 프로젝트의 .omo/evidence/seoul-dengoku-jrpg/task-33이며 다른 환경에서는 reviewed scenario-data.json과 deck-v2/index.html을 그 루트 아래 제공한다. 자료가 없거나 source 해시가 달라도 실패한다.

검증: node --test scripts/tools/test/gp-params-validate.test.mjs. 성공 fixture는 mkdtemp 내 TEST-ONLY 응답/원천/시나리오 복사/파라미터이며 t.after로 자신이 만든 디렉터리만 정리한다. 실제 pending CLI는 nonzero다. task 26 및 종속 수치 기능은 열림/비활성이다.
