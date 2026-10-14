/**
 * Destructive staging-only T09-T13. Never run against safepass-poc.pages.dev.
 * SAFE_PASS_STAGING_URL=https://<isolated-staging-host> SAFE_PASS_ADMIN_KEY=... \
 * SAFE_PASS_ALLOW_WRITES=YES node tests/staging-e2e.mjs
 */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const base=(process.env.SAFE_PASS_STAGING_URL||'').replace(/\/$/,'');
if(!base||!base.startsWith('https://')||/safepass-poc\.pages\.dev|churchoffire\.workers\.dev/.test(base)||process.env.SAFE_PASS_ALLOW_WRITES!=='YES'||!process.env.SAFE_PASS_ADMIN_KEY){
 console.error('STAGING ONLY: set isolated HTTPS URL, admin key, SAFE_PASS_ALLOW_WRITES=YES; production host blocked');process.exit(2);
}
const adminKey=process.env.SAFE_PASS_ADMIN_KEY,device=randomUUID();
const records=[];
async function request(path,data,auth={}){
 const response=await fetch(base+path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json','X-Demo-Device':device,...auth},...(data?{body:JSON.stringify(data)}:{})});
 const json=await response.json().catch(()=>({}));return {...json,httpStatus:response.status};
}
async function test(id,fn){try{await fn();records.push({id,status:'PASS'});console.log('PASS',id)}catch(e){records.push({id,status:'FAIL',error:e.message});console.error('FAIL',id,e.message)}}
let partnerId,key,code,rentalId,caseId;
const ah={'X-Admin-Key':adminKey};
await test('T09 registration and approval',async()=>{
 const seed=await request('/api/admin/demo/setup',{},ah);assert.equal(seed.httpStatus,200,JSON.stringify(seed));
 partnerId=seed.partner_id;key=seed.partner_key;assert.equal(typeof key,'string');
});
await test('T10 request and single-use issue',async()=>{
 const created=await request('/api/request/create',{partner_id:partnerId,item:'자전거',hours:20/3600},{'X-Partner-Key':key});assert.equal(created.httpStatus,200,JSON.stringify(created));
 code=created.request_code;rentalId=created.rental_id;
 const data={request_code:code,simulation_pin:'1234',consent_accepted:true,consent_version:'2026-10-14-demo-v1'};
 const first=await request('/api/token/issue',data);assert.equal(first.httpStatus,200,JSON.stringify(first));
 const again=await request('/api/token/issue',data);assert.ok(again.httpStatus>=400,'duplicate issuance must be rejected');
});
await test('T11 token verify active',async()=>{const r=await request('/api/token/verify',{rental_id:rentalId},{'X-Partner-Key':key});assert.equal(r.httpStatus,200,JSON.stringify(r));assert.equal(r.valid,true)});
await test('T12 20-second expiry and STANDBY',async()=>{
 await new Promise(resolve=>setTimeout(resolve,22000));
 const result=await request('/api/token/verify',{rental_id:rentalId},{'X-Partner-Key':key});assert.equal(result.httpStatus,200);assert.equal(result.valid,false);assert.equal(result.status,'STANDBY');
});
await test('T13 review, synthetic reveal, audit and return',async()=>{
 const c=await request('/api/disclosure/request',{rental_id:rentalId,reason:'시험용 미반납 심사 접수'},{'X-Partner-Key':key});assert.equal(c.httpStatus,200,JSON.stringify(c));caseId=c.case_id;
 const approved=await request('/api/admin/disclosure/decide',{case_id:caseId,decision:'APPROVED_FOR_REVIEW'},ah);assert.equal(approved.httpStatus,200,JSON.stringify(approved));
 const reveal=await request('/api/admin/disclosure/demo-identity',{case_id:caseId},ah);assert.equal(reveal.httpStatus,200,JSON.stringify(reveal));assert.equal(reveal.simulation,true);
 const history=await request('/api/user/access-history',undefined,{'X-Demo-Device':device});assert.equal(history.httpStatus,200);assert.ok(history.events.some(v=>v.event_type==='DEMO_IDENTITY_VIEWED'));
 const returned=await request('/api/rental/return',{rental_id:rentalId},{'X-Partner-Key':key});assert.equal(returned.httpStatus,200);
 const revoked=await request('/api/token/verify',{rental_id:rentalId},{'X-Partner-Key':key});assert.equal(revoked.valid,false);
 const audit=await request('/api/admin/audit-integrity',undefined,ah);assert.equal(audit.httpStatus,200);assert.equal(audit.valid,true,JSON.stringify(audit));
});
console.log(JSON.stringify({at:new Date().toISOString(),base,records},null,2));
if(records.some(x=>x.status==='FAIL'))process.exitCode=1;
