# Synology 운영 배포 절차

이 문서는 DSM 7.2의 Container Manager에서 `수아의 공부방`을 운영하는 승인된 절차다. 앱은 `/volume1/docker/sua-learning`에 두고, 외부에는 HTTPS TCP 443만 공개한다. DSM 5001, 앱 8787, SQLite 파일은 외부에 공개하지 않는다.

## 1. 배포 전 중단 조건

- 공유기 WAN 주소와 공인 IP 확인 사이트의 주소가 다르거나 통신사가 CGNAT를 사용하면 여기서 중단한다.
- TCP 443 포트 전달이 불가능하면 터널이나 다른 포트를 임의로 추가하지 말고 사용자 승인을 다시 받는다.
- NAS CPU가 Container Manager와 현재 Node 22 이미지가 지원하는 `amd64` 또는 `arm64`인지 확인한다.
- 실제 PIN, 보호자 비밀번호, 설정 비밀값, 쿠키와 원시 토큰을 작업 기록이나 화면 캡처에 남기지 않는다.

## 2. Container Manager와 디렉터리 준비

DSM 패키지 센터에서 Container Manager를 설치한다. SSH 또는 DSM 터미널에서 다음을 실행한다.

```bash
sudo mkdir -p /volume1/docker/sua-learning/data/backups
sudo chown -R 1000:1000 /volume1/docker/sua-learning/data
sudo chmod 700 /volume1/docker/sua-learning/data
```

저장소 파일을 `/volume1/docker/sua-learning`에 복사하되 `.env`, `data`, `.local`, `node_modules`, `dist`는 개발 컴퓨터에서 복사하지 않는다.

## 3. 운영 환경 파일

배포 디렉터리에서 아래 명령으로 새 `.env`를 만든다. `your-host.synology.me`만 발급받은 DDNS 호스트로 바꾼다. 명령 결과나 완성된 파일 내용을 로그에 붙여 넣지 않는다.

```bash
cd /volume1/docker/sua-learning
umask 077
setup_secret="$(openssl rand -hex 32)"
session_pepper="$(openssl rand -hex 32)"
{
  printf '%s\n' 'APP_ORIGIN=https://your-host.synology.me'
  printf '%s\n' "SETUP_SECRET=${setup_secret}"
  printf '%s\n' "SESSION_PEPPER=${session_pepper}"
  printf '%s\n' 'SESSION_DAYS=14'
} > .env
unset setup_secret session_pepper
chmod 600 .env
```

확인할 권한은 다음 두 값이다.

```text
data  1000:1000, mode 700
.env  배포 관리자 소유, mode 600
```

## 4. 격리된 이미지 smoke

운영 컨테이너를 시작하거나 갱신하기 전에 다음 smoke를 실행한다.

```bash
cd /volume1/docker/sua-learning
bash scripts/smoke-container.sh
```

이 스크립트는 동적 `sua-learning-smoke-*` 프로젝트와 `compose.smoke.yaml`만 사용한다. 데이터는 임시 `/data`, 포트는 `127.0.0.1:18787`이며 운영 `./data`, 운영 Compose 프로젝트와 8787 바인딩에 접근하지 않는다. 실패 로그를 먼저 출력한 뒤 smoke 컨테이너·네트워크·임시 데이터만 제거한다. `{"status":"ok"}`까지 확인되지 않으면 운영 배포를 진행하지 않는다.

## 5. 이미지 빌드와 앱 시작

`Dockerfile`은 Node `22.23.1`에서 `npm ci`, 전체 `npm run check`, 프로덕션 의존성 정리를 수행한다. 런타임은 UID/GID 1000이고 `/data` 외 파일 시스템은 읽기 전용이다.

```bash
cd /volume1/docker/sua-learning
docker compose build --pull
docker compose up -d
docker compose ps
curl --fail --silent http://127.0.0.1:8787/api/health
```

마지막 응답은 `{"status":"ok"}`여야 한다. 실패하면 외부 공개를 진행하지 말고 다음 명령으로 비밀값이 없는 범위의 앱 로그만 확인한다.

```bash
docker compose logs --tail=200 app
```

## 6. DDNS, 인증서와 리버스 프록시

1. DSM 제어판의 외부 액세스 > DDNS에서 Synology DDNS 호스트를 만들고 상태가 정상인지 확인한다.
2. DSM 제어판의 보안 > 인증서에서 그 호스트의 Let's Encrypt 인증서를 발급한다.
3. 제어판 > 로그인 포털 > 고급 > 리버스 프록시에 다음 규칙을 만든다.

```text
소스 프로토콜: HTTPS
소스 호스트: 발급한 DDNS 호스트
소스 포트: 443
대상 프로토콜: HTTP
대상 호스트: 127.0.0.1
대상 포트: 8787
```

4. 리버스 프록시 호스트에 위 인증서를 연결한다.
5. 공유기에는 외부 TCP 443에서 NAS TCP 443으로 가는 규칙 하나만 만든다. TCP 5001과 8787 규칙은 만들지 않는다.

휴대전화 셀룰러망처럼 집 밖의 네트워크에서 `https://[redacted-host]/api/health`와 로그인 화면을 확인한다. 같은 외부망에서 5001과 8787 직접 접속은 실패해야 한다.

## 7. DSM 예약 작업

DSM 제어판 > 작업 스케줄러에서 사용자 정의 스크립트 두 개를 만든다. 시간대는 `Asia/Seoul`이며, 컨테이너를 실행할 권한이 있는 계정을 사용한다.

```text
매일 03:00
cd /volume1/docker/sua-learning && docker compose exec -T app npm run backup

매일 06:00
cd /volume1/docker/sua-learning && docker compose exec -T app npm run daily-maintenance
```

두 작업 모두 종료 코드가 0인지 확인한다. 백업은 `data/backups`에 생성되며 복원 시험은 [restore-backup.md](./restore-backup.md)를 따른다.

## 8. 업데이트와 롤백

업데이트 전 03:00 작업과 같은 명령으로 백업을 만들고 최근 백업 검증이 성공했는지 확인한다.

```bash
cd /volume1/docker/sua-learning
docker compose exec -T app npm run backup
docker compose build --pull
docker compose up -d
curl --fail --silent http://127.0.0.1:8787/api/health
```

새 이미지가 시작되지 않으면 데이터 디렉터리를 삭제하거나 새 데이터베이스를 만들지 않는다. 이전 Git 커밋의 소스로 이미지를 다시 빌드하고, 스키마 또는 데이터 손상이 확인될 때만 검증된 백업 복원 절차를 사용한다.

## 9. 배포 승인 체크

- [ ] 컨테이너 상태가 healthy이고 내부 health 응답이 정상이다.
- [ ] 격리 smoke가 운영 프로젝트/데이터/포트를 건드리지 않고 성공했다.
- [ ] `data`는 1000:1000/mode 700이고 `.env`는 mode 600이다.
- [ ] 외부 HTTPS 443에서 앱만 열린다.
- [ ] 외부 TCP 5001과 8787은 닫혀 있다.
- [ ] 03:00 백업과 06:00 유지보수 작업이 종료 코드 0으로 시험 실행됐다.
- [ ] `docs/phase1-acceptance.md`의 배포 관련 항목에 비밀값을 가린 증거를 기록했다.
