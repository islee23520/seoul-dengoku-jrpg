# seoul-dengoku-jrpg

서울:전국 JRPG — [Seoul Subway States](https://seoul-dengoku.linalab.io/wiki/) 세계관을 2D JRPG로 구현하는 프로젝트.

- Base engine: [openrpgmaker fork](https://github.com/islee23520/openrpgmaker) (TypeScript / Vite / Electron)
- Design corpus: seoul-dengoku (Unity 4X RPG) · seoul-dengoku-wiki (world canon) · seoul-dengoku-gdd (design canon)
- Engineering reference: [U7Revisited](https://github.com/islee23520/U7Revisited) (Ultima VII engine study)
- Feel references: Crusader Kings III · classic 삼국지 (Koei RTK) · 원조비사 · 대항해시대4 (Uncharted Waters IV)
- Assets: sourced from asset stores, sampled/remixed into engine formats (license-audited)

## Status

S01 영주 캠페인(양천, 이서담)이 생산 진입점이다. 빌드는
`node scripts/tools/build-campaign-game.mjs --out campaign-dist`, 검증은
`bash scripts/gate-campaign.sh` (외부 `CAMPAIGN_MANIFEST`·`ASSET_PROOF_MAP` 필요).
배포 산출물은 `campaign-dist`이며 `vercel.json`이 같은 빌드를 가리킨다.
계약 세부사항은 `hosting/README.md`와 `docs/gate-validation.md` 참고.

## License

TBD — sampled-asset licensing audit in progress; nothing here is cleared for redistribution yet.
