# SafePass PoC — 맡기지 않는 신분증

독립형 **모의** 모바일신분증 대여 보증 토큰 프로젝트. 원본 `cbdc-korea-poc-main`의 자산·데이터베이스·시크릿·소스 코드는 수정하거나 복사하지 않습니다. 프로젝트 K Wallet의 React PWA / Worker / D1 역할 분리 방식만 참고해 별도 정적 앱 및 Worker로 구성하였습니다.

## 포함
- `web/`: 이용자·대여처·관리자 반응형 웹 (정적 파일, 의존성 없이 실행)
- `worker/`: 서명 검증, 대여 요청, 토큰 발급/검증/해지, 미반납 심사 접수, 감사 내역 API
- `migrations/`: SafePass 신규 전용 D1 스키마
- `docs/`: 설계·시험·배포 지침

## 첫 실행 (Cloudflare)
1. `cd worker && npm install`
2. `npx wrangler d1 create safepass-poc-db` 실행해 나온 새 database_id를 `worker/wrangler.toml`에 새 `[[d1_databases]]` 바인딩으로 설정. 기존 K Wallet DB ID는 절대 사용하지 않습니다.
3. `npm run db:remote` (로컬 개발 시 `npm run db:local`)
4. `npx wrangler secret put TOKEN_SECRET` (긴 무작위 문자열), `npx wrangler secret put ADMIN_KEY` (별도 관리자 비밀키), `npx wrangler secret put ALLOWED_ORIGIN` (정적 웹 배포 주소, 예: `https://safepass-poc.pages.dev`)
5. `npm run deploy`
6. `web` 폴더를 Cloudflare Pages의 **새 프로젝트**로 별도 배포. 앱 '설정'에서 Worker URL 입력.

**주의:** Pages 배포 도메인을 결정한 다음 ALLOWED_ORIGIN을 정확히 설정하세요. 로컬 개발 시엔 개발 페이지의 origin으로 설정. 실제 인증 연동이나 개인정보 공개 기능은 의도적으로 구현하지 않았습니다. 실명/주민번호/실제 PIN을 입력하면 안 됩니다.

## 데모 절차
1. 대여처 탭에서 대여 요청 생성 → 코드 복사 → 이용자 탭에서 요청 확인
2. 가상 PIN `1234` 사용해 모의 발급 → 대여처에서 대여 ID 검증 (ACTIVE)
3. 대여처에서 반납 처리 → 재검증 (REVOKED)
4. 관리자는 서버 ADMIN_KEY를 화면에 입력하여 누적 건수와 감사 이벤트를 확인
5. 미반납 심사 요청은 만료 이후에만 접수, 개인정보는 언제나 반환하지 않음

## 중요 제약 / 고도화 필요
- 시연용 기기 식별자는 브라우저에서 임의 생성되며 **실제 본인확인/신원 추적 기능은 없음**.
- 등록 대여처와 관리자 권한 체계는 실제로 구현되지 않았습니다. 대여처 ID는 고정 시험용이며 API 호출자에 대한 기관 인증이 없습니다. **인터넷 공개 운영에는 부적합**. 보안 검증 전 격리된 테스트 환경에서만 사용하세요.
- QR 카메라 스캔 대신 복사 코드로 동작. 정식 QR 스캔은 후속 단계.
- 미반납 시 실명 공개 불가: 사전 동의가 있더라도 개인정보 제공의 법적 근거·필요성이 별도 확인되어야 함.
- 보증은 금전 채무에 대한 지급 보증이 아님. 실험용 UI/기능 코드로 프로덕션 사용 금지.

## v0.2 추가 기능 (2026-10-13)

- 카메라 QR 스캔: 모바일의 HTTPS 웹에서 이용자 탭 → 카메라 QR 스캔. `html5-qrcode` 2.3.8을 외부 CDN으로 로드하며, 카메라 권한 및 인터넷 연결이 필요합니다. 라이브러리 로딩 실패 시 요청 코드 붙여넣기 가능.
- 실제 QR 이미지 생성: 대여처 탭에서 생성 요청에 대해 `qrcodejs` 1.0.0 외부 CDN으로 렌더링. **시연 QR**로서 개인정보가 아니라 서명된 요청 코드가 들어갑니다.
- 상태 동기화: `/api/rental/status` 호출을 **2.5초 폴링**하여 이용자와 대여처의 ACTIVE/RETURNED 상태를 반영. WebSocket/SSE 푸시는 아니므로 약간의 지연이 있습니다.
- 대여처 승인: `partners` 테이블의 PENDING → APPROVED/REJECTED/SUSPENDED 관리. 대여처 비밀키를 해시로 저장하며 서버 측에서 요청 생성, 검증, 반납, 예외 요청 권한을 확인합니다.
- 미반납 예외 심사: 관리자에서 APPROVED_FOR_REVIEW/REJECTED 판정. 심사 승인은 **개인정보 공개 승인과 다르며 어떠한 개인정보도 반환하지 않습니다.**
- 모바일 ID 스타일: 네이비 카드·민트 상태표시·모바일 레이아웃·상태 카드 개선. 여전히 **가상 신원확인 PoC**입니다.

### v0.2 DB 적용

기존 v0.1 DB는 백업 후 다음 명령으로 2차 마이그레이션을 *한 번만* 실행합니다. 신규 DB에서는 `db:remote` 실행 후 `db:remote:upgrade`를 실행합니다.

```bash
cd worker
npm install
npm run db:remote:upgrade
npm run deploy
```

로컬은 `npm run db:local` 후 `npm run db:local:upgrade`. `0002_partner_approval.sql`의 `ALTER TABLE`은 재실행 시 오류가 날 수 있으므로 **한 번만 실행**합니다.

### v0.2 시연 절차

1. 관리자 키(`ADMIN_KEY`)를 Worker에 설정. 대여처 탭에서 `partner_id`(영문 소문자/숫자/하이픈, 4~50자), 이름, 24자 이상 접근 키 입력 후 '등록 승인 요청'.
2. 관리자 탭에 관리자 키 입력 → '승인 대기 및 현황 조회' → 해당 대여처 '승인'.
3. 대여처 탭에서 승인된 대여처 ID와 키 입력 후 **접근 키 적용**. 대여 요청 생성 → 화면의 QR 표시.
4. 이용자 휴대폰에서 SafePass 웹앱 열기 → **카메라 QR 스캔** → 동의 → 시험 PIN `1234` → 토큰 발급.
5. 대여처/이용자 화면에서 상태 자동 갱신 확인 → 대여처 '물품 반납 처리' → 양쪽 화면에 반납 및 해지 반영.
6. 미반납 요청은 실제 `expires_at` 이후에만 접수 가능하며, 관리자에서 '검토 승인'해도 개인정보는 제공되지 않음.

### 배포 및 보안 주의

- 기존 K Wallet의 Cloudflare Workers, Pages, D1, 토큰/인증서 등은 사용하거나 수정하지 않습니다. **완전히 별도의 SafePass 이름으로 새 리소스를 만드세요.**
- `ADMIN_KEY`, `TOKEN_SECRET`, `ALLOWED_ORIGIN`은 SafePass 전용 비밀값. 관리자 키는 브라우저 입력란에만 잠시 보관하며, 승인된 대여처의 접근 키는 **sessionStorage**에 임시 보관됩니다. 실운영에는 Cloudflare Access / 강력한 직원 인증, RBAC, 키 갱신·폐기, 요청 속도 제한, CORS/CSRF 통제와 보안감사가 필요합니다.
- 대여처 키가 유출되면 인증이 약화됩니다. 이 방식은 공모전 **제한된 시연용**입니다. 실제 신분증 앱, 국가 모바일신분증 API, 금융보증, 법적 개인정보 열람 기능이 아닙니다.
- 외부 CDN QR 스크립트는 설치가 간단한 시연 방식입니다. 운영 시 검증한 버전을 자체 호스팅하고 CSP/SRI 등 공급망 보호를 적용하세요.
- 기존 v0.1의 `demo-library` 등의 대여처 ID는 **자동 승인하지 않습니다**. 새로 등록하고 관리자가 승인해야 합니다.


### v0.3 — 대여처 접근 키 자동 생성

- 신규 대여처 등록 시 접근 키를 직접 입력하지 않습니다. Worker가 `crypto.getRandomValues`로 256비트(16진수 64자리) 비밀키를 생성합니다.
- DB에는 SHA-256 해시만 저장하고, 등록 API 응답에 원문 키를 **한 번만** 반환합니다. 브라우저 화면에서 복사 후 안전하게 보관하세요.
- 등록된 대여처의 기존 접근 키는 변경되지 않으며, 승인 절차(PENDING → APPROVED)는 유지됩니다.
- 웹앱의 접근 키는 현재 브라우저 탭의 sessionStorage에 저장되는 시연용 방식입니다. 운영 환경에서는 접근 통제와 키 재발급 체계를 별도로 구현해야 합니다.
- 변경 파일: `web/main.js`, `worker/src/index.ts`. D1 신규 마이그레이션은 필요하지 않습니다. **웹과 Worker를 모두 재배포하세요.**
