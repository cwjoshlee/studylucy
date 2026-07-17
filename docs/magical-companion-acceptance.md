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
| localhost 브라우저 | Task 8 실행 뒤 기록 | NOT RUN |
| 실제 Galaxy Tab | 실제 기기 확인 필요 | NOT RUN |
| Synology NAS | NAS 배포 뒤 확인 필요 | NOT RUN |
| 외부 HTTPS·DDNS·443 | 외부망 확인 필요 | NOT RUN |
| DSM 운영 게이트 | DSM에서 확인 필요 | NOT RUN |

## 자동 검사 기록

- 실행 환경: Node `v22.23.1`, npm `11.11.0`
- `npm run check`: TypeScript 검사, Vitest 34개 파일·434개 테스트, Vite 클라이언트 빌드와 tsup 서버 빌드 통과
- 추가 검사: `bash -n scripts/*.sh`, `git diff --check`, `git diff --check 05804ed..HEAD` 통과
- 비차단 경고: Vite가 축소 후 500 kB를 넘는 청크를 보고함
- 비차단 경고: PWA 서비스 워커 빌드가 `inlineDynamicImports` 사용 중단 예정 경고를 보고함
