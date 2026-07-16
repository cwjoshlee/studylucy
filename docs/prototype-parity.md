# 정적 프로토타입 이관 증거

검증일은 2026-07-16이다. 삭제 직전 `prototype/app.js`의 `PROBLEMS` 20개를 서버의 `INITIAL_ITEMS` 형식으로 정규화했다. 정규화는 `mode: korean|math`를 각각 `kind: korean-reading|math-story`와 같은 값의 `subject`로 바꾸고, 객체 키를 재귀적으로 정렬한 UTF-8 JSON의 SHA-256을 계산했다.

검증 명령은 두 목록의 항목 수, 순서, ID와 정규화 본문 전체를 비교한 뒤 각 digest를 출력했다. 결과는 `PARITY_OK payloads=20 icons=4`였고, 네 아이콘은 삭제 전 `prototype/assets`와 현재 `public/assets`의 원시 파일 SHA-256이 같았다. 아래 값은 `tests/server/content-parity.test.ts`가 이후에도 검증한다.

## 학습 payload

| ID | SHA-256 |
|---|---|
| ko-01 | `add18e0a89b8d54bf5ffbbf9190fad68f3a6b4ee20647dbdc48997221b2ed694` |
| ko-02 | `3f12ea37e1869eee983f3a60655de2f6889901184456e761c4afef4312aeca36` |
| ko-03 | `24f6828631b9d87986cd4069e85507315b3df40b9d4c84a9e3796c51ad1c9c68` |
| ko-04 | `6336aa769b4376a04de6ede7ac4609a963a517039b1509ca313be75154a88a58` |
| ko-05 | `1a7f8af228f81c9328ee0158e4ad2bf4ccffa080dea70170b2e0efe83ac3aa64` |
| ko-06 | `05a204a0d11d60fcaa8c2d35902c05d2895876ff93b0f176ad3ef8b62b19baca` |
| ko-07 | `eb6dcb59483dd5bfc3813720f8f91009aa1f9d2d62c592557ab0a5f213587d66` |
| ko-08 | `dab4528141397e4f30d022159037d0258515825b8398d4963114c86db744748a` |
| ko-09 | `80f0837782393ab7c4e9e2eade6b22dba14432382301dbf11f0c8a2df58b2b23` |
| ko-10 | `5c7df0653e562753f199772b400e8266d4ae5868671778fdec8eca6f4b610b25` |
| math-01 | `0ada28fab5aaa1fd857e28f1016888d073cb47689944b9a8e0da039e1cdf45ec` |
| math-02 | `bee95fc4e89ede4a4f6eee196aa6a1ea4551f333f48fe6a12654552bab1aacb4` |
| math-03 | `c7c874195b14ee19d2281e5b63a858496531dcdae1628bae838b6c8c4e83c05e` |
| math-04 | `32c400e326f512abda82b05900eaf3e31aabd1eb27a346cdd3c709639357527d` |
| math-05 | `7bb684c418a1a223b66e4f6e97041e717c9c66b5ee42b5dd41d68b72ffdb8ff6` |
| math-06 | `9ec4d1c6ff5a993f64fc16be57befda4187b386133da91934609ea6b71247701` |
| math-07 | `c6532946ac828bf7dde484a5ef31a04df48d0a049b1e4258b3a2f05811e7e780` |
| math-08 | `5a3aef20f32997e80dca6280aae4e348b663ad878a779ee9203bd79009c3565b` |
| math-09 | `3f2de65a6fe0b391b3b492fd50ad5794716de06760b2505dcb6f1ca940f3413b` |
| math-10 | `91fd61fb875ea1c03e20e08a3f4cc299cd9ce1b31ba0dfcbd944c3077d074f70` |

## 아이콘

| 파일 | SHA-256 |
|---|---|
| apple-touch-icon.png | `f596d9540331a5203c2355eac41ed00b47a3e5c610ae09865a269f52305a6664` |
| icon-192.png | `c5c8d5cc37e0bb7964ce1914c1fe858a048454d7a0d84338693b944bd1629505` |
| icon-512.png | `310f185a0b3493e47f08dd2134bd7709276fc364cee95400d72a021f3903313b` |
| study-desk.png | `7f88d5d04ead8d5bc1854d14d1d19702c089e122f836dafdbfa37edf9bb0cd2d` |

Cloudflare Pages와 `wrangler.toml`은 이 검증 뒤 과거 프로토타입 경로와 함께 제거했다. Synology 컨테이너가 유일한 활성 운영 경로다.
