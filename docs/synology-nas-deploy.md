# Synology NAS 배포와 자동 pull

초기 Web Station 정적 프로토타입 배포 절차는 더 이상 사용하지 않는다. 운영은 Node 22 컨테이너와 GHCR `main` 이미지를 사용하며, NAS가 5분마다 외부 GHCR에서 새 image ID를 확인하는 pull 방식이다. NAS를 GitHub runner로 등록하거나 수신 webhook을 열지 않는다.

실제 설치는 [Synology 운영 배포 절차](../ops/synology/README.md)를 순서대로 따른다. 특히 `.env`에는 `APP_IMAGE=ghcr.io/cwjoshlee/studylucy:main`을 넣고 mode 600을 유지하며, `LLM_ENCRYPTION_KEY`는 `llm_encryption_key="$(openssl rand -base64 32)"`로 정확히 32바이트 난수의 base64 값을 셸 변수에 받아 `.env`에만 기록한다. 비밀값을 화면이나 로그에 출력하지 않는다. `ops/synology/pull-deploy.sh`는 mode 700으로 설정한다. private GHCR 패키지일 때만 별도 최소 read 토큰으로 `docker login`한다.

설치 후 실제 NAS에서만 다음 증거를 남긴다. 비밀값, PIN, API 키, 쿠키, `.env` 전체는 어떤 증거에도 포함하지 않는다.

- `main`의 SHA tag/digest, 이전·새 image ID, Docker `healthy`, `127.0.0.1:8787/api/health` 응답
- 새 image 실패 시 이전 app image만 복귀하고 data가 보존된 controlled rollback 결과
- daily backup과 daily maintenance의 DSM 작업 ID·실행 시각·종료 코드, 그리고 5분 pull 작업의 무변경/교체 결과
- 외부 셀룰러망 HTTPS 443 성공과 DSM 5001, SSH, 8787, Docker API, 배포 webhook 직접 접근 실패

이 운영 증거는 로컬 build, CI 성공, Compose 파일 검토와 별개다. 승인·병합·NAS 설치는 서로 분리된 게이트다.

## Step-up 릴리스 인수

릴리스 후보는 다음 여섯 하드닝 경계를 모두 만족해야 한다.

- [ ] 기초 완료 전 현재 문제를 직접 제출하거나, 현재 완료 전 도전 문제를 직접 제출하면 각각 `STEP_LOCKED`가 반환되고 시도·별·진도가 추가되지 않는다.
- [ ] 어느 기기에서든 해당 날짜의 일일 계획을 받은 뒤 보호자가 요구량을 바꾸면 `PLAN_LOCKED`가 반환된다.
- [ ] 운영 환경의 HTTP API 키 저장은 `HTTPS_REQUIRED`로 거부되고, 어떤 응답에도 키 문자열이 포함되지 않는다.
- [ ] 보호자 AI 학습실에서 이번 달 예상 예산과 제공자별 예상 입력·출력 단가를 수정해 저장할 수 있고, 이번 달 사용액은 실제 사용 기록에서 계산된 읽기 전용 값으로 확인된다.
- [ ] 생성 중 과목이나 단계를 바꾼 뒤 도착한 이전 AI 결과는 표시되거나 발행되지 않는다.
- [ ] 숨겨진 정답 결과는 자동 진행하지 않고, 휴식 화면은 `학습 계속`에 초점을 둔 뒤 재개 시 보이는 호출 버튼으로 초점을 복원한다.

## 최종 보완 로컬 릴리스 증거

2026-07-19 현재 로컬 릴리스 후보는 Node 22/npm 11.11.0 전체 검사(42개 파일, 695개 테스트), production 클라이언트/PWA/서버 빌드, `linux/amd64` Docker build를 통과했다. loopback `127.0.0.1:8787`의 임시 컨테이너는 `/api/health`에서 정확히 `{"status":"ok"}`를 반환한 뒤 제거되었다. 이 증거는 로컬 후보 검증이며 NAS 배포 또는 운영 health 증거가 아니다.

- [x] 기기 A의 같은 날짜 정식 완료가 기기 B의 동일 문항·콘텐츠 버전 단계 권한에 반영되어 `STEP_LOCKED` 모순 없이 다음 단계가 열린다.
- [x] Gemini multipart `text`는 모두 순서대로 결합한 뒤 JSON 검증과 완전한 사용량 기반 예산 조정을 수행한다.
- [x] 보호자 AI 학습실의 늦은 문항 저장 응답과 설정 조회 응답은 더 새로운 화면 상태를 대체하지 못한다.
- [x] 자동·수동 다음 동작은 하나의 정답 결과 전환을 원자적으로 공유하고, 받아쓰기 음성은 화면 숨김·휴식·닫힘 시 취소된다.
- [x] 세로형 플로팅 메뉴는 실제 수업 영역을 `inert`와 `aria-hidden`으로 막으며, 가로→세로 회전 시 숨겨진 메뉴 초점을 보이는 플로팅 메뉴 버튼으로 넘긴다.

## 호환성 보완 로컬 릴리스 인수

2026-07-19 현재 Node 22/npm 11.11.0 전체 검사에서 42개 테스트 파일·718개 테스트와 production 빌드가 통과했다. `sua-learning:compatibility-smoke`는 `linux/amd64`로 빌드했고, loopback 임시 컨테이너는 정확히 `{"status":"ok"}`를 반환한 뒤 제거됐다. 다음 경계는 이 로컬 회귀검사와 컨테이너 smoke에서 확인했으며, NAS 운영 증거나 실제 배포 승인은 아니다.

- [x] 신뢰할 수 있는 발행 일일 계획 출처가 없는 이관 시도는 완료 상태로 투영되지 않고 뒤 단계 권한도 열지 않는다.
- [x] Gemini 출력 예산은 후보 토큰과 생각 토큰을 모두 포함한다. 사용량이 누락·부분·음수·안전하지 않은 정수·합산 오버플로이면 예약된 예산을 해제하지 않는다.
- [x] 비버전 `GET /api/guardian/ai-studio/settings`는 바로 이전 앱의 전체 설정 객체 계약을 그대로 유지한다. `GET /api/guardian/ai-studio/settings/view`는 현재 앱의 명시적 전체 설정 객체이며, 현재 앱은 이를 먼저 읽는다. 버전 주소가 404일 때만 비버전 응답을 이전 전체 객체 또는 더 오래된 제공자 배열로 검증한다. 한 URL이 두 원본 응답 형태를 함께 보장하지 않는다.
- [x] 저장에 성공한 완료의 후속 새로고침이 실패하면 완료는 화면에 남고 재시도를 제공한다. 재시도는 권위 있는 계획·별만 새로 읽으며 완료를 다시 제출하지 않는다.

이 다섯 항목을 포함한 새 전체 브랜치 검토와 그 결과를 확인한 뒤 받는 새 명시적 릴리스 승인은 여전히 필수다. 그 승인 전에는 push, merge, image publish 또는 NAS 자동 배포를 시작하지 않는다.

릴리스 승인을 요청하기 전에 Node 22/npm 11.11.0으로 의존성을 새로 설치하고 전체 `npm run check`를 통과시킨 뒤, `linux/amd64` production image를 로컬에서만 빌드한다. 현재 사전 승인 단계의 HEAD는 아직 원격 GitHub에 push되지 않았으므로 원격 clone으로는 그 commit을 재현할 수 없다. 아래처럼 현재 로컬 저장소에서 정확한 HEAD를 읽어 분리된 임시 worktree를 만들고 검증한다. 원격 clone 검증은 명시적 릴리스 승인과 push가 끝나 해당 commit이 원격에서 조회될 때만 사용할 수 있다. 이 과정은 image를 로컬에만 만들며 publish하지 않는다.

```bash
set -eu
SOURCE_REPO="$(git rev-parse --show-toplevel)"
RELEASE_SHA="$(git -C "$SOURCE_REPO" rev-parse HEAD)"
CHECKOUT_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/studylucy-release-check.XXXXXX")"
CHECKOUT_DIR="$CHECKOUT_ROOT/worktree"
cleanup_checkout() {
  cd "$SOURCE_REPO" || true
  git worktree remove --force "$CHECKOUT_DIR" >/dev/null 2>&1 || true
  rmdir "$CHECKOUT_ROOT" >/dev/null 2>&1 || true
}
trap cleanup_checkout EXIT INT TERM

git -C "$SOURCE_REPO" worktree add --detach "$CHECKOUT_DIR" "$RELEASE_SHA"
cd "$CHECKOUT_DIR"
[ "$(git rev-parse HEAD)" = "$RELEASE_SHA" ]
[ -z "$(git status --porcelain)" ]
npx --yes -p node@22 -p npm@11.11.0 -- npm ci
npx --yes -p node@22 -p npm@11.11.0 -- npm run check
docker build --platform linux/amd64 -t sua-learning:step-up-smoke .

cleanup_checkout
trap - EXIT INT TERM
```

production 설정은 `SETUP_SECRET`과 `SESSION_PEPPER`가 각각 32자 이상이어야 하고 `APP_ORIGIN`은 HTTPS URL이어야 한다. `LLM_ENCRYPTION_KEY`는 생략할 수 있지만, 설정할 때는 정확히 32바이트를 표준 base64로 인코딩한 값이어야 한다. 아래 로컬 smoke는 암호화 설정 경로까지 확인하도록 고정된 비밀 아닌 32바이트 dummy key를 Node로 표준 base64 인코딩한다. 이 dummy 값은 실제 NAS `.env`에 사용하지 않는다.

```bash
set -eu
smoke_name=sua-learning-step-up-smoke
smoke_llm_key="$(node -e 'process.stdout.write(Buffer.alloc(32, 0x6b).toString("base64"))')"
cleanup() {
  docker rm -f "$smoke_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker run --rm -d --platform linux/amd64 --name "$smoke_name" \
  -e NODE_ENV=production \
  -e APP_ORIGIN=https://127.0.0.1:8787 \
  -e DATABASE_PATH=/tmp/sua-learning.sqlite \
  -e SETUP_SECRET=ssssssssssssssssssssssssssssssss \
  -e SESSION_PEPPER=pppppppppppppppppppppppppppppppp \
  -e LLM_ENCRYPTION_KEY="$smoke_llm_key" \
  -p 127.0.0.1:8787:8787 \
  sua-learning:step-up-smoke

health_body=
attempt=0
while [ "$attempt" -lt 30 ]; do
  health_body="$(curl --fail --silent --connect-timeout 2 --max-time 5 http://127.0.0.1:8787/api/health || true)"
  [ "$health_body" = '{"status":"ok"}' ] && break
  attempt=$((attempt + 1))
  sleep 1
done
[ "$health_body" = '{"status":"ok"}' ]
cleanup
trap - EXIT INT TERM
remaining_containers="$(docker ps -a --format '{{.Names}}')"
! printf '%s\n' "$remaining_containers" | grep -Fxq "$smoke_name"
printf '%s\n' "$health_body"
```

임시 컨테이너는 loopback `127.0.0.1:8787`에만 열고 HTTP `/api/health` 응답이 정확히 `{"status":"ok"}`인지 확인한 뒤 성공·실패와 관계없이 제거한다. 여기서 HTTPS `APP_ORIGIN`은 production 설정 검증용 정규 origin이고, loopback HTTP는 로컬 컨테이너 health probe다. 이 인수 과정에서는 image를 publish하지 않는다.

로컬 전체 검증과 임시 컨테이너 health PASS는 배포 후보의 인수 증거일 뿐, NAS 배포 완료 증거가 아니다. **현재 전체 브랜치를 대상으로 한 새로운 최종 검토**와 그 결과를 확인한 뒤 받는 **새로운 명시적 릴리스 승인** 전에는 push, merge, image publish 또는 NAS 자동 배포를 시작하지 않는다. 승인 후 `main` image가 발행되면 기존 5분 pull 작업이 새 image ID를 감지해 교체하도록 두고, 실제 NAS의 Docker `healthy`, loopback health 응답, image ID와 rollback/data 보존 증거를 따로 확인한다.
