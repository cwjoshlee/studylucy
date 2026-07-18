# Synology NAS 배포와 자동 pull

초기 Web Station 정적 프로토타입 배포 절차는 더 이상 사용하지 않는다. 운영은 Node 22 컨테이너와 GHCR `main` 이미지를 사용하며, NAS가 5분마다 외부 GHCR에서 새 image ID를 확인하는 pull 방식이다. NAS를 GitHub runner로 등록하거나 수신 webhook을 열지 않는다.

실제 설치는 [Synology 운영 배포 절차](../ops/synology/README.md)를 순서대로 따른다. 특히 `.env`에는 `APP_IMAGE=ghcr.io/cwjoshlee/studylucy:main`을 넣고 mode 600을 유지하며, `ops/synology/pull-deploy.sh`는 mode 700으로 설정한다. private GHCR 패키지일 때만 별도 최소 read 토큰으로 `docker login`한다.

설치 후 실제 NAS에서만 다음 증거를 남긴다. 비밀값, PIN, API 키, 쿠키, `.env` 전체는 어떤 증거에도 포함하지 않는다.

- `main`의 SHA tag/digest, 이전·새 image ID, Docker `healthy`, `127.0.0.1:8787/api/health` 응답
- 새 image 실패 시 이전 app image만 복귀하고 data가 보존된 controlled rollback 결과
- daily backup과 daily maintenance의 DSM 작업 ID·실행 시각·종료 코드, 그리고 5분 pull 작업의 무변경/교체 결과
- 외부 셀룰러망 HTTPS 443 성공과 DSM 5001, SSH, 8787, Docker API, 배포 webhook 직접 접근 실패

이 운영 증거는 로컬 build, CI 성공, Compose 파일 검토와 별개다. 승인·병합·NAS 설치는 서로 분리된 게이트다.
