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

릴리스 승인을 요청하기 전에 Node 22/npm 11.11.0으로 전체 `npm run check`를 통과시키고, `linux/amd64` production image를 로컬에서만 빌드한다. production 설정은 `SETUP_SECRET`과 `SESSION_PEPPER`가 각각 32자 이상이어야 하고 `APP_ORIGIN`은 HTTPS URL이어야 한다. `LLM_ENCRYPTION_KEY`는 생략할 수 있지만, 설정할 때는 정확히 32바이트를 표준 base64로 인코딩한 값이어야 한다. 아래 로컬 smoke는 암호화 설정 경로까지 확인하도록 고정된 비밀 아닌 32바이트 dummy key를 Node로 표준 base64 인코딩한다. 이 dummy 값은 실제 NAS `.env`에 사용하지 않는다.

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
  health_body="$(curl --fail --silent http://127.0.0.1:8787/api/health || true)"
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

로컬 전체 검증과 임시 컨테이너 health PASS는 배포 후보의 인수 증거일 뿐, NAS 배포 완료 증거가 아니다. 별도 릴리스 승인 전에는 push, merge 또는 NAS 자동 배포를 시작하지 않는다. 승인 후 `main` image가 발행되면 기존 5분 pull 작업이 새 image ID를 감지해 교체하도록 두고, 실제 NAS의 Docker `healthy`, loopback health 응답, image ID와 rollback/data 보존 증거를 따로 확인한다.
