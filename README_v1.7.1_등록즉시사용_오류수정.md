# SafePass v1.7.1 — 신규 대여처 등록 즉시 사용 오류 수정

## 핵심
- 신규 대여처 등록은 곧바로 APPROVED 처리되며 관리자 승인 불필요.
- 기존 등록 기록이 PENDING인 대여처도 본인의 유효한 접근 키로 API를 이용하면 APPROVED로 자동 전환.
- SUSPENDED / REJECTED 상태는 자동으로 풀리지 않음. 인증 없는 제3자의 자동 활성화도 불가.
- 미반납 가상 신원 열람에 필요한 독립 2단계 승인은 v1.7과 동일.
- 등록·QR 생성 화면의 안내 문구 개선.

## 반드시 둘 다 배포
1. `worker/src/index.ts` 교체 후 `safepass-poc-api` Worker 재배포.
2. `web/main.js` 교체 후 Cloudflare Pages 재배포.
3. `/health` (Worker 원본 주소 기준) 응답에서 `version: "1.7.1"`, `partner_self_activation: true` 확인.
4. 브라우저 새로고침 후 새 대여처 등록 → 자동 입력된 ID·접근 키 확인 → 대여 요청 생성.

## 원인 파악
- 기존 v1.7 소스는 신규 등록을 APPROVED로 생성하지만, 예전 PENDING 레코드를 QR 생성할 때 인정하지 않음.
- 배포된 Worker가 여전히 이전 버전일 경우 신규 등록해도 Partner is not approved가 나올 수 있음.
- 페이지 코드 교체만으로 Worker API가 바뀌지 않으므로 Worker 배포 필수.

## 테스트
- 신규 등록 후 관리자 승인 없이 QR 생성 성공.
- 유효한 키를 가진 기존 PENDING 자동 활성화 성공.
- 잘못된 접근 키 거절.
- 관리자에 의해 SUSPENDED 또는 REJECTED된 경우 거절.
- 신원정보 2단계 승인 절차 유지.

## 주의
- PoC 수준의 간편 온보딩입니다. 정식 운영에서는 사업자 실재 확인과 남용 방지 등 별도의 보호 조치가 필요합니다.
