# 수아 학습 사이트

8살 이수아가 한글 읽기와 초등 1학년 수학 지문 읽기를 함께 연습하는 학습 사이트 초안입니다.

## 현재 결론

WordPress.com 무료 플랜만으로는 마이크 제어, 커스텀 JavaScript, 플러그인, 서버 API를 사이트 안에서 직접 구현하기 어렵습니다. 이 프로젝트는 WordPress 대신 무료 정적 호스팅에 바로 올릴 수 있는 학습 앱으로 방향을 바꿨습니다.

기본 버전은 비용이 들지 않도록 LLM과 외부 STT API를 사용하지 않습니다. Android 태블릿의 Chrome 브라우저 음성인식으로 전사하고, 전사 텍스트를 브라우저 안에서 기준 문장과 비교합니다.

권장 MVP는 다음 구조입니다.

1. Cloudflare Pages 또는 GitHub Pages: 학습 화면 무료 정적 호스팅.
2. Chrome 브라우저 음성인식: 아이가 읽은 내용을 브라우저에서 바로 전사.
3. 로컬 비교 채점: 한글 읽기는 85점 이상이고 빠진 핵심 표현이 없어야 `읽기 PASS`.
4. 수학 채점: 이야기 속 1~20 덧셈 문제를 읽기 PASS한 뒤 답 입력, `PASS` 또는 `FAIL`로 표시.
5. 진행 잠금: 읽기나 수학 답이 `FAIL`이면 다음 문제로 넘어갈 수 없음.
6. Synology NAS: 집 안에서 직접 호스팅하고 싶을 때의 대안.

주 사용 기기는 Android 태블릿입니다. Chrome for Android에서 홈 화면에 설치해서 쓰는 PWA 형태를 우선 지원합니다.

## 파일 구조

- `prototype/index.html`: 바로 실행 가능한 학습 앱 프로토타입.
- `prototype/styles.css`: 아이가 읽기 편한 화면 스타일.
- `prototype/app.js`: 문제 진행, 음성 인식, 로컬 읽기 정확도 판정.
- `prototype/manifest.webmanifest`: Android 태블릿 홈 화면 설치용 PWA 설정.
- `prototype/sw.js`: 정적 화면 오프라인 캐시.
- `docs/hosting-options.md`: 무료 호스팅 및 NAS 선택지 비교.
- `docs/android-tablet.md`: Android 태블릿 사용 가이드.
- `docs/synology-nas-deploy.md`: Synology Web Station 배포 가이드.
- `content/wordpress-free-pages.md`: WordPress 무료 플랜에 복사해 넣을 페이지 초안.
- `docs/browser-speech-reading-judge.md`: Chrome 브라우저 음성인식 기반 읽기 판정 설계.

## 실행 방법

마이크 기능은 보통 `file://`보다 로컬 서버에서 더 안정적으로 동작합니다.

```bash
cd "/Users/chulwonlee/Documents/이수아 학습사이트/prototype"
python3 -m http.server 5173
```

브라우저에서 `http://localhost:5173`을 엽니다.

Cloudflare Pages 방식으로 정적 사이트를 미리 보려면 Wrangler를 사용할 수 있습니다.

```bash
npx wrangler pages dev prototype
```

기본 버전에는 API 키나 환경 변수가 필요하지 않습니다.

## 설계 기준

- Khan Academy식 단원 카드, 짧은 연습 루프, 즉시 피드백, 진행률 느낌을 참고했습니다.
- 한글이 익숙하지 않은 아이를 위해 영어 보조 문구를 작게 제공합니다.
- 난독증이 확실하지 않으므로 진단처럼 표현하지 않고, 정확한 읽기 연습과 관찰 기록에 집중합니다.
- 한 문항은 짧게, 글자는 크게, 줄 간격은 넓게, 피드백은 부드럽게 구성했습니다.
- 음성과 아이의 학습 기록은 기본적으로 브라우저 로컬에만 둡니다.
- 터치 버튼은 Android 태블릿 손가락 조작 기준으로 크게 유지합니다.
- 읽기 판정은 Chrome 브라우저 음성인식 전사 결과를 기준 문장과 로컬 비교합니다.
- 읽기 시간은 최대 2분이며, 아이가 다 읽고 `읽기 완료`를 누르면 채점합니다.
- 한글 읽기에서 틀리거나 빠뜨린 핵심 표현은 붉은 굵은 글씨로 표시합니다.
- 읽기 PASS 기준은 85점 이상이며, 핵심 표현을 빠뜨리면 점수가 높아도 PASS가 아닙니다.
- 동화 단락 10개와 숲속 이야기 안에 맞춘 덧셈 문제 10개를 제공합니다.
- 수학 문제는 지문과 문제를 읽기 PASS해야 답 입력칸이 열리고, 답 입력 후 `PASS` 또는 `FAIL`로 채점 내역을 표시합니다.
- 한글 단락은 읽기 PASS, 수학 문제는 읽기 PASS와 수학 답 PASS가 모두 되어야 다음 문제 버튼이 열립니다.

## 무료 배포 추천

1순위는 Cloudflare Pages 또는 GitHub Pages입니다. `prototype` 폴더를 정적 사이트로 배포하면 됩니다.

Synology NAS를 사용할 경우 `prototype` 폴더 내용을 Web Station 문서 루트로 복사하면 정적 사이트는 바로 운영할 수 있습니다. 단, 마이크 기능을 안정적으로 쓰려면 HTTPS 설정이 필요합니다.

WordPress 무료 플랜은 공개 콘텐츠 보조 페이지가 필요할 때만 선택합니다.

Android 태블릿에서는 배포 후 Chrome 메뉴에서 홈 화면에 추가 또는 앱 설치를 눌러 쓰는 흐름을 추천합니다.

## 출처와 확인한 제약

- WordPress.com 공식 문서 기준으로 무료 사이트는 커스텀 코드에 제한이 있고, JavaScript는 플러그인 활성화 플랜에서 사용할 수 있습니다.
- WordPress.com 무료 사이트에서는 플러그인 설치가 불가합니다.
- 읽기 어려움이 의심되는 아이에게는 명시적, 체계적, 누적적인 읽기 지도가 중요하다는 구조화 문해 접근을 참고했습니다.
