# 수아의 공부방

`수아의 공부방`은 가족 로그인 뒤에만 사용할 수 있는 한글 읽기·초등 수학 학습 PWA다. 학생은 신뢰 기기에서 PIN으로 로그인해 오늘의 필수/선택 학습을 진행하고, 보호자는 계획·별 원장·미완료 승인·백업 상태를 관리한다.

현재 운영 대상은 Synology NAS의 Node.js 컨테이너다. Cloudflare Pages 정적 프로토타입은 이관 검증 후 종료되었으며 운영 경로가 아니다.

## 주요 동작

- 서버 권위의 일일 필수 국어 2개·수학 2개와 선택 학습
- 읽기 PASS, 수학 정답 PASS 뒤 완료되는 학습 잠금
- 필수 완료 별 1개, 중복 방지 원장과 여러 기기 확정 잔액
- 2/4/5분 무반응 안내·확인·제한 차감, 숨김 탭과 화면 잠금 일시정지
- 오프라인 풀이/무반응 대기열과 확정 별 분리
- 보호자 승인/면제, 원장 취소, 계획 관리와 백업 상태
- SQLite 일일 백업, 복원 검증과 시작 시 유지보수 catch-up
- 음성 파일과 전체 전사문을 저장하지 않는 브라우저 로컬 읽기 판정

## 로컬 개발

Node 22가 필요하다. 로컬 비밀값은 추적되지 않는 `.env`에 두고 커밋하지 않는다.

```bash
npm ci
npm run dev
```

검증 명령은 다음과 같다.

```bash
npm run check
```

`npm run check`는 TypeScript, 전체 Vitest, 클라이언트와 서버 빌드를 순서대로 실행한다. 개발 서버가 이미 실행 중인 환경에서는 별도 서버를 시작하거나 종료하지 않는다.

## 운영 명령

```bash
npm run backup
npm run daily-maintenance
```

컨테이너 배포와 DDNS/HTTPS/443 전용 공개 절차는 [ops/synology/README.md](ops/synology/README.md), 복원 시험은 [ops/synology/restore-backup.md](ops/synology/restore-backup.md), 실제 인수 기록은 [docs/phase1-acceptance.md](docs/phase1-acceptance.md)를 따른다.

## 보안 경계

- 외부에는 DSM 5001이나 앱 8787이 아니라 HTTPS TCP 443만 공개한다.
- `.env`, SQLite, 백업과 세션 비밀값을 이미지 또는 Git에 넣지 않는다.
- PIN과 보호자 비밀번호는 해시로만 저장하고 원시 토큰은 서버 로그에 남기지 않는다.
- 카메라·시선 추적·오디오 저장을 사용하지 않으며 전체 음성 전사문도 서버로 보내거나 저장하지 않는다.
