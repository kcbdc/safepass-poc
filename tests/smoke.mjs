/* SafePass non-destructive live smoke checks. node tests/smoke.mjs https://safepass-poc.pages.dev */
import assert from 'node:assert/strict';
const base=(process.argv[2]||'http://localhost:8788').replace(/\/$/,'');
const tests=[];
async function test(id,name,fn){try{await fn();tests.push({id,name,result:'PASS'});console.log('PASS',id,name)}catch(e){tests.push({id,name,result:'FAIL',message:e.message});console.error('FAIL',id,name,e.message)}}
const get=async path=>{const r=await fetch(base+path);return {r,data:await r.json()}};
await test('T01','헬스 체크',async()=>{const {r,data}=await get('/health');assert.equal(r.status,200);assert.equal(data.simulation,true)});
await test('T02','품목별 시연 정책 6종',async()=>{const {r,data}=await get('/api/demo/policies');assert.equal(r.status,200);assert.deepEqual(Object.keys(data.policies).sort(),['자전거','유모차','캠핑장비','생활공구','면접정장','한복'].sort())});
await test('T03','관리자 지표 비인가 차단',async()=>{const {r}=await get('/api/admin/metrics');assert.equal(r.status,401)});
await test('T04','관리자 대여처 조회 비인가 차단',async()=>{const {r}=await get('/api/admin/partners');assert.equal(r.status,401)});
await test('T05','기기 식별자 없는 이력 차단',async()=>{const {r}=await get('/api/user/access-history');assert.equal(r.status,401)});
await test('T06','기기 식별자 없는 보증 목록 차단',async()=>{const {r}=await get('/api/user/rentals');assert.equal(r.status,401)});
await test('T07','기기 식별자 없는 알림 차단',async()=>{const {r}=await get('/api/user/notices');assert.equal(r.status,401)});
await test('T08','존재하지 않는 경로 404',async()=>{const {r}=await get('/api/not-a-real-endpoint');assert.equal(r.status,404)});
for(const [id,name] of [['T09','실제 등록·승인'],['T10','요청 생성·중복발급'],['T11','토큰 검증·반납'],['T12','20초 만료·STANDBY'],['T13','미반납 심사·가상 신원·감사 기록']])tests.push({id,name,result:'NOT_RUN',message:'테스트용 전용 DB 및 쓰기 승인 필요'});
const passed=tests.filter(t=>t.result==='PASS').length,failed=tests.filter(t=>t.result==='FAIL').length;
console.log(JSON.stringify({date:new Date().toISOString(),base,passed,failed,not_run:tests.filter(t=>t.result==='NOT_RUN').length,tests},null,2));
process.exitCode=failed?1:0;
