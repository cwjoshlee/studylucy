# 무료 호스팅 선택지

## 결론

비용을 최소화하려면 정적 호스팅만 사용합니다.

- 학습 화면: Cloudflare Pages 또는 GitHub Pages
- 읽기 전사: Android Chrome 브라우저 음성인식
- 읽기 채점: 브라우저 안의 로컬 비교 알고리즘
- 아이 학습 기록: 브라우저 로컬 저장소

이 구조는 LLM, 외부 STT API, 서버 함수, API 키가 필요하지 않습니다.

## 선택지 비교

| 선택지 | 비용 | 장점 | 한계 | 추천도 |
|---|---:|---|---|---|
| Cloudflare Pages | 무료 시작 | HTTPS 기본, PWA 테스트 쉬움, 배포 빠름 | Chrome 음성인식 지원 여부는 기기와 브라우저에 의존 | 가장 추천 |
| GitHub Pages | 무료 | 제일 단순, GitHub만 있으면 됨, HTTPS 지원 | 서버 기능 없음. 현재 MVP에는 문제 없음 | 가장 추천 |
| Synology NAS Web Station | 이미 NAS가 있으면 추가 비용 없음 | 가족 데이터 통제, 내부망 운영 가능 | HTTPS, DDNS, 포트, 보안 관리 필요 | 가족용/개인정보 중시 |
| WordPress.com 무료 | 무료 | 글/페이지 관리 쉬움 | 커스텀 JavaScript, 마이크 앱, PWA 제약 | 콘텐츠 보조용 |

## Cloudflare Pages 배포

Cloudflare Pages 프로젝트 설정값:

- Framework preset: None
- Build command: 비움
- Build output directory: `prototype`

배포 흐름:

1. 이 폴더를 GitHub 저장소에 올립니다.
2. Cloudflare Dashboard에서 Workers & Pages로 이동합니다.
3. Pages 프로젝트를 만들고 GitHub 저장소를 연결합니다.
4. 위 설정값으로 첫 배포를 실행합니다.
5. 배포 URL을 Android Chrome에서 열고 마이크 권한을 허용합니다.

환경 변수는 필요하지 않습니다.

## GitHub Pages 배포

GitHub Pages도 현재 MVP에 잘 맞습니다.

가능한 기능:

- 한글 동화 단락 보기
- 수학 지문과 문제 보기
- Chrome 브라우저 음성인식 전사
- 로컬 읽기 정확도 판정
- 수학 답 `PASS`/`FAIL` 채점
- 로컬 저장소 진행 기록

어려운 기능:

- 보호자 로그인
- 여러 기기 간 기록 동기화
- 서버 저장소

## Synology NAS 배포

Synology NAS는 가족 안에서 쓰는 학습 사이트로 좋은 선택입니다. 특히 외부 공개 없이 집 안 태블릿에서만 쓰고 싶다면 안정적입니다.

기본 구조:

- Web Station: `prototype` 정적 파일 호스팅
- DSM 인증서 관리: HTTPS
- DDNS 또는 내부 주소: 접속 주소

주의할 점:

- 마이크와 음성 인식은 HTTPS에서 가장 안정적입니다.
- 외부 공개 시 DSM 관리자 화면을 직접 노출하지 않는 편이 안전합니다.
- 처음에는 내부망 또는 VPN/Tailscale로만 쓰는 구성이 가장 안전합니다.
- Chrome 음성인식 결과가 불안정하면 나중에 NAS에서 로컬 Whisper 전사 서버를 붙일 수 있습니다.

## 내 추천 순서

1. 지금은 Cloudflare Pages 또는 GitHub Pages에 올려서 Android 태블릿 Chrome에서 바로 테스트합니다.
2. 1-2주 동안 Chrome 음성인식 정확도가 이수아에게 충분한지 확인합니다.
3. 음성 인식이 자주 빗나가거나 개인정보 통제를 더 강하게 하고 싶으면 Synology NAS와 로컬 Whisper를 검토합니다.
4. WordPress는 공개 학습 일지나 보호자용 설명 페이지가 필요할 때만 보조로 씁니다.

Android 태블릿에서는 배포 URL을 Chrome에서 열고 홈 화면에 설치하는 흐름을 기본으로 봅니다. 이 프로젝트에는 `manifest.webmanifest`와 `sw.js`가 포함되어 있어 설치형 웹앱처럼 사용할 수 있습니다.

## 확인한 공식 문서

- Cloudflare Pages: https://developers.cloudflare.com/pages/
- GitHub Pages: https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages
- Synology Web Station: https://www.synology.com/en-global/dsm/7.2/software_spec/web_station
- Web Speech API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API
