/** Public map-only projection; never writes back into production. */
export function createMapPreview(source) {
  if (source.database.actors.length || source.session.partyActorIds.length) throw new Error('Preview requires the actorless map source; review production changes explicitly.');
  const project = structuredClone(source);
  project.meta = {title:'지도 미리보기 — 비정식 탐색 표식', author:'', terms:{}};
  project.villageInfoDocuments = [];
  const actorId='public-map-navigation-marker';
  const classId='public-map-navigation-only';
  project.database.actors=[{id:actorId,name:'비정식 탐색 표식',nickname:'인물 아님 · 지도 탐색 전용',classId,initialLevel:1,maxLevel:1,characterResourceId:'easyrpg-charset-object2',characterIndex:5,characterTransparent:false}];
  project.database.classes=[{id:classId,name:'지도 탐색 전용 (직업 아님)'}];
  project.system.startActorIds=[actorId];
  project.system.titleScreen={title:"지도 미리보기",subtitle:"비정식 탐색 표식 · 정식 게임 아님",menuLabels:{newGame:"지도 탐색"}};
  project.session.partyActorIds=[actorId];
  return project;
}
