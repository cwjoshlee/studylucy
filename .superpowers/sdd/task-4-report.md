# Task 4 구현 보고서 — 보호자 AI 학습실

## 결과와 커밋

- 커밋: `46df768677d1b2d8b84ce505d25cfe30dbd0fb39`
- 메시지: `feat: add guardian AI learning studio`
- 기존 Task 1–3 서버 계약을 변경하지 않고 보호자 클라이언트 UI와 API 연결만 추가했다.

## 변경 파일

- `src/client/api/client.ts`
- `src/client/guardian/ai-learning-studio.tsx`
- `src/client/guardian/guardian-dashboard.tsx`
- `src/client/styles/components.css`
- `tests/client/api-client.test.ts`
- `tests/client/guardian-dashboard.test.tsx`

## 구현 내용과 설계 결정

- 기존 `AI 코치` 보호자 탭을 `AI 학습실`로 교체하고 대시보드가 선택한 AI 패널 상태를 유지한다.
- AI 설정, 문제 생성, 보고서의 정확한 3단계 트리를 추가했다. 부모와 잎은 `treeitem`/`group` 계층을 사용하고 로빙 포커스, 방향키, Home/End, 펼침·접기, Enter 활성화를 지원한다.
- 탭을 나갔다 돌아와도 선택한 패널, 선택 잎, 열린 상위 그룹이 일치하도록 `panel`에서 트리 상태를 복원한다.
- Gemini/OpenAI 제공자 카드는 사용 여부, 모델, 키 저장 여부를 표시한다. 키 원문은 조회·미리 채움·텍스트·로그·영속 상태에 넣지 않고 성공 저장 후 입력을 비운다.
- 두 제공자가 모두 활성화되고 키가 저장된 경우에만 초안 생성 버튼을 활성화한다.
- 수학/국어 배치 입력은 단계, 개수, 난이도, 약점 유형을 서버의 `AiBatchRequest` 그대로 전송한다.
- 감리 탈락 항목은 수정 UI와 발행 후보에서 제외한다. 통과 항목은 공유 Zod payload 스키마로 재검증한 뒤 전체 payload를 PATCH하고, 초안 발행은 별도 동작으로 유지한다.
- 오늘/주간 보고서는 기간을 계산해 Task 3 보고서 API를 호출하고 `llm`/`local` 출처를 표시한다.
- 학습 계획에 국어·수학 난이도 1–5와 도전 만점 보너스 0–5 선택을 추가하고 기존 목표/쉬는 날 필드와 함께 `subjectSettings`로 저장한다.
- 보호자 탭 버튼은 좁은 폭에서도 줄바꿈과 최소 폭 0을 사용해 텍스트가 잘리지 않게 했다.
- 새 메서드는 `ClientApi`의 단계적 optional capability로 두되, 보호자 화면에서 모든 AI Studio 메서드가 존재하는지 명시적으로 확인한다. 실제 `ApiClient`는 모든 Task 3 경로를 구현한다.

## TDD 증거

첫 RED 실행:

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/client/guardian-dashboard.test.tsx tests/client/api-client.test.ts
```

예상한 이유로 5개가 실패했다: AI 학습실 탭/트리와 일일 난이도 선택이 없고, `ApiClient`에 AI Studio 메서드가 없었다.

검토 회귀 RED:

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/client/guardian-dashboard.test.tsx
```

새 회귀 1개가 부모 `treeitem` 부재로 실패했다. 패널 재진입 상태 동기화와 완전한 키보드 트리 동작을 구현한 뒤 GREEN으로 전환했다.

## 최종 검증

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/client/guardian-dashboard.test.tsx tests/client/api-client.test.ts
npx --yes -p node@22 -p npm@11.11.0 -- npm run typecheck
git diff --check
```

- focused: 2 files, 56/56 passed
- TypeScript: `tsc --noEmit` passed
- whitespace: passed

추가 전체 회귀:

```bash
npx --yes -p node@22 -p npm@11.11.0 -- npm test
```

- 39 files, 579/579 passed (접근성 후속 회귀 추가 전 실행; 후속 변경은 지정 focused 56/56과 typecheck로 재검증)

읽기 전용 후속 검토는 패널/트리 상태와 ARIA 트리 키보드 모델 두 중요 지적이 모두 해결됐다고 PASS 판정했다.

## 남은 우려

- Task 3 공개 설정 응답에는 제공자별 또는 공통 예산 금액/사용량 숫자가 없으므로 `월 예산·사용량` 잎은 서버 공통 한도라는 안내만 표시한다. 임의의 숫자나 별도 클라이언트 권위를 만들지 않았다.
- 실제 외부 Gemini/OpenAI 호출은 이 클라이언트 Task에서 수행하지 않았다. 생성·감리·발행 안전성은 Task 3 서버가 계속 권위 있게 검증한다.
- 기존 untracked `.DS_Store`는 수정·stage·commit하지 않았다.

## 후속 보강 — 발행 경합, 트리 재진입, 보고서 동작

- 기준 커밋: `46df768677d1b2d8b84ce505d25cfe30dbd0fb39`
- 발행 버튼은 자식 항목 PATCH 저장이 진행 중이면 비활성화하고, 저장 중인 이전 payload를 발행하지 않도록 회귀 테스트를 추가했다.
- 설정의 세 잎(제공자·모델, API 키, 월 예산·사용량)은 모두 같은 `settings` 패널을 사용하지만, 선택 잎과 열린 그룹을 `GuardianDashboard`가 보유하여 AI 학습실 탭 재진입에도 보존한다.
- 오늘/주간 보고서 잎 클릭은 KST 오늘 및 최근 7일 날짜 범위 호출, `local`/`llm` 출처 표기, 오류 경고를 UI 회귀로 검증한다.
- 검증: `guardian-dashboard.test.tsx` 및 `api-client.test.ts` 60/60 통과, `tsc --noEmit` 통과, `git diff --check` 통과.
- 기존 untracked `.DS_Store`는 계속 수정·stage·commit하지 않았다.

## P2 후속 수정 — AI 학습실 공개 컴포넌트 계약

- `AiLearningStudio`의 승인된 공개 props(`api`, `panel`, `onPanelChange`)를 복구했다. `treeState`와 `onTreeStateChange`는 선택적 persistence props가 되었고, 둘 다 전달될 때만 제어 모드로 동작한다.
- persistence props가 없거나 불완전하면 패널에 맞춘 내부 트리 상태를 사용한다. `GuardianDashboard`의 기존 제어 상태 전달은 그대로 유지한다.
- TDD RED: 승인된 세 props만 사용한 직접 렌더가 `treeState.openGroups` 접근으로 실패하는 것을 확인했다. GREEN: 직접 소비자 렌더와 제어 상태의 수학 배치 선택을 검증하는 focused 테스트를 추가했다.
- 검증: `ai-learning-studio.test.tsx` + `guardian-dashboard.test.tsx` 37/37 통과, `tsc --noEmit` 통과, `git diff --check` 통과.
- 기존 untracked `.DS_Store`는 수정·stage·commit하지 않았다.
