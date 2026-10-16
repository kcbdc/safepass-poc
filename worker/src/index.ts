interface Env{DB:D1Database;ADMIN_KEY:string;TOKEN_SECRET:string;ALLOWED_ORIGIN:string;DEMO_TOOLS_ENABLED?:string;REVIEWER_KEY?:string;PARTNER_ENTRY_PASSWORD?:string}
const enc=new TextEncoder();
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
async function sha(s:string){return hex(await crypto.subtle.digest('SHA-256',enc.encode(s)))}
async function sign(secret:string,message:string){const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(await crypto.subtle.sign('HMAC',key,enc.encode(message)))}
const now=()=>new Date().toISOString();
function secureEqual(a:string,b:string){const aa=enc.encode(a),bb=enc.encode(b);let v=aa.length^bb.length;for(let i=0;i<Math.max(aa.length,bb.length);i++)v|=(aa[i]||0)^(bb[i]||0);return v===0}
const POLICIES:Record<string,{hours:number,limit?:number,period?:string,description:string}>={
 '자전거':{hours:3,description:'최대 3시간 · 동일 이용자 동시 1대'},
 '유모차':{hours:24,description:'시연 정책: 24시간'},
 '캠핑장비':{hours:336,description:'최대 14일(2주)'},
 '생활공구':{hours:72,description:'시연 정책: 3일'},
 '면접정장':{hours:96,limit:3,period:'year',description:'시연 정책: 4일·연 3회'},
 '한복':{hours:48,description:'시연 정책: 48시간'}
};
async function checkLimit(db:D1Database,key:string,limit:number,windowMinutes:number){const start=new Date(Date.now()-windowMinutes*60000).toISOString();
 const count=await db.prepare('SELECT COUNT(*) n FROM request_limits WHERE bucket_key=? AND at>?').bind(key,start).first<{n:number}>();
 if((count?.n||0)>=limit)return false;
 await db.prepare('INSERT INTO request_limits(id,bucket_key,at) VALUES(?,?,?)').bind(crypto.randomUUID(),key,now()).run();return true;
}

function fail(msg:string,status=400){return new Response(JSON.stringify({error:msg}),{status,headers:{'Content-Type':'application/json; charset=utf-8'}})}
function safeText(v:unknown,max=120){return typeof v==='string'?v.trim().slice(0,max):''}
async function body(r:Request){return await r.json() as Record<string,unknown>}
async function audit(db:D1Database,t:string,id:string|null,detail=''){
 const eventId=crypto.randomUUID(),at=now();
 // Legacy audit table is retained. The companion hash ledger is append-only for the PoC.
 const previous=await db.prepare('SELECT entry_hash FROM audit_integrity ORDER BY seq DESC LIMIT 1').first<{entry_hash:string}>();
 const prevHash=previous?.entry_hash||'GENESIS';
 const entryHash=await sha(JSON.stringify([prevHash,eventId,t,id,at,detail]));
 await db.batch([
  db.prepare('INSERT INTO audit_events(id,event_type,rental_id,at,detail) VALUES(?,?,?,?,?)').bind(eventId,t,id,at,detail),
  db.prepare('INSERT INTO audit_integrity(event_id,event_type,rental_id,at,detail,previous_hash,entry_hash) VALUES(?,?,?,?,?,?,?)').bind(eventId,t,id,at,detail,prevHash,entryHash)
 ]);
}
async function verifyAudit(db:D1Database){
 const rows=await db.prepare('SELECT seq,event_id,event_type,rental_id,at,detail,previous_hash,entry_hash FROM audit_integrity ORDER BY seq ASC LIMIT 10000').all<Record<string,any>>();
 let prior='GENESIS';let verified=0;
 for(const row of rows.results||[]){
  const actual=await sha(JSON.stringify([prior,row.event_id,row.event_type,row.rental_id,row.at,row.detail]));
  if(row.previous_hash!==prior||row.entry_hash!==actual)return {valid:false,checked:verified,failed_seq:row.seq};
  prior=row.entry_hash;verified++;
 }
 return {valid:true,checked:verified,head:prior,note:'Sequential proof of integrity; chain append should be serialized under concurrent writes'};
}
export default {async fetch(req:Request,env:Env):Promise<Response>{
 const origin=req.headers.get('Origin');const allowed=env.ALLOWED_ORIGIN;
 const cors:Record<string,string>={'Vary':'Origin','Access-Control-Allow-Headers':'Content-Type,X-Demo-Device,X-Admin-Key,X-Partner-Key,X-Reviewer-Key','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
 if(origin&&allowed&&(allowed===origin))cors['Access-Control-Allow-Origin']=origin;
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 const response=async()=>{
 try{
 const path=new URL(req.url).pathname;
 if(path==='/health')return Response.json({service:'SafePass PoC',version:'1.7.4',partner_self_activation:true,ok:!!env.DB,simulation:true});
 if(!env.DB||!env.TOKEN_SECRET||!env.ADMIN_KEY||!env.ALLOWED_ORIGIN)return fail('Server configuration incomplete',503);
 const adminOK=!!env.ADMIN_KEY&&secureEqual(req.headers.get('X-Admin-Key')||'',env.ADMIN_KEY);
 const reviewerOK=!!env.REVIEWER_KEY&&env.REVIEWER_KEY!==env.ADMIN_KEY&&secureEqual(req.headers.get('X-Reviewer-Key')||'',env.REVIEWER_KEY);
 if(path==='/api/partner/entry/verify'&&req.method==='POST'){const input=await body(req);if(!env.PARTNER_ENTRY_PASSWORD)return fail('대여자 진입 비밀번호가 설정되지 않았습니다. Worker에 PARTNER_ENTRY_PASSWORD Secret을 등록하세요.',503);const valid=secureEqual(String(input.password||''),env.PARTNER_ENTRY_PASSWORD);return valid?Response.json({ok:true}):fail('대여자 비밀번호가 올바르지 않습니다.',401)}
 if(path==='/api/reviewer/key/verify'&&req.method==='POST'){if(!adminOK)return fail('관리자 인증이 필요합니다.',401);return reviewerOK?Response.json({ok:true,role:'reviewer'}):fail('2단계 보호 키가 올바르지 않습니다.',401)}
 const key=safeText(req.headers.get('X-Partner-Key'),200);
 async function approvedPartner(partnerId:string){
  if(!key)return false;
  const record=await env.DB.prepare('SELECT key_hash,status,created_at FROM partners WHERE id=?').bind(partnerId).first<{key_hash:string;status:string;created_at:string}>();
  if(!record||!secureEqual(record.key_hash,await sha(key)))return false;
  // Keep administratively suspended/rejected partners blocked. Only a holder of the
  // registered partner key may activate their own legacy PENDING registration.
  if(record.status==='PENDING'){
   const changed=await env.DB.prepare("UPDATE partners SET status='APPROVED' WHERE id=? AND status='PENDING' AND key_hash=?")
    .bind(partnerId,record.key_hash).run();
   if((changed.meta?.changes||0)>0)await audit(env.DB,'PARTNER_SELF_ACTIVATED',null,partnerId+'; valid partner key; legacy PENDING registration');
   const current=await env.DB.prepare('SELECT status FROM partners WHERE id=?').bind(partnerId).first<{status:string}>();
   if(current?.status!=='APPROVED')return false;
  }else if(record.status!=='APPROVED')return false;
  // Only judge-created temporary partners are limited to one hour.
  if(/^demo-[a-f0-9]{14}$/.test(partnerId)&&Date.now()-Date.parse(record.created_at)>=3600000)return false;
  return true;
 }
 // Allow only the holder of the original demo device to read that device's audit trail.
 if(path==='/api/user/rentals'&&req.method==='GET'){
   const demoDevice=safeText(req.headers.get('X-Demo-Device'),60);
   if(!/^[a-f0-9-]{36}$/i.test(demoDevice))return fail('Demo device ID required',401);
   const holder=await sha(demoDevice);
   const result=await env.DB.prepare(`SELECT r.id AS rental_id,r.partner_id,r.item,r.status,t.id AS token_id,t.issued_at,t.expires_at,t.status AS token_status
      FROM guarantee_tokens t JOIN rental_requests r ON r.id=t.rental_id
      WHERE t.holder_pseudonym=? ORDER BY t.issued_at DESC LIMIT 200`).bind(holder).all();
   return Response.json({rentals:result.results||[]});
 }
 if(path==='/api/user/access-history'&&req.method==='GET'){
  const deviceId=safeText(req.headers.get('X-Demo-Device'),60);
  if(!/^[a-f0-9-]{36}$/i.test(deviceId))return fail('Demo device ID required',401);
  const deviceHash=await sha(deviceId);
  const rows=await env.DB.prepare(`SELECT a.event_type,a.rental_id,a.at,r.item
    FROM audit_events a JOIN rental_requests r ON r.id=a.rental_id
    JOIN guarantee_tokens t ON t.rental_id=r.id
    WHERE t.holder_pseudonym=? AND a.event_type IN
      ('DEMO_IDENTITY_VIEWED','DISCLOSURE_REQUESTED','DISCLOSURE_APPROVED_FOR_REVIEW','DISCLOSURE_REJECTED')
    ORDER BY a.at DESC LIMIT 100`).bind(deviceHash).all();
  // Include previously approved/rejected reviews created before decision audits included rental IDs.
  const decisions=await env.DB.prepare(`SELECT d.rental_id,r.item,d.status,d.reviewed_at AS at
    FROM disclosure_requests d JOIN rental_requests r ON r.id=d.rental_id
    JOIN guarantee_tokens t ON t.rental_id=r.id
    WHERE t.holder_pseudonym=? AND d.reviewed_at IS NOT NULL AND d.status IN ('APPROVED_FOR_REVIEW','REJECTED')
    ORDER BY d.reviewed_at DESC LIMIT 100`).bind(deviceHash).all();
  const merged=[...(rows.results||[]),...(decisions.results||[]).map((x:any)=>({event_type:x.status==='REJECTED'?'DISCLOSURE_REJECTED':'DISCLOSURE_APPROVED_FOR_REVIEW',rental_id:x.rental_id,item:x.item,at:x.at}))];
  const unique=new Map<string,any>();for(const e of merged){unique.set([e.event_type,e.rental_id,e.at].join('|'),e)}
  return Response.json({events:[...unique.values()].sort((a,b)=>String(b.at).localeCompare(String(a.at))).slice(0,100),simulation:true});
 }
 if(path==='/api/demo/policies'&&req.method==='GET')return Response.json({policies:POLICIES,simulation:true});
 if(path==='/api/admin/audit-integrity'&&req.method==='GET'){
  if(!adminOK)return fail('Unauthorized',401);
  return Response.json(await verifyAudit(env.DB));
 }
 if(path==='/api/admin/metrics'&&req.method==='GET'){
  if(!adminOK)return fail('Unauthorized',401);
  const rows=await env.DB.prepare(`SELECT r.id,r.item,r.partner_id,r.created_at,
   MAX(CASE WHEN a.event_type='TOKEN_ISSUED' THEN a.at END) issued_at,
   MAX(CASE WHEN a.event_type='TOKEN_VERIFIED' THEN a.at END) verified_at,
   MAX(CASE WHEN a.event_type='RENTAL_RETURNED' THEN a.at END) returned_at
   FROM rental_requests r LEFT JOIN audit_events a ON a.rental_id=r.id
   GROUP BY r.id ORDER BY r.created_at DESC LIMIT 200`).all();
  return Response.json({rows:(rows.results||[]).map((r:any)=>({...r,issue_seconds:r.issued_at?Math.max(0,(Date.parse(r.issued_at)-Date.parse(r.created_at))/1000):null,return_seconds:r.returned_at&&r.issued_at?Math.max(0,(Date.parse(r.returned_at)-Date.parse(r.issued_at))/1000):null})),simulation:true});
 }
 if(path==='/api/user/notices'&&req.method==='GET'){
  const deviceId=safeText(req.headers.get('X-Demo-Device'),60);if(!/^[a-f0-9-]{36}$/i.test(deviceId))return fail('Demo device ID required',401);
  const holder=await sha(deviceId);
  const rows=await env.DB.prepare(`SELECT n.id,n.rental_id,n.message,n.at FROM demo_notices n JOIN guarantee_tokens t ON t.rental_id=n.rental_id WHERE t.holder_pseudonym=? ORDER BY n.at DESC LIMIT 100`).bind(holder).all();return Response.json({notices:rows.results||[]});
 }
 if(path==='/api/admin/rentals'&&req.method==='GET'){
  if(!adminOK)return fail('Unauthorized',401);
  const q=new URL(req.url).searchParams.get('id')?.trim()||'';
  if(q && !/^[0-9a-f-]{1,36}$/i.test(q))return fail('Invalid rental ID',400);
  const result=q
    ?await env.DB.prepare(`SELECT r.id AS rental_id,r.partner_id,p.name AS partner_name,r.item,r.status AS rental_status,r.created_at,t.status AS token_status,t.expires_at
       FROM rental_requests r LEFT JOIN partners p ON p.id=r.partner_id LEFT JOIN guarantee_tokens t ON t.rental_id=r.id
       WHERE r.id LIKE ? ORDER BY r.created_at DESC LIMIT 100`).bind(q+'%').all()
    :await env.DB.prepare(`SELECT r.id AS rental_id,r.partner_id,p.name AS partner_name,r.item,r.status AS rental_status,r.created_at,t.status AS token_status,t.expires_at
       FROM rental_requests r LEFT JOIN partners p ON p.id=r.partner_id LEFT JOIN guarantee_tokens t ON t.rental_id=r.id
       ORDER BY r.created_at DESC LIMIT 100`).all();
  return Response.json({rentals:result.results||[],limit:100,simulation:true});
 }
 if(path==='/api/admin/partners'&&req.method==='GET'){
  if(!adminOK)return fail('Unauthorized',401);
  const rows=await env.DB.prepare('SELECT id,name,status,created_at,approved_at FROM partners ORDER BY created_at DESC LIMIT 100').all();
  return Response.json({partners:rows.results});
 }
 if(path==='/api/admin/disclosures'&&req.method==='GET'){
  if(!adminOK)return fail('Unauthorized',401);
  const rows=await env.DB.prepare(`SELECT d.id,d.rental_id,d.reason,d.status,d.created_at,d.reviewed_at,r.partner_id,
   EXISTS(SELECT 1 FROM audit_events a WHERE a.rental_id=d.rental_id AND a.event_type='DISCLOSURE_SECOND_APPROVED' AND a.detail LIKE ('case=' || d.id || ';%')) AS second_approved
   FROM disclosure_requests d JOIN rental_requests r ON r.id=d.rental_id ORDER BY d.created_at DESC LIMIT 100`).all();
  return Response.json({cases:rows.results});
 }
 if(path==='/api/admin/overdue'&&req.method==='GET'){
  if(!adminOK)return fail('Unauthorized',401);
  const rows=await env.DB.prepare(`SELECT r.id rental_id,r.partner_id,p.name partner_name,r.item,t.expires_at,
   (SELECT d.id FROM disclosure_requests d WHERE d.rental_id=r.id ORDER BY d.created_at DESC LIMIT 1) case_id,
   (SELECT d.status FROM disclosure_requests d WHERE d.rental_id=r.id ORDER BY d.created_at DESC LIMIT 1) review_status,
   (SELECT EXISTS(SELECT 1 FROM audit_events a WHERE a.rental_id=d.rental_id AND a.event_type='DISCLOSURE_SECOND_APPROVED' AND a.detail LIKE ('case=' || d.id || ';%')) FROM disclosure_requests d WHERE d.rental_id=r.id ORDER BY d.created_at DESC LIMIT 1) second_approved
   FROM rental_requests r JOIN guarantee_tokens t ON t.rental_id=r.id
   LEFT JOIN partners p ON p.id=r.partner_id
   WHERE r.status='ACTIVE' AND t.status='ACTIVE' AND t.expires_at <= ?
   ORDER BY t.expires_at DESC LIMIT 100`).bind(now()).all();
  return Response.json({rentals:rows.results,simulation:true});
 }
 if(path==='/api/admin/overview'){
  if(!adminOK)return fail('Unauthorized',401);
  const [a,b,c]=await Promise.all([env.DB.prepare('SELECT COUNT(*) n FROM rental_requests').first<{n:number}>(),env.DB.prepare('SELECT COUNT(*) n FROM guarantee_tokens').first<{n:number}>(),env.DB.prepare('SELECT event_type,rental_id,at,detail FROM audit_events ORDER BY at DESC LIMIT 30').all()]);
  return Response.json({rentals:a?.n||0,tokens:b?.n||0,events:c.results});
 }
 if(req.method!=='POST')return fail('Not found',404);
 if(origin&&origin!==allowed)return fail('Origin not allowed',403);
 const x=await body(req),device=safeText(req.headers.get('X-Demo-Device'),60);
 if(path==='/api/admin/demo/setup'){
  if(!adminOK)return fail('Unauthorized',401);
  if(env.DEMO_TOOLS_ENABLED!=='true')return fail('Demo setup is disabled',403);
  const ip=req.headers.get('CF-Connecting-IP')||'local';
  if(!await checkLimit(env.DB,'seed:'+await sha(ip),5,60))return fail('Demo creation rate limited',429);
  const partnerId='demo-'+crypto.randomUUID().replaceAll('-','').slice(0,14);
  const secret=hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
  const created=now();
  await env.DB.prepare('INSERT INTO partners(id,name,key_hash,status,created_at,approved_at) VALUES(?,?,?,?,?,?)').bind(partnerId,'SafePass 심사 시연용',await sha(secret),'APPROVED',created,created).run();
  await audit(env.DB,'DEMO_PARTNER_CREATED',null,partnerId);
  return Response.json({simulation:true,partner_id:partnerId,partner_key:secret,expires_in_minutes:60,notice:'시연 키는 한 번 표시합니다. 실운영에 사용하지 마세요.'});
 }
 if(path==='/api/admin/partner/rotate-key'){
  if(!adminOK)return fail('Unauthorized',401);
  const id=safeText(x.partner_id,50);const secret=hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
  const r=await env.DB.prepare('UPDATE partners SET key_hash=? WHERE id=?').bind(await sha(secret),id).run();
  if(r.meta.changes!==1)return fail('Partner not found',404);
  await audit(env.DB,'PARTNER_KEY_ROTATED',null,id);
  return Response.json({partner_id:id,partner_key:secret,notice:'이 키는 한 번만 표시됩니다. 이전 키는 즉시 폐기됩니다.'});
 }
 if(path==='/api/admin/notice/send'){
  if(!adminOK)return fail('Unauthorized',401);const id=safeText(x.rental_id,50);
  const row=await env.DB.prepare('SELECT id,status FROM rental_requests WHERE id=?').bind(id).first<{id:string;status:string}>();
  if(!row||row.status!=='ACTIVE')return fail('Active rental required',409);
  await env.DB.prepare('INSERT INTO demo_notices(id,rental_id,message,at) VALUES(?,?,?,?)').bind(crypto.randomUUID(),id,'[시험용] 대여 물품의 반납 상태를 확인해 주세요.',now()).run();
  await audit(env.DB,'REMINDER_SENT',id,'Simulated in-app notice only');return Response.json({sent:true,simulation:true});
 }
 if(path==='/api/admin/overdue/request'){
  if(!adminOK)return fail('Unauthorized',401);
  const id=safeText(x.rental_id,50),reason=safeText(x.reason,200);
  const rental=await env.DB.prepare(`SELECT r.id FROM rental_requests r JOIN guarantee_tokens t ON t.rental_id=r.id
  WHERE r.id=? AND r.status='ACTIVE' AND t.status='ACTIVE' AND t.expires_at<=?`).bind(id,now()).first();
  if(!rental)return fail('Overdue active rental required',409);
  const prior=await env.DB.prepare('SELECT id,status FROM disclosure_requests WHERE rental_id=? ORDER BY created_at DESC LIMIT 1').bind(id).first<{id:string;status:string}>();
  if(prior && prior.status!=='REJECTED')return fail('Review already exists',409);
  const caseId=crypto.randomUUID();
  await env.DB.prepare('INSERT INTO disclosure_requests(id,rental_id,reason,status,created_at) VALUES(?,?,?,?,?)').bind(caseId,id,reason||'Overdue rental demo review','PENDING_REVIEW',now()).run();
  await audit(env.DB,'DISCLOSURE_REQUESTED',id,'Simulation: admin started review; no identity released');
  return Response.json({case_id:caseId,status:'PENDING_REVIEW'});
 }
 if(path==='/api/admin/partner/decide'){
  if(!adminOK)return fail('Unauthorized',401);
  const id=safeText(x.partner_id,50),action=x.action;
  if(!['APPROVED','REJECTED','SUSPENDED'].includes(String(action)))return fail('Invalid decision');
  const r=await env.DB.prepare('UPDATE partners SET status=?,approved_at=? WHERE id=?').bind(action,now(),id).run();
  if(r.meta.changes!==1)return fail('Partner not found',404);
  await audit(env.DB,'PARTNER_'+action,null,id);return Response.json({partner_id:id,status:action});
 }
 // 1st approval: administrator must not be able to perform the independent 2nd approval.
 if(path==='/api/admin/disclosure/decide'){
  if(!adminOK)return fail('관리자 1차 인증이 필요합니다.',401);
  const id=safeText(x.case_id,60),decision=String(x.decision);
  if(!['APPROVED_FOR_REVIEW','REJECTED'].includes(decision))return fail('Invalid decision');
  const next=decision==='REJECTED'?'REJECTED':'PENDING_SECOND_APPROVAL';
  // Legacy APPROVED_FOR_REVIEW records predate independent two-person review.
  // Re-confirm as first reviewer, but never expose identity until a distinct second approval.
  const legacy=await env.DB.prepare("SELECT d.id,d.rental_id FROM disclosure_requests d JOIN rental_requests r ON r.id=d.rental_id JOIN guarantee_tokens t ON t.rental_id=r.id WHERE d.id=? AND d.status='APPROVED_FOR_REVIEW' AND r.status='ACTIVE' AND t.status='ACTIVE' AND t.expires_at<=? AND NOT EXISTS (SELECT 1 FROM audit_events a WHERE a.rental_id=d.rental_id AND a.event_type='DISCLOSURE_SECOND_APPROVED' AND a.detail LIKE ('case=' || d.id || ';%'))").bind(id,now()).first();
  if(legacy&&decision==='REJECTED')return fail('기존 승인 건은 먼저 1차 재확인을 진행하세요.',409);
  const result=legacy
   ?await env.DB.prepare("UPDATE disclosure_requests SET status='PENDING_SECOND_APPROVAL',reviewed_at=? WHERE id=? AND status='APPROVED_FOR_REVIEW'").bind(now(),id).run()
   :await env.DB.prepare("UPDATE disclosure_requests SET status=?,reviewed_at=? WHERE id=? AND status='PENDING_REVIEW'").bind(next,now(),id).run();
  if(result.meta.changes!==1)return fail('1차 심사 대기 건이 아닙니다.',409);
  const caseRow=await env.DB.prepare('SELECT rental_id FROM disclosure_requests WHERE id=?').bind(id).first<{rental_id:string}>();
  await audit(env.DB,decision==='REJECTED'?'DISCLOSURE_REJECTED':'DISCLOSURE_FIRST_APPROVED',caseRow?.rental_id||null,'No personal data released; independent reviewer required');
  return Response.json({case_id:id,status:next,personal_data_released:false});
 }
 // 2nd approval: separate REVIEWER_KEY is required, not administrator credentials.
 if(path==='/api/reviewer/disclosure/decide'){
  if(!reviewerOK)return fail('별도 2차 검토자 인증이 필요합니다. REVIEWER_KEY를 확인하세요.',401);
  const id=safeText(x.case_id,60),decision=String(x.decision);
  if(!['APPROVED_FOR_REVIEW','REJECTED'].includes(decision))return fail('Invalid decision');
  const result=await env.DB.prepare("UPDATE disclosure_requests SET status=?,reviewed_at=? WHERE id=? AND status='PENDING_SECOND_APPROVAL' AND EXISTS (SELECT 1 FROM rental_requests r JOIN guarantee_tokens t ON t.rental_id=r.id WHERE r.id=disclosure_requests.rental_id AND r.status='ACTIVE' AND t.status='ACTIVE' AND t.expires_at<=?)").bind(decision,now(),id,now()).run();
  if(result.meta.changes!==1)return fail('2차 심사 대상이 아니거나 미반납 상태가 아닙니다.',409);
  const caseRow=await env.DB.prepare('SELECT rental_id FROM disclosure_requests WHERE id=?').bind(id).first<{rental_id:string}>();
  await audit(env.DB,decision==='REJECTED'?'DISCLOSURE_SECOND_REJECTED':'DISCLOSURE_SECOND_APPROVED',caseRow?.rental_id||null,'case='+id+'; independent reviewer decision; no personal data released');
  return Response.json({case_id:id,status:decision,personal_data_released:false});
 }
 // Demonstration-only identity reveal: fictitious profiles, never actual mobile ID data.
 if(path==='/api/admin/disclosure/demo-identity'&&req.method==='POST'){
  if(!adminOK)return fail('Unauthorized',401);
  if(!reviewerOK)return fail('2차 검토자 키를 함께 입력해야 가상 신원을 열람할 수 있습니다.',401);
  const caseId=safeText(x.case_id,60);
  const row=await env.DB.prepare('SELECT d.id,d.rental_id,d.status,r.status rental_status,t.expires_at FROM disclosure_requests d JOIN rental_requests r ON r.id=d.rental_id JOIN guarantee_tokens t ON t.rental_id=r.id WHERE d.id=?').bind(caseId).first<{id:string;rental_id:string;status:string;rental_status:string;expires_at:string}>();
  if(!row)return fail('Review case not found',404);
  if(row.status!=='APPROVED_FOR_REVIEW'||row.rental_status!=='ACTIVE'||row.expires_at>now())return fail('Approved overdue case required',403);
  // Legacy single-step approvals are not sufficient: require a recorded second reviewer decision for this case.
  const second=await env.DB.prepare("SELECT id FROM audit_events WHERE event_type='DISCLOSURE_SECOND_APPROVED' AND rental_id=? AND detail LIKE ? LIMIT 1").bind(row.rental_id,'case='+caseId+';%').first();
  if(!second)return fail('독립 2차 승인 기록이 없습니다. 기존 단독 승인 건은 재심사가 필요합니다.',403);
  // Stable synthetic profile selected from fictitious examples; only available after approval.
  const digest=await sha(row.rental_id);
  const profiles=[{name:'김안심 (가상)',phone:'010-0000-1001',birth:'1990-01-01',address:'가상시 안심구 1번지'}, {name:'이보증 (가상)',phone:'010-0000-1002',birth:'1994-05-12',address:'가상시 안심구 2번지'}, {name:'박대여 (가상)',phone:'010-0000-1003',birth:'1988-11-20',address:'가상시 안심구 3번지'}];
  const profile=profiles[parseInt(digest.slice(0,2),16)%profiles.length];
  await audit(env.DB,'DEMO_IDENTITY_VIEWED',row.rental_id,'Fictitious demo profile viewed by administrator, case '+caseId);
  return Response.json({simulation:true,source:'FICTIONAL_TEST_DATA',case_id:caseId,rental_id:row.rental_id,profile,notice:'가상 신원정보입니다. 실제 모바일신분증과 연결되지 않습니다.'});
 }
 if(path==='/api/partner/register'){
  const ip=req.headers.get('CF-Connecting-IP')||'unavailable';
  if(!await checkLimit(env.DB,'register:'+await sha(ip),3,60))return fail('등록 요청 제한: 1시간 후 다시 시도하세요',429);
  const id=safeText(x.partner_id,50),name=safeText(x.name,100);
  if(!/^[a-z0-9-]{4,50}$/.test(id)||name.length<2)return fail('Partner ID and name required');
  // Generate a unique 256-bit secret on the server; never persist plaintext.
  const secret=hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
  await env.DB.prepare('INSERT INTO partners(id,name,key_hash,status,created_at) VALUES(?,?,?,?,?)').bind(id,name,await sha(secret),'APPROVED',now()).run();
  await audit(env.DB,'PARTNER_SELF_REGISTERED',null,id+'; PoC auto-activated, key verification still required');return Response.json({partner_id:id,status:'APPROVED',partner_key:secret,notice:'PoC 등록 즉시 이용 가능 · 미반납 가상 신원 열람은 별도 2단계 승인'});
 }
 if(!device||! /^[a-f0-9-]{36}$/i.test(device))return fail('Demo device ID required',401);
 if(path==='/api/partner/rentals'&&req.method==='POST'){
   const partnerId=safeText(x.partner_id,50);
   if(!await approvedPartner(partnerId))return fail('Not authorized for partner',403);
   const result=await env.DB.prepare(`SELECT r.id AS rental_id,r.item,r.status,r.created_at,COALESCE(t.expires_at,r.expires_at) AS expires_at,t.issued_at,t.status AS token_status
     FROM rental_requests r LEFT JOIN guarantee_tokens t ON t.rental_id=r.id
     WHERE r.partner_id=? ORDER BY r.created_at DESC LIMIT 200`).bind(partnerId).all();
   return Response.json({rentals:result.results||[]});
 }
 if(path==='/api/request/create'){
  const partner=safeText(x.partner_id,50),item=safeText(x.item,100),hours=Number(x.hours);
  const policy=POLICIES[item];
  if(!await approvedPartner(partner))return fail('대여처 접근 키가 일치하지 않거나 관리자에 의해 중지·거절된 대여처입니다. 새 등록을 했다면 최신 Worker 배포도 확인하세요.',403);
  const judgeRecord=/^demo-[a-f0-9]{14}$/.test(partner)?await env.DB.prepare('SELECT name FROM partners WHERE id=?').bind(partner).first<{name:string}>():null;
  const judgeDemo=env.DEMO_TOOLS_ENABLED==='true'&&judgeRecord?.name==='SafePass 심사 시연용';
  if(!policy)return fail('Invalid rental item',400);
  // 시연용 보증기간은 모든 품목에 동일하게 적용한다. 실제 시설의 대여한도와 독립적이다.
  const allowedDurations=[3,24,48,72,96,168,336];
  if(!(allowedDurations.includes(hours)||Math.abs(hours-20/3600)<0.00000001))return fail('Invalid rental request or policy duration',400);
  if(!judgeDemo&&hours>policy.hours)return fail(`${item} 대여기간 초과: 최대 ${policy.hours}시간까지 가능합니다.`,409);
  if(!judgeDemo&&!await checkLimit(env.DB,'create:'+partner,60,60))return fail('대여 생성 횟수 제한',429);
  const id=crypto.randomUUID(),nonce=crypto.randomUUID(),expires=new Date(Date.now()+Math.max(10*60000,Math.min(hours*3600000,24*3600000))).toISOString();
  const code=`SP1.${id}.${nonce}.${await sign(env.TOKEN_SECRET,`${id}.${nonce}`)}`;
  await env.DB.prepare('INSERT INTO rental_requests(id,partner_id,item,hours,request_code_hash,status,created_at,expires_at,demo_holder) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,partner,item,hours,await sha(code),'REQUESTED',now(),expires,judgeDemo?'JUDGE_DEMO_V1':'').run();
  await audit(env.DB,'REQUEST_CREATED',id);return Response.json({rental_id:id,request_code:code});
 }
 if(path==='/api/request/inspect'||path==='/api/token/issue'){
  const code=safeText(x.request_code,300),parts=code.split('.');
  if(parts.length!==4||parts[0]!=='SP1'||! /^[0-9a-f-]{36}$/i.test(parts[1])||await sign(env.TOKEN_SECRET,`${parts[1]}.${parts[2]}`)!==parts[3])return fail('Invalid request code');
  const row=await env.DB.prepare('SELECT * FROM rental_requests WHERE id=? AND request_code_hash=?').bind(parts[1],await sha(code)).first<Record<string,any>>();
  if(!row||row.status!=='REQUESTED'||row.expires_at<=now())return fail('Request expired or used',409);
  if(path==='/api/request/inspect')return Response.json({rental_id:row.id,partner_name:row.partner_id,item:row.item,hours:row.hours,judge_demo:row.demo_holder==='JUDGE_DEMO_V1'&&env.DEMO_TOOLS_ENABLED==='true'});
  const judgeDemo=row.demo_holder==='JUDGE_DEMO_V1'&&/^demo-[a-f0-9]{14}$/.test(String(row.partner_id))&&env.DEMO_TOOLS_ENABLED==='true';
  const itemPolicy=POLICIES[String(row.item)];
  if(!itemPolicy||(!judgeDemo&&Number(row.hours)>itemPolicy.hours))return fail(`${row.item} 최대 대여기간 ${itemPolicy?.hours||0}시간을 초과했습니다. 새 대여 QR을 요청하세요.`,409);
  const holderHash=await sha(device);
  const yearStart=new Date(Date.UTC(new Date().getUTCFullYear(),0,1)).toISOString();
  // D1's single UPDATE statement is the final issuance guard; a separate precheck alone races.
  let issueGuard='';let guardArgs:unknown[]=[];
  if(!judgeDemo&&row.item==='자전거'){
    issueGuard=` AND NOT EXISTS (SELECT 1 FROM guarantee_tokens gt JOIN rental_requests rr ON rr.id=gt.rental_id
      WHERE gt.holder_pseudonym=? AND rr.item='자전거' AND rr.status='ACTIVE' AND gt.status='ACTIVE')`;
    guardArgs=[holderHash];
  }else if(!judgeDemo&&row.item==='면접정장'){
    issueGuard=` AND (SELECT COUNT(*) FROM guarantee_tokens gt JOIN rental_requests rr ON rr.id=gt.rental_id
      WHERE gt.holder_pseudonym=? AND rr.item='면접정장' AND gt.issued_at>=?) < 3`;
    guardArgs=[holderHash,yearStart];
  }
  if(x.simulation_pin!=='1234')return fail('Simulation authentication failed',401);
  if(x.consent_accepted!==true||x.consent_version!=='2026-10-14-demo-v1')return fail('Updated demo consent required',422);
  const token_id=crypto.randomUUID(),expires=new Date(Date.now()+Number(row.hours)*3600000).toISOString(),token=await sign(env.TOKEN_SECRET,`${token_id}.${row.id}.${expires}`);
  const batch=await env.DB.batch([
    env.DB.prepare(`UPDATE rental_requests SET status='ACTIVE' WHERE id=? AND status='REQUESTED' ${issueGuard}`).bind(row.id,...guardArgs),
    env.DB.prepare("INSERT INTO guarantee_tokens(id,rental_id,holder_pseudonym,token_hash,status,issued_at,expires_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM rental_requests WHERE id=? AND status='ACTIVE')").bind(token_id,row.id,holderHash,await sha(token),'ACTIVE',now(),expires,row.id)
  ]);
  if(batch[0].meta.changes!==1||batch[1].meta.changes!==1){
    if(!judgeDemo&&row.item==='자전거')return fail('자전거 대여 한도 초과: 동일 이용자는 한 번에 1대만 대여할 수 있습니다. 기존 자전거를 반납한 뒤 다시 신청하세요.',409);
    if(!judgeDemo&&row.item==='면접정장')return fail('면접정장 이용 횟수 초과: 올해 발급 가능한 3회를 모두 사용했습니다. 반납해도 연간 횟수에 포함됩니다.',409);
    return fail('대여 요청이 이미 사용되었거나 유효하지 않습니다.',409);
  }
  await env.DB.prepare('INSERT INTO demo_consents(id,rental_id,holder_hash,version,agreed_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),row.id,await sha(device),'2026-10-14-demo-v1',now()).run();
  await audit(env.DB,'TOKEN_ISSUED',row.id);return Response.json({token_id,rental_id:row.id,expires_at:expires,status:'ACTIVE'});
 }
 if(path==='/api/rental/status'){
  const id=safeText(x.rental_id,50);
  const row=await env.DB.prepare('SELECT r.id,r.status,r.partner_id,r.item,r.expires_at,t.status token_status,t.expires_at token_expires,t.holder_pseudonym FROM rental_requests r LEFT JOIN guarantee_tokens t ON t.rental_id=r.id WHERE r.id=?').bind(id).first<Record<string,any>>();
  if(!row)return fail('Rental not found',404);
  const holder=!!device&&row.holder_pseudonym===await sha(device);
  if(!holder&&!await approvedPartner(row.partner_id))return fail('Not authorized for rental',403);
  const valid=row.status==='ACTIVE'&&row.token_status==='ACTIVE'&&row.token_expires>now();
  return Response.json({rental_id:id,item:row.item,status:row.status,display_status:row.status==='ACTIVE'&&row.token_status==='ACTIVE'&&!valid?'STANDBY':row.status,token_status:row.token_status||'NOT_ISSUED',valid,expires_at:row.token_expires||row.expires_at});
 }
 if(path==='/api/token/verify'){
  const id=safeText(x.rental_id,50);
  const row=await env.DB.prepare('SELECT r.status rental_status,t.status token_status,t.expires_at FROM rental_requests r LEFT JOIN guarantee_tokens t ON t.rental_id=r.id WHERE r.id=?').bind(id).first<Record<string,any>>();
  if(!row)return fail('Rental not found',404);
  const owner=await env.DB.prepare('SELECT partner_id FROM rental_requests WHERE id=?').bind(id).first<{partner_id:string}>();
  if(!owner||!await approvedPartner(owner.partner_id))return fail('Partner authorization required',403);
  const valid=row.rental_status==='ACTIVE'&&row.token_status==='ACTIVE'&&row.expires_at>now();
  await audit(env.DB,'TOKEN_VERIFIED',id,valid?'valid':'invalid');return Response.json({valid,status:valid?'ACTIVE':row.rental_status==='RETURNED'?'REVOKED':row.rental_status==='ACTIVE'&&row.token_status==='ACTIVE'&&row.expires_at<=now()?'STANDBY':'INVALID'});
 }
 if(path==='/api/rental/return'){
  const id=safeText(x.rental_id,50);
  const owner=await env.DB.prepare('SELECT partner_id FROM rental_requests WHERE id=?').bind(id).first<{partner_id:string}>();
  if(!owner||!await approvedPartner(owner.partner_id))return fail('Partner authorization required',403);
  const result=await env.DB.batch([env.DB.prepare("UPDATE rental_requests SET status='RETURNED' WHERE id=? AND status='ACTIVE'").bind(id),env.DB.prepare("UPDATE guarantee_tokens SET status='REVOKED',revoked_at=? WHERE rental_id=? AND status='ACTIVE' AND EXISTS(SELECT 1 FROM rental_requests WHERE id=? AND status='RETURNED')").bind(now(),id,id)]);
  if(result[0].meta.changes!==1)return fail('Active rental not found',409);
  await audit(env.DB,'RENTAL_RETURNED',id);return Response.json({status:'RETURNED'});
 }
 if(path==='/api/disclosure/request'){
  const id=safeText(x.rental_id,50),reason=safeText(x.reason,200);
  const rental=await env.DB.prepare('SELECT r.id,r.status,t.expires_at FROM rental_requests r JOIN guarantee_tokens t ON t.rental_id=r.id WHERE r.id=?').bind(id).first<{id:string;expires_at:string;status:string}>();
  const owner=await env.DB.prepare('SELECT partner_id FROM rental_requests WHERE id=?').bind(id).first<{partner_id:string}>();
  if(!owner||!await approvedPartner(owner.partner_id))return fail('Partner authorization required',403);
  if(!rental||rental.status!=='ACTIVE'||rental.expires_at>now()||reason.length<5)return fail('Disclosure review only for overdue rentals',409);
  const case_id=crypto.randomUUID();await env.DB.prepare('INSERT INTO disclosure_requests(id,rental_id,reason,status,created_at) VALUES(?,?,?,?,?)').bind(case_id,id,reason,'PENDING_REVIEW',now()).run();
  await audit(env.DB,'DISCLOSURE_REQUESTED',id,'No personal information disclosed');return Response.json({case_id,status:'PENDING_REVIEW'});
 }
 return fail('Not found',404);
 }catch(e){const msg=e instanceof Error?e.message:'Unknown error';if(msg.includes('UNIQUE constraint'))return fail('Already processed',409);return fail('Unexpected request or database error',500)}
 };
 const result=await response();const headers=new Headers(result.headers);for(const [k,v]of Object.entries(cors))headers.set(k,v);headers.set('Cache-Control','no-store');return new Response(result.body,{status:result.status,headers});
 },
 async scheduled(_event:{scheduledTime:number},env:Env):Promise<void>{
  const oneWeek=new Date(Date.now()-7*86400000).toISOString();
  const oneMonth=new Date(Date.now()-30*86400000).toISOString();
  await env.DB.batch([
   env.DB.prepare('DELETE FROM request_limits WHERE at < ?').bind(oneWeek),
   env.DB.prepare('DELETE FROM demo_notices WHERE at < ?').bind(oneMonth)
  ]);
  await audit(env.DB,'DEMO_RETENTION_CLEANUP',null,'Purged temporary rate-limit events >7d and notices >30d; audit history preserved');
 }
 };
