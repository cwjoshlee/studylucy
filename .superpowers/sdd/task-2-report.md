# Task 2 구현 보고서

## 결과

서버 권위의 국어·수학 `foundation → current → challenge` 일일 계획, 도전 오답 완료 처리, 과목별 도전 만점 보너스, forward-only 콘텐츠 v4를 구현했다.

커밋: `4c7cccd feat: issue step-up daily learning plans`

## 구현 내용

- 보호자 과목 설정에 난이도 1–5와 도전 보너스 0–5별을 추가했다.
- 기존 `koreanTarget`/`mathTarget` 입력은 계속 파싱하고 응답에도 남겨 구 보호자 클라이언트 호환성을 유지했다.
- 과목별 난이도에서 단계 목표를 `difficulty - 1`, `difficulty`, `difficulty + 1`로 계산하고 1–5로 제한한다.
- 같은 목표 레벨에서는 최근 오답 unit/mode, 단계 적합도, 날짜 기반 안정 순서로 후보를 선택한다.
- 매일 국어 3개와 수학 3개를 서로 다른 항목으로 발행하고 `daily_requirements.step`을 `issued_plan_items.step`에 복사한다.
- 발행된 계획은 필수 6개 항목과 당시 콘텐츠 버전·단계를 스냅샷으로 유지하며 복구 계획에도 그대로 복사한다.
- 유효한 challenge 제출은 정답 여부와 무관하게 `completed = true`로 저장한다. foundation/current 오답은 계속 미완료다.
- 받아쓰기는 NFC 정규화와 공백 축약으로 채점하며 DB에는 `dictation_pass`와 `completed`만 저장한다. 원문 제출 문자열은 저장하지 않는다.
- 과목의 모든 발행 challenge 항목에 완료·통과 시도가 있을 때만 보너스를 지급한다.
- 보너스 source key는 `challenge-perfect:{studentId}:{studyDate}:{subject}`이며 동일 요청 재생은 최초 receipt를 복원하고 원장 이벤트를 추가하지 않는다.
- 휴식일은 요구사항과 발행 항목이 없고 보너스 자격도 생기지 않는다.

## 콘텐츠 v4와 호환성

- 기존 20개 항목의 v1, v2, v3 JSON은 변경하지 않았다.
- 기존 20개 항목은 동일 payload의 v4를 `INSERT OR IGNORE`로 추가했다.
- v4-only 국어 받아쓰기 3개를 추가했다: 낱말 foundation, 낱말 current, 짧은 문장 challenge.
- 기존 계산 payload 10개를 v4 후보로 승격해 세 수 혼합 계산과 두 자리 덧셈·뺄셈을 모든 수학 단계에서 선택할 수 있게 했다.
- 승격 조건은 `active_version < 4`라서 v4 이상 보호자 작성 버전을 덮거나 내리지 않는다.
- 기존 발행 계획과 복구 계획은 저장된 `content_version`과 `step`을 계속 사용한다.

## TDD와 검증

RED에서 다음 세 실패를 확인했다.

- `INITIAL_CONTENT_VERSION`이 3이라 v4 기대 실패
- 보호자 응답에 `subjectSettings`가 없어 실패
- challenge 단계가 발행되지 않아 항목 조회 실패

GREEN 및 최종 검증:

- 포커스: `tests/server/learning.test.ts`, `tests/server/star-learning.test.ts`, `tests/server/content-parity.test.ts` — 41/41 통과
- 전체: 38 files, 553/553 통과
- TypeScript: `tsc --noEmit` 통과
- `git diff --check` 통과

전체 회귀 fixture는 새 canonical 6개 계획, 받아쓰기 정답 입력, seed v4/보호자 v5 경계를 반영하도록 갱신했다.

## 자체 리뷰

- client가 보낸 단계는 입력 계약에 없고 발행 스냅샷만 채점에 사용한다.
- challenge 오답도 일반 완료 별을 한 번만 받는다.
- 보너스 자격은 `completed = 1`만으로 판단하지 않고 과목별 pass boolean도 요구한다.
- 보너스와 일반 별, attempt, attempt receipt, cursor는 동일 상위 트랜잭션에서 처리되어 receipt 저장 실패 시 함께 롤백된다.
- 같은 날짜 여러 기기와 recovery 계획은 동일 source key로 보너스를 중복 지급하지 않는다.
- 과거 요청 재생의 보너스 자격은 현재 상태가 아니라 해당 attempt rowid 시점까지의 통과 기록으로 복원한다.
- 같은 받아쓰기 request ID는 원문을 비교·저장하지 않고, 재평가한 pass/fail boolean이 저장된 결과와 같은 경우에만 중복으로 인정한다.
- `.DS_Store`는 수정하거나 stage하지 않았다.

## 우려 사항

없음. 보호자/학생 화면에서 새 설정과 단계 잠금 상태를 표현하는 작업은 후속 Task 범위로 남겨 두었다.

---

## Task 2 리뷰 수정 보고서

리뷰에서 확인된 발행 후보 경계와 받아쓰기 중복 검증 결함을 Task 2 범위 안에서 수정했다.

### 발행 후보 안전성

- 국어 foundation/current 후보는 published `korean-dictation`의 `word` mode만, challenge 후보는 `sentence` mode만 허용한다.
- 필요한 국어 유형이 없으면 읽기 콘텐츠로 대체하지 않고 `DAILY_STEP_ITEM_MISSING:{subject}:{step}` 오류로 전체 발행 트랜잭션을 중단한다.
- 수학 후보는 발행 경계에서 `isCalculationItem`이며 계산 연산자가 `+`/`-`뿐인 콘텐츠로 제한한다.
- 난이도 5의 보호자 작성 곱셈 story가 published 상태여도 일일 계획에 포함되지 않는 회귀 테스트를 추가했다.

### 받아쓰기 중복 검증과 비저장 계약

- additive migration 008을 등록하고 `attempts.dictation_input_fingerprint` nullable 열을 추가했다. 기존 attempt 행과 migration은 재작성하지 않는다.
- 신규 받아쓰기 attempt에는 NFC/공백 제거 정규화 입력의 SHA-256 hex만 저장한다.
- 동일 `clientAttemptId` 재사용은 저장된 지문과 현재 정규화 입력의 지문이 같을 때만 duplicate로 인정한다. 따라서 서로 다른 두 오답은 모두 `dictation_pass = false`여도 거부한다.
- 같은 정규화 입력은 유효한 duplicate이며, 일반 읽기/수학의 기존 canonical 비교는 변경하지 않았다.
- 지문은 내부 중복 검증 쿼리에서만 읽고 API receipt, view, 로그, 오류 payload에는 포함하지 않는다. 원문 받아쓰기 입력은 SQLite에 저장하지 않는다.
- 008 이전 받아쓰기 행은 복구할 원문이 없으므로 지문을 NULL로 보존하며, 해당 과거 ID의 받아쓰기 재사용은 안전하게 거부한다.

### TDD와 검증

RED에서 다음 실패를 확인했다.

- 난이도 5 국어 foundation/current/challenge가 모두 읽기 콘텐츠로 발행됨
- 문장 받아쓰기 부재 시 challenge가 읽기 콘텐츠로 대체됨
- 난이도 5의 published 보호자 작성 곱셈 story가 수학 계획에 발행됨
- 서로 다른 받아쓰기 오답이 동일 요청 ID에서 200 duplicate로 인정됨
- migration 수와 fingerprint 열 검증 실패

GREEN 및 최종 검증:

- 포커스 서버/마이그레이션: 5 files, 56/56 통과
- 전체: 38 files, 557/557 통과
- TypeScript: `tsc --noEmit` 통과
- `git diff --check` 통과

### 우려 사항

없음. UI, AI Studio, 반응형 작업과 `.DS_Store`는 수정하지 않았다.

---

## Task 2 리뷰 수정 보고서: 적응형 후보 우선순위

리뷰에서 지적된 후보 정렬 순서를 Task 2 발행 경계에서 수정했다.

- 하드 타입 필터(국어 단어/문장 받아쓰기 단계, 수학 `+`/`-` 계산)는 변경하지 않았다.
- 후보 우선순위는 정확히 최근 실패 unit/mode 일치 여부 내림차순, 목표 레벨 거리 오름차순, 날짜 기반 안정 셔플 순서가 되었다.
- 따라서 허용 범위의 더 먼 레벨이라도 최근 오답 unit/mode이면 가까운 비오답 후보보다 먼저 발행된다.
- 승인된 목표 레벨 산식은 변경하지 않았다: foundation `clamp(difficulty - 1, 1, 5)`, current `difficulty`, challenge `clamp(difficulty + 1, 1, 5)`.

### 회귀 검증

- 실제 일일 계획 발행 경로에서 수학 2단계 비오답 후보와 4단계 최근 오답 후보를 함께 만들고, foundation(목표 2단계)이 4단계 최근 오답 후보를 선택함을 검증했다.
- RED: 기존 정렬에서는 가까운 2단계 `ranking-close`가 선택되어 실패했다.
- GREEN: `ranking-recent-failed`가 선택된다.
- 집중 서버 테스트: `learning.test.ts`, `star-learning.test.ts`, `content-parity.test.ts` — 46/46 통과.
- TypeScript: `tsc --noEmit` 통과.
- 전체: 38 files, 558/558 통과.
- `git diff --check` 통과.

### 우려 사항

없음. AI/UI/offline 및 `.DS_Store`는 수정하거나 stage하지 않았다.
