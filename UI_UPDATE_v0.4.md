# SafePass UI/UX v0.4

첨부 화면에 맞춰 이용자·대여처·관리자·설정의 시각 디자인을 개선했습니다.

## 변경 파일
- `web/main.js`: 브랜드 헤더, 사용자 홈(신분증은 맡기지 마세요 + 보증 카드), QR 발급 섹션, 대여처 검증·관리자 화면의 섹션 헤더. Pages 동일 도메인 API 연결 유지.
- `web/style.css`: 참고 화면 기반 스타일 전체 개선(네이비·블루·민트, 카드, 라운드, 반응형, 포커스 스타일).
- `functions/[[path]].js`: Pages `/api/*`와 `/health`를 `SAFEPASS_API`에 전달하는 함수. 기존 GitHub 파일이 동일한 역할을 수행 중이라면 덮어쓰기 전 비교하세요.

## 배포 방법
1. 기존 GitHub `safepass-poc`에 `web/main.js`, `web/style.css` 두 파일을 동일 경로로 업데이트합니다.
2. 기존 Pages Function이 정상 동작하면 수정할 필요 없습니다. 없는 경우 `functions/[[path]].js`를 저장소 최상위의 functions 폴더에 추가합니다.
3. Pages Settings의 Service Binding `SAFEPASS_API`가 `safepass-poc-api`를 가리키는지 확인합니다.
4. Pages 자동 배포 후 강력 새로고침. `/health` 응답을 확인합니다.

## 주의
- K Wallet 원본·DB 변경 없음. SafePass Worker·D1 마이그레이션 미수정.
- QR, 키 등록, 토큰 발급 등 기능의 서버측 정상 동작은 Cloudflare 실제 배포에서 확인해야 합니다.
- 진단용 `/health/config` 경로는 실제 공개 서비스에서 제거하세요.
