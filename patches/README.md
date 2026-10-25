# patches/

**엔진 수정은 patches/ 디렉토리의 패치 파일로만 관리합니다.**

## 정책 (Patch Policy)

- engine/ 디렉토리는 **절대 직접 수정하지 않습니다**.
- 모든 엔진 수정은 `patches/` 아래의 패치 파일(.patch)로 관리해야 합니다.
- 각 패치는 다음 정보를 반드시 포함합니다:
  1. **적용 대상 엔진 커밋** (git commit hash)
  2. **패치 이유** (왜 이 수정이 필요한가)
  3. **Project-data / plugin 경계로 해결할 수 없었던 이유**

## 예시 패치 헤더

```patch
# engine: v0.1.2 (abc1234)
# reason: UI scaling bug on 4K displays in Seoul map
# boundary: Cannot be covered by data-driven plugin system (core rendering loop)
```

이 규칙을 위반하는 모든 engine/ 수정은 거부됩니다.
