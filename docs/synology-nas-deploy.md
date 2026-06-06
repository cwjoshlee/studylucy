# Synology NAS 배포 가이드

## 목표

`prototype` 폴더의 학습 사이트를 Synology NAS에서 정적 사이트로 호스팅합니다. 현재 MVP는 Chrome 브라우저 음성인식을 쓰므로 서버 API나 유료 API 키가 필요하지 않습니다.

## 1. 정적 사이트 올리기

1. DSM Package Center에서 Web Station을 설치합니다.
2. File Station에서 웹 루트 폴더를 만듭니다.
   - 예: `/web/sua-learning`
3. `prototype` 폴더 안의 파일을 `/web/sua-learning`로 복사합니다.
   - `index.html`
   - `styles.css`
   - `app.js`
   - `manifest.webmanifest`
   - `sw.js`
   - `assets/`
4. Web Station에서 정적 웹 포털을 만들고 문서 루트를 `/web/sua-learning`로 지정합니다.
5. 내부망 주소로 접속해 화면을 확인합니다.

## 2. HTTPS 준비

마이크와 음성 인식 기능은 HTTPS에서 가장 안정적으로 동작합니다.

권장 순서:

1. Synology DDNS 또는 보유 도메인을 준비합니다.
2. DSM 인증서 메뉴에서 Let's Encrypt 인증서를 발급합니다.
3. Web Station 포털에 해당 인증서를 연결합니다.
4. 가능하면 HTTP 접속은 HTTPS로 리다이렉트합니다.

## 3. 외부 접속 방식

안전한 순서:

1. 내부망 전용
2. Tailscale 또는 VPN
3. Cloudflare Tunnel
4. 라우터 443 포트 포워딩

외부 공개를 할 경우 DSM 관리자 포트와 학습 사이트 포트를 분리하고, 관리자 화면은 외부에 노출하지 않는 편이 좋습니다.

## 4. Chrome 음성인식이 충분하지 않을 때

브라우저 음성인식 정확도가 아이의 발음이나 태블릿 환경에서 부족하면, 나중에 NAS에서 로컬 Whisper 같은 자체 전사 서버를 붙일 수 있습니다.

그때의 원칙:

- 외부 LLM은 사용하지 않습니다.
- 음성 파일 저장은 기본값으로 끕니다.
- 전사 서버는 내부망에서만 접근하게 둡니다.
- 보호자가 원할 때만 기록 저장을 켭니다.

## 5. 운영 체크리스트

- Android Chrome에서 마이크 권한 팝업이 뜨는지 확인
- HTTPS 주소로 접속했는지 확인
- 홈 화면 설치 후 실행되는지 확인
- 한글 읽기에서 붉은 굵은 글씨 피드백이 표시되는지 확인
- 수학 답 확인에서 `PASS`/`FAIL`이 표시되는지 확인
- NAS 방화벽에서 필요한 포트만 열었는지 확인
