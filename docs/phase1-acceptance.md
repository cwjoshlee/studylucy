# 1단계 인수 확인 기록

이 문서는 Synology와 실제 기기에서 채우는 비밀정보 제거용 인수 증거 양식이다. 저장소에는 PIN, 보호자 비밀번호, 세션 쿠키, 원시 토큰, 전체 음성 전사, 개인 NAS 경로 또는 전체 DDNS 호스트를 기록하지 않는다.

## 실행 정보

| 항목 | 기록 |
|---|---|
| 실행 날짜와 KST 시각 | 미실행 |
| 검증 담당자 | 미실행 |
| Galaxy Tab 모델/Android/Chrome | 미실행 |
| Galaxy Tab 가로 화면 viewport (CSS px) | 미실행 |
| 터치 대상 실측 최솟값(>=48px) | 미실행 |
| 키보드 탐색/포커스 표시 증거 | 미실행 |
| 두 번째 기기/브라우저 | 미실행 |
| 앱 커밋 SHA | 미실행 |
| 호스트 | `[redacted].synology.me` |
| 컨테이너 이미지 ID 앞 12자 | 미실행 |
| 내부 `127.0.0.1:8787` health 시각/응답 | NOT RUN |
| 외부 셀룰러망 HTTPS 443 시각/응답 | NOT RUN |
| 외부 5001/8787 차단 확인 | NOT RUN |
| 격리 Docker smoke 프로젝트/종료 코드 | NOT RUN |
| 복원 smoke 백업 파일명/종료 코드 | NOT RUN |
| DSM 03:00 백업 작업 ID/종료 코드 | NOT RUN |
| DSM 06:00 유지보수 작업 ID/종료 코드 | NOT RUN |

상태는 `PASS`, `FAIL`, `BLOCKED`, `NOT RUN` 중 하나만 사용한다. 자동 테스트 결과는 실제 NAS, 외부 네트워크와 두 기기 검증을 대신하지 않는다.

## 로컬 브라우저 확인

개발 Mac의 저장소 루트에서 Node 22로 앱을 시작한다.

```sh
npx --yes -p node@22 -p npm@11.11.0 -- npm run dev
```

같은 Mac에서 `http://127.0.0.1:5173/`를 열고, 별도 터미널에서 `curl --fail --silent http://127.0.0.1:8787/api/health`가 `{"status":"ok"}`를 반환하는지 확인한다. 이 로컬 확인은 Synology·외부 443·Galaxy Tab 항목의 PASS 근거가 아니다.

## 인수 항목

| # | 시나리오와 판정 기준 | 상태 | 비밀정보 제거 증거 |
|---:|---|---|---|
| 1 | 최초 설정 후 Galaxy Tab을 신뢰 기기로 등록하고 4자리 PIN으로 학생 로그인한다. | NOT RUN | 기기명 일부, 성공 시각, 화면 이름만 기록 |
| 2 | 학생 A 대시보드에 오리지널 별토끼, 필수 국어 2개와 수학 2개가 보인다. | NOT RUN | 항목 ID 4개와 화면 캡처 파일명 |
| 3 | 필수 항목을 완료하면 별 1개가 한 번만 적립되고 두 기기에 같은 확정 잔액이 보인다. 같은 풀이 재전송과 새 풀이 재시도는 추가 적립하지 않는다. | NOT RUN | 마스킹한 event ID, 두 기기 잔액, 중복 응답 |
| 4 | 활성 학습에서 2분 안내, 4분 확인, 5분 일시정지/차감 순서가 나타나며 숨김 탭·화면 잠금 동안 시간이 진행되지 않는다. | NOT RUN | 각 KST 시각과 hidden 구간 길이 |
| 5 | 첫 두 무반응 이벤트만 차감되고 세 번째는 상한 처리된다. 잔액 0에서는 실제 차감이 0이고 감사 기록이 남는다. | NOT RUN | 세 outcome과 전후 잔액 |
| 6 | 06:00 작업이 전날 미완료 후보를 최대 2개 만들고, 보호자 승인/면제 후 처리 로그가 유지된다. | NOT RUN | 작업 종료 코드, 후보/처리 ID 일부 |
| 7 | 오프라인 완료 풀이와 무반응 이벤트가 각각 대기열에 한 번 들어가며 재연결 후 한 번만 동기화된다. 대기 별은 확정 잔액과 분리된다. | NOT RUN | 전후 대기 수, sent/remaining, 확정 잔액 |
| 8 | 검증된 백업 복원 뒤 풀이, 일일 계획, 별 원장, 캐시 잔액과 대기 승인 행 수가 원본과 같다. | NOT RUN | 무결성 결과와 테이블별 행 수만 기록 |
| 9 | 재시작 catch-up을 두 번 실행해도 후보와 원장 행이 중복되지 않는다. | NOT RUN | 첫 실행/둘째 실행 행 수 |
| 10 | 외부 HTTPS 443에서 앱과 health가 열리고 DSM 5001과 앱 8787 직접 접속은 실패한다. | NOT RUN | 셀룰러망 결과와 포트별 PASS/FAIL |
| 11 | 저장소, SQLite와 운영 로그에 오디오, 전체 전사, PIN, 원시 토큰과 개인 경로가 없다. | NOT RUN | 검색 범위, 금지 패턴 0건, 검토자 |
| 12 | A/B 두 기기에서 서로 다른 plan/epoch를 받은 뒤 B가 먼저 진행하고 A의 stale 풀이가 보존되며 stale 무반응은 차감 면제된다. | NOT RUN | 마스킹한 plan 접미사, cursor 전후, 원장 사유 |
| 13 | A 해제 뒤 학생/학습 API가 차단되고, 재등록+PIN 후 recovery가 한 번만 생성되어 풀이만 복구되고 모든 무반응은 면제된다. | NOT RUN | 기기명 일부, 상태 코드, recovery 재시도 결과 |
| 14 | Galaxy Tab 가로 화면에서 핵심 버튼·입력의 터치 대상이 모두 48px 이상이고 포커스 표시와 가로 스크롤 이상이 없다. | NOT RUN | viewport, 최솟값, 캡처 파일명 |
| 15 | 백업 복사본 restore smoke와 컨테이너 smoke가 격리 실행되고, 실패/성공 뒤 임시 후보·컨테이너가 남지 않는다. | NOT RUN | 종료 코드, 비식별 행 수, 정리 확인 |

## 자동 검증 연결

실제 인수 전에 다음 결과를 첨부한다.

```sh
npx --yes -p node@22 -p npm@11.11.0 -- npm ci
npx --yes -p node@22 -p npm@11.11.0 -- npm run check
npx --yes -p node@22 -p npm@11.11.0 -- npm test -- tests/server/authority-integration.test.ts tests/client/auth-offline-lifecycle.test.tsx
bash -n scripts/*.sh
git diff --check
```

자동 검증 기록(2026-07-17 로컬 개발 Mac):

| 항목 | 상태 | 종료 코드/요약 |
|---|---|---|
| Node 22 `npm ci` | NOT RUN | - |
| Node 22 `npm run check` | PASS | 종료 0, 30파일 341/341, typecheck/build 성공 |
| focused integration | PASS | 종료 0, 13파일 236/236 |
| `bash -n scripts/*.sh` | PASS | 종료 0 |
| `git diff --check` | PASS | 종료 0 |
| 로컬 생성 SQLite `smoke:restore` | PASS | 종료 0, 비식별 6개 행 수 출력, `BACKUP_RESTORE_SMOKE_OK` |
| Synology `npm run smoke:container` | NOT RUN | Docker/프로젝트/종료 코드 필요 |
| Synology `npm run smoke:restore -- [backup]` | NOT RUN | 백업 파일명/행 수/종료 코드 필요 |

컨테이너 smoke는 Docker가 있는 Synology에서 `bash scripts/smoke-container.sh`로 실행한다. 이 명령은 동적 `sua-learning-smoke-*` 프로젝트, `compose.smoke.yaml`, 임시 `/data`와 `127.0.0.1:18787`만 사용하며 성공과 실패 모두에서 smoke 리소스만 제거한다. 운영 Compose 프로젝트, `./data`와 8787 바인딩에는 접근하지 않는다. 격리된 `GET /api/health`의 `{"status":"ok"}` 확인까지 성공해야 `PASS`로 기록한다.

## 실패 기록

| 시각(KST) | 항목 | 관찰 결과 | 후속 조치 | 재검증 |
|---|---:|---|---|---|
| - | - | - | - | - |
