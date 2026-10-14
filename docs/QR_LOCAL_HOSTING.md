# SafePass QR 로컬 호스팅 (v1.4 native edition)

- `web/vendor/qr-encoder.local.js`: 로컬 QR 생성 라이브러리, 외부 스크립트 요청 없음.
- `web/vendor/qr-scanner.native.js`: BarcodeDetector 기반 로컬 스캔 어댑터. 브라우저 자체 내장 디코더 사용.
- `web/index.html`에서 두 라이브러리를 로컬 로드하며 `main.js`는 CDN으로 폴백하지 않음.
- **지원 제한**: BarcodeDetector API를 지원하지 않는 브라우저(일부 Safari, Firefox 등)에서는 스캔·이미지 QR 인식이 작동하지 않을 수 있습니다. 요청 코드 직접 입력은 유지됩니다.
- 카메라 동작에는 HTTPS, 카메라 권한과 정상 브라우저가 필요합니다. 브라우저 엔진 자체는 웹에서 제공할 수 없습니다.
- QR 렌더링과 카메라 스캔의 실제 휴대폰 시험은 배포 전 별도로 수행해야 합니다.
- 전체 브라우저 호환성을 위해서는 MIT/Apache 라이선스의 로컬 JS QR 디코더를 별도로 벤더링하는 후속 조치가 필요합니다.
- Worker, D1, K Wallet 원본은 변경하지 않습니다.
