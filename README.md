# seoul-dengoku-jrpg

서울:전국 JRPG — [Seoul Subway States](https://seoul-dengoku.linalab.io/wiki/) 세계관을 2D JRPG로 구현하는 프로젝트.

- Base engine: [openrpgmaker fork](https://github.com/islee23520/openrpgmaker) (TypeScript / Vite / Electron)
- Design corpus: seoul-dengoku (Unity 4X RPG) · seoul-dengoku-wiki (world canon) · seoul-dengoku-gdd (design canon)
- Engineering reference: [U7Revisited](https://github.com/islee23520/U7Revisited) (Ultima VII engine study)
- Feel references: Crusader Kings III · classic 삼국지 (Koei RTK) · 원조비사 · 대항해시대4 (Uncharted Waters IV)
- Assets: sourced from asset stores, sampled/remixed into engine formats (license-audited)

## Status — S01 영주 캠페인과 실제 범위 (오너 핸드북)

S01 조사편 캠페인(양천 공작령 · 이서담/K002, 가신 백산석/K568 · 성달현/K616)이
생산 진입점이다. 배포 산출물에서 `/`(= `campaign.html`)가 캠페인 시작 화면이고,
구 지도 미리보기는 같은 산출물의 `legacy/` 경로에 명시적으로 남아 있다.
전투·경제·채용·전 도시 밸런스 등 나머지 게임은 이번 승인 범위 밖이며 이 빌드가
완성된 전체 게임이라고 주장하지 않는다.

### 지금 접근 가능한 주소 (미리보기 배포 — 생산은 그대로)

- https://campaign.seoul-dengoku-jrpg.pages.dev — 오너 지정 미리보기 별칭 (branch `campaign`)
- https://campaign-map.seoul-dengoku-jrpg.pages.dev — 같은 산출물의 브랜치 별칭 (branch `campaign-map`)
- 생산 https://seoul-dengoku-jrpg.pages.dev — 캠페인 이전 지도 미리보기(deployment
  `cadc43fb`)가 그대로 살아 있다. 최종 게이트(F1–F4)와 오너의 별도 릴리스 승인 전까지
  변경하지 않는다. 이것이 롤백 기준점이다.

두 미리보기와 로컬 검증 산출물은 동일 빌드다 — buildId
`32aab3c679c87d5e715bcb69e7de106ea95876f92db52c76f55ffacc2b34e21b`
(source commit `eb9773d`, engine pin `6d4907e…`, patch `4c734323…`,
source manifest `5d97dfaa…`, operations `08465058…`; 전체 값과 원격 바이트·실재
플레이 증거는 `hosting/README.md`와 `.omo/evidence/seoul-dengoku-campaign-map/`
의 `task-19/follow-up-redeploy/`, `task-19/followup-eb9773d/`, 독립 검증
`task-23-unity-ui/final-eb9773d/` 참고. `.omo` 증거는 저장소에 커밋되지 않는다).

### S01 정직한 한계

- 승인된 S01 운영값만 사용한다: 평시 정지·1/2/4배속(1실제 초 = 6세계 초),
  Eclose 예정 3600세계 초 / 지원 한계 5400세계 초.
- 5400세계 초 지원 만료 후에도 시계가 자동으로 정지하지 않는다. 만료 상태를
  표시하고 새 미지원 행위만 거부하며, 원본 반납·보고 의무는 남는다
  (자동 구조·사망·보상 창작 없음).
- 복구는 사용자가 명시 저장한 경계까지만 보장한다. 자동저장·오프라인 시간
  적립·저널 복구는 없다.
- 세이브는 `seoul-composed-campaign-v2` 명시 체크포인트. 구판(v1)은 인증된
  exact/alias 신원만 대응되고, 제외·모호·전투 상태는 전체 격리 후 원본 내보내기로
  처리한다(자동 리셋 금지). 계약: `docs/campaign-saves.md`.
- 전 게임 밸런스 수치는 어디에도 승인된 적이 없다. S01 한정 운영안
  (`section2-route-r2-pending-ratification` 타임라인 포함)만 게임 데이터로 쓴다.

### 이어받는 개발자 최소 경로 (fresh clone)

Node 24.15 이상, 읽기 전용 위키 체크아웃(예: `../seoul-dengoku-wiki`), 체크아웃
밖의 외부 증빙 맵(`ASSET_PROOF_MAP`)이 필요하다. 어느 하나라도 누락하면 명확한
오류로 실패한다 — 대체 자료로 green fallback하지 않는다.

```sh
git clone --recurse-submodules git@github.com:islee23520/seoul-dengoku-jrpg.git
cd seoul-dengoku-jrpg
(cd engine && npm ci --ignore-scripts --no-audit --no-fund)
node scripts/tools/build-campaign-game.mjs --out ../campaign-dist   # buildId 32aab3c6… 재현
CAMPAIGN_MANIFEST=game/data/campaign/source-manifest.json \
ASSET_PROOF_MAP=/absolute/external/proof-map.json \
WIKI_ROOT=/absolute/path/to/seoul-dengoku-wiki \
bash scripts/gate-campaign.sh --artifact ../campaign-dist --evidence <evidence-dir>
```

게이트는 원천 선택자·(WIKI_ROOT 지정 시) 실위키 패리티·운영 팩·도메인/마이그레이션
스위트·타입체크·산출물 검증·에셋 증빙·레거시 회귀와 실브라우저 QA
(`campaign-entry`, `s01-sequential`, `save-reload`)를 한 번에 수행한다. 실제
fresh-clone 실행 기록: `.omo/evidence/seoul-dengoku-campaign-map/task-20/`.
세부 계약 — 빌드/배포: `hosting/README.md`, `docs/gate-validation.md`,
`docs/campaign-pages-deploy.md`; 원천 추출: `docs/campaign-source-selectors.md`,
`docs/campaign-content-import.md`; 세이브: `docs/campaign-saves.md`.
`vercel.json`도 같은 `campaign-dist` 빌드를 가리키지만, 현재 라이브 배포 경로는
위 Cloudflare Pages 미리보기이며 생산은 손대지 않았다.

## License

TBD — sampled-asset licensing audit in progress; nothing here is cleared for redistribution yet.
