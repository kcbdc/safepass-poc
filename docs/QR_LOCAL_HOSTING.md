# SafePass v1.5 — QR 디코더 자체 호스팅

## 구성
- QR 생성: `web/vendor/qr-encoder.local.js` (기존 유지)
- QR 해독: npm `jsqr@1.4.0`의 UMD 배포 파일을 Pages 빌드 시 `web/vendor/jsQR.local.js`로 복사
- 카메라 및 이미지 해독: `web/vendor/qr-scanner.native.js`; 브라우저 `BarcodeDetector`를 우선 사용, 미지원/검출 실패 시 로컬 `jsQR` 사용
- `web/index.html`은 모두 같은 출처(`/vendor/...`)에서 불러옴. **런타임 CDN 호출 없음**.

## Cloudflare Pages 설정 (GitHub 연결 방식)
1. 본 패치의 `web/`, `package.json`, `scripts/`를 리포지토리 루트 기준으로 커밋합니다.
2. Cloudflare Pages → safepass-poc → Settings → Builds & deployments:
   - **Root directory:** 프로젝트 루트(일반적으로 비워 둠)
   - **Build command:** `npm install --no-audit --no-fund && npm run build && npm run check:vendor`
   - **Build output directory:** `web`
   - Node.js는 20 이상 권장
3. 새 배포를 실시하고 `https://safepass-poc.pages.dev/vendor/jsQR.local.js`가 JS로 응답하는지 확인합니다.
4. 개발자도구 Network에서 `jsQR.local.js`, `qr-scanner.native.js`, `qr-encoder.local.js`가 동일 도메인에서만 로드되는지 확인합니다.

**중요:** Cloudflare Pages의 빌드 설정을 적용하지 않고 GitHub 파일만 올리면 `jsQR.local.js`는 생성되지 않습니다. 이 ZIP에는 npm에서 받은 제3자 배포용 JS 본문이 들어 있지 않으며, 빌드에서 가져옵니다. 만약 무빌드/직접 업로드로 배포한다면 별도 `npm install && npm run build`를 실행하여 생성된 `web/vendor/jsQR.local.js`를 함께 업로드해야 합니다.

## 테스트 권장
- Android Chrome 및 Samsung Internet: 후면 카메라 스캔 + 갤러리 QR 이미지
- iOS Safari: 카메라 권한 허용 + 갤러리 QR 이미지 (jsQR 폴백)
- PC Chrome/Edge/Firefox: 웹캠 카메라 스캔 + QR 이미지
- 생성된 SafePass `SP1.` 코드가 입력창에 채워지고 요청 확인이 진행되는지 검증
- 잘못된 QR, 카메라 권한 거부, 이미지에 QR 없음, 탭 이동·재시도 등을 점검
- 네트워크 연결 자체는 SafePass API 사용을 위해 필요합니다. 자체 호스팅은 **외부 QR CDN에 대한 의존성만 제거**합니다.

## 정적 테스트 및 보안 참고
- `node --check web/main.js` 와 `node --check web/vendor/qr-scanner.native.js`
- `npm run check:vendor`는 jsQR 벤더 파일 존재 여부만 검사합니다.
- QR 입력값은 기존 `SP1.` 검증 흐름을 통과해야 합니다. 디코더만 교체하였고 API/DB/모바일신분증 연동은 수정하지 않았습니다.
- `jsQR`의 LICENSE는 npm 배포 패키지에 포함되어 있으며, 운영 시 패키지 LICENSE를 함께 보존하세요.
