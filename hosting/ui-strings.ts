/** Verbatim subset of Unity GAME/Assets/Janseon/Data/Localization/Source/ui-strings.json (ko-KR)
 * for the ported opening surfaces. Do not edit values here; change the Unity source and re-copy. */
export const uiStrings = {
  "ui.main-title.mark": "서울:전국",
  "ui.main-title.sub": "Seoul Subway States",
  "ui.main-title.enter": "아무 키나 누르세요",
  "ui.main-menu.heading": "서울:전국",
  "ui.main-menu.new-game": "새 게임",
  "ui.main-menu.continue": "이어하기",
  "ui.main-menu.save-status.empty": "저장된 기록이 없다",
  "ui.main-menu.settings": "설정",
  "ui.main-menu.quit": "종료",
  "ui.main-menu.account": "열쇠",
  "ui.main-menu.placeholder-note": "준비 중인 항목",
  "ui.main-menu.back": "뒤로",
  "ui.character-select.title": "인물을 선택한다",
  "ui.character-select.back": "뒤로",
  "ui.character-select.confirm": "이 인물로 시작한다",
  "ui.character-select.label.start": "시작역",
  "ui.character-select.label.liege": "직속 주군",
  "ui.character-select.count": "{0}명",
  "ui.character-select.loading": "불러오는 중",
  "ui.character-select.error": "인물 목록을 불러오지 못했다.",
  "ui.character-select.dialog.title": "{0}(으)로 시작한다",
  "ui.character-select.dialog.state": "소속",
  "ui.character-select.dialog.start": "시작지",
  "ui.character-select.dialog.titles": "작위",
  "ui.character-select.dialog.cancel": "취소",
  "ui.character-select.dialog.start-action": "시작",
  "ui.character-select.dialog.hint": "← → 선택 · Enter 실행",
  "ui.key.cancel": "Esc",
  "ui.key.submit": "Enter",
  "ui.key.move": "↑↓",
} as const;
export type UiStringKey = keyof typeof uiStrings;
export const t = (key: UiStringKey, ...args: string[]): string =>
  args.reduce<string>((text, value, index) => text.replace('{' + index + '}', value), uiStrings[key]);
