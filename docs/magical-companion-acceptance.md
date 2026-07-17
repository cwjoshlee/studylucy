# 마법 동물 학습 친구 인수 기록

| 설계 | 요구사항 | 자동 증거 | 상태 |
|---|---|---|---|
| 1 | 목적과 성공 경험 | `tests/client/login-and-home.test.tsx`; `tests/client/learning-session.test.tsx` | PASS |
| 2 | 범위와 비범위 | `tests/server/content-delight.test.ts` 정적 모듈 감사 | PASS |
| 3 | 저작권과 어린이 안전 | `tests/server/content-delight.test.ts` 문구 감사 | PASS |
| 4 | 네 오리지널 친구 | `tests/client/companion-components.test.tsx` | PASS |
| 5 | 상태별 유머 계약 | `tests/shared/companions.test.ts`; `tests/client/learning-session.test.tsx` | PASS |
| 6 | 홈·학습·반응형 화면 | `tests/client/login-and-home.test.tsx`; `tests/client/learning-session.test.tsx` | PASS |
| 7 | 국어·수학 인지 부담 완화 | `tests/client/problem-breakdown.test.tsx` | PASS |
| 8 | 선택형 delight 콘텐츠 모델 | `tests/shared/companions.test.ts`; `tests/server/content-delight.test.ts` | PASS |
| 9 | 순수 데이터와 표현 경계 | `tests/server/content-delight.test.ts` 순수 모듈 네트워크 감사 | PASS |
| 10 | 서버 권위 데이터 흐름 | `tests/client/learning-session.test.tsx`; `tests/server/star-learning.test.ts` | PASS |
| 11 | 오류와 대체 동작 | `tests/client/companion-components.test.tsx`; `tests/client/auth-offline-lifecycle.test.tsx` | PASS |
| 12 | 성능·오프라인·PWA | `tests/client/companion-components.test.tsx`; `tests/offline/pwa-config.test.ts` | PASS |
| 13 | 자동·브라우저 인수 기준 | Node 22 `npm run check`; Task 8 localhost 브라우저 | PENDING |
| 14 | 완료 판단 | 이 표의 자동·localhost 행과 최종 clean-tree 검사 | PENDING |

| 실행 환경 | 증거 | 상태 |
|---|---|---|
| localhost 자동 검사 | Node 22 `npm run check` | PASS |
| localhost 브라우저 | `ac9d935b60dfa281383c5cf463a12ed6ec73f337` 이후 전체 재검증 필요 | NOT RUN |
| 실제 Galaxy Tab | 실제 기기 확인 필요 | NOT RUN |
| Synology NAS | NAS 배포 뒤 확인 필요 | NOT RUN |
| 외부 HTTPS·DDNS·443 | 외부망 확인 필요 | NOT RUN |
| DSM 운영 게이트 | DSM에서 확인 필요 | NOT RUN |

## 자동 검사 기록

- 실행 환경: Node `v22.23.1`, npm `11.11.0`
- `npm run check`: TypeScript 검사, Vitest 34개 파일·447개 테스트, Vite 클라이언트 빌드와 tsup 서버 빌드 통과
- 추가 검사: `bash -n scripts/*.sh`, `git diff --check`, `git diff --check 05804ed..HEAD` 통과
- 비차단 경고: Vite가 축소 후 500 kB를 넘는 청크를 보고함
- 비차단 경고: PWA 서비스 워커 빌드가 `inlineDynamicImports` 사용 중단 예정 경고를 보고함

## 이전 localhost 브라우저 검사 기록 (대체됨)

아래 기록은 `55618586acc00e2a9b2bdf99603df9c72a4dc569`에서 수집했으며, 이후 브라우저-visible authority 경계가 바뀌었으므로 현재 localhost PASS 증거로 사용하지 않는다.

- 검증한 구현 HEAD: `55618586acc00e2a9b2bdf99603df9c72a4dc569`
- 최종 QA 실행: fresh DB를 사용한 headed Chromium, localhost Vite `5173` + Fastify `8787`
- 서버 권위 확인: 별 적립 가능 국어·수학 정답 각각에서 `POST /api/student/attempts` 응답이 `completed=true`, `duplicate=false`, `starAward.awarded=true`였고, 응답에 따라 봉봉과 별 보상이 표시됨
- 전환 확인: 정답 보상 표시 1,050ms 뒤 보상은 사라지고 단일 친구 말풍선이 `next` cue로 바뀌며 다음 문제 버튼이 활성화됨
- 콘솔 관찰: fresh setup 전 `/api/auth/me`의 예상된 409 두 건과 누락된 `favicon.ico` 404 한 건 외에 학습 흐름 API는 모두 2xx였음

| 뷰포트·상태 | 스크린샷 | 관찰 결과 |
|---|---|---|
| 1368×912 홈 | `output/playwright/home-1368x912.png` | 서로 다른 친구 4명, 활성 친구 1명, 말풍선 1개, 필수 카드의 친구·사건·별 상태·48px 이상 시작 버튼, 별 현황과 `마법 걸음`을 확인함. 겹침·잘림·가로 스크롤 없음 |
| 1600×900 홈 | `output/playwright/home-1600x900.png` | 넓은 landscape에서 친구 무대·필수 학습·오른쪽 별/걸음 rail이 분리되고 모든 핵심 텍스트와 조작이 보임 |
| 1600×900 국어 열림 | `output/playwright/korean-open.png` | `낱말 수첩이 풍덩`의 또또 humor cue, 두 문장, 한국어 낱말 token, 펼침/접힘 가능한 낱말 힌트와 직접 입력 경로를 확인함 |
| 1600×900 국어 재시도 | `output/playwright/korean-retry.png` | 불완전 transcript에 별이 지급되지 않고, 빠진 낱말을 구체적으로 안내하는 non-humor retry cue를 확인함 |
| 1600×900 국어 정답 | `output/playwright/korean-correct.png` | 전체 transcript 정답의 서버 receipt에 따라 봉봉 humor cue와 별 1개 보상이 함께 표시됨 |
| 1600×900 수학 열림 | `output/playwright/math-open.png` | `우당탕 축하 모자`의 이야기, 수 15·5, 구할 것, 단위 `개`가 분리되어 보이고 읽기 확인 전 답 입력이 비활성임 |
| 1600×900 수학 재시도 1 | `output/playwright/math-retry-1.png` | 첫 오답에서 `별 모자 15개와 양말 모자 5개를 더해 봐요.` checkHint와 non-humor cue를 확인함 |
| 1600×900 수학 재시도 2 | `output/playwright/math-retry-2.png` | 두 번째 오답에서 `두 수 15과 5를 찾아 표시해 봐요.` number search 단계와 non-humor cue를 확인함 |
| 1600×900 수학 재시도 3 | `output/playwright/math-retry-3.png` | 세 번째 오답에서 `어떤 계산을 할지 말해 봐요.` operation naming 단계와 non-humor cue를 확인함 |
| 1600×900 수학 재시도 4 | `output/playwright/math-retry-4.png` | 네 번째 오답에서 `말한 방법으로 차근차근 계산해 봐요.` calculation 단계와 non-humor cue를 확인함 |
| 1600×900 수학 정답 | `output/playwright/math-correct.png` | 정답 20의 서버 receipt에 따라 봉봉 humor cue와 별 1개 보상이 함께 표시됨 |
| 800×1280 portrait 홈 | `output/playwright/home-portrait-800x1280.png` | header → 가로 친구 strip → 필수 학습 → 별/걸음 → 선택 학습 순서, 친구 4열 strip, 세로 도달 가능성, 가로 스크롤 없음 |
| 1368×912 물리 화면 / 684×456 CSS / device scale 2, 200% 확대 등가 reflow | `output/playwright/home-zoom-200.png` | `(max-width: 850px)`가 활성화되어 본문과 학습 카드가 단일 열로 reflow되고, 친구 4명·핵심 텍스트·48px 이상 버튼이 가로 잘림 없이 도달 가능함. Chrome 브라우저 UI의 zoom 조작을 주장하지 않음 |
| 1368×912 reduced motion 정답 | `output/playwright/correct-reduced-motion.png` | 새 별 적립 가능 문제 정답에서 별 보상은 표시되지만 star particle은 0개이고 보상 요소의 계산된 transform은 `none`임 |

실제 Galaxy Tab, Synology NAS, 외부 HTTPS·DDNS·443 및 DSM 운영 게이트는 이 localhost 브라우저 검사로 입증하지 않았으며 계속 `NOT RUN`이다.
