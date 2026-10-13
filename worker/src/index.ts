interface Env{DB:D1Database;ADMIN_KEY:string;TOKEN_SECRET:string;ALLOWED_ORIGIN:string}
const enc=new TextEncoder();
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
async function sha(s:string){return hex(await crypto.subtle.digest('SHA-256',enc.encode(s)))}
async function sign(secret:string,message:string){const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(await crypto.subtle.sign('HMAC',key,enc.encode(message)))}
const now=()=>new Date().toISOString();
function fail(msg:string,status=400){return new Response(JSON.stringify({error:msg}),{status,headers:{'Content-Type':'application/json; charset=utf-8'}})}
function safeText(v:unknown,max=120){return typeof v==='string'?v.trim().slice(0,max):''}
async function body(r:Request){return await r.json() as Record<string,unknown>}
async function audit(db:D1Database,t:string,id:string|null,detail=''){await db.prepare('INSERT INTO audit_events(id,event_type,rental_id,at,detail) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),t,id,now(),detail).run()}
export default {async fetch(req:Request,env:Env):Promise<Response>{
 const origin=req.headers.get('Origin');const allowed=env.ALLOWED_ORIGIN;
 const cors:Record<string,string>={'Vary':'Origin','Access-Control-Allow-Headers':'Content-Type,X-Demo-Device,X-Admin-Key,X-Partner-Key','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
 if(origin&&allowed&&(allowed===origin))cors['Access-Control-Allow-Origin']=origin;
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 const response=async()=>{
 try{
 const path=new URL(req.url).pathname;
 if(path==='/health')return Response.json({service:'SafePass PoC',ok:!!env.DB,simulation:true});
 if(!env.DB||!env.TOKEN_SECRET||!env.ADMIN_KEY||!env.ALLOWED_ORIGIN)return fail('Server configuration incomplete',503);
 const adminOK=!!env.ADMIN_KEY&&req.headers.get('X-Admin-Key')===env.ADMIN_KEY;
 const key=safeText(req.headers.get('X-Partner-Key'),200);
 async function approvedPartner(partnerId:string){
  if(!key)return false;
  const record=await env.DB.prepare('SELECT key_hash,status FROM partners WHERE id=?').bind(partnerId).first<{key_hash:string;status:string}>();
  return !!record&&record.status==='APPROVED'&&record.key_hash===await sha(key);
 }
 if(path==='/api/admin/partners'&&req.method==='GET'){
  if(!adminOK)return fail('Unauthorized',401);
  const rows=await env.DB.prepare('SELECT id,name,status,created_at,approved_at FROM partners ORDER BY created_at DESC LIMIT 100').all();
  return Response.json({partners:rows.results});
 }
 if(path==='/api/admin/disclosures'&&req.method==='GET'){
  if(!adminOK)return fail('Unauthorized',401);
  const rows=await env.DB.prepare('SELECT d.id,d.rental_id,d.reason,d.status,d.created_at,d.reviewed_at,r.partner_id FROM disclosure_requests d JOIN rental_requests r ON r.id=d.rental_id ORDER BY d.created_at DESC LIMIT 100').all();
  return Response.json({cases:rows.results});
 }
 if(path==='/api/admin/overview'){
  if(!adminOK)return fail('Unauthorized',401);
  const [a,b,c]=await Promise.all([env.DB.prepare('SELECT COUNT(*) n FROM rental_requests').first<{n:number}>(),env.DB.prepare('SELECT COUNT(*) n FROM guarantee_tokens').first<{n:number}>(),env.DB.prepare('SELECT event_type,rental_id,at,detail FROM audit_events ORDER BY at DESC LIMIT 30').all()]);
  return Response.json({rentals:a?.n||0,tokens:b?.n||0,events:c.results});
 }
 if(req.method!=='POST')return fail('Not found',404);
 if(origin&&origin!==allowed)return fail('Origin not allowed',403);
 const x=await body(req),device=safeText(req.headers.get('X-Demo-Device'),60);
 if(path==='/api/admin/partner/decide'){
  if(!adminOK)return fail('Unauthorized',401);
  const id=safeText(x.partner_id,50),action=x.action;
  if(!['APPROVED','REJECTED','SUSPENDED'].includes(String(action)))return fail('Invalid decision');
  const r=await env.DB.prepare('UPDATE partners SET status=?,approved_at=? WHERE id=?').bind(action,now(),id).run();
  if(r.meta.changes!==1)return fail('Partner not found',404);
  await audit(env.DB,'PARTNER_'+action,null,id);return Response.json({partner_id:id,status:action});
 }
 if(path==='/api/admin/disclosure/decide'){
  if(!adminOK)return fail('Unauthorized',401);
  const id=safeText(x.case_id,60),decision=String(x.decision);
  if(!['APPROVED_FOR_REVIEW','REJECTED'].includes(decision))return fail('Invalid decision');
  const result=await env.DB.prepare("UPDATE disclosure_requests SET status=?,reviewed_at=? WHERE id=? AND status='PENDING_REVIEW'").bind(decision,now(),id).run();
  if(result.meta.changes!==1)return fail('Pending case not found',409);
  await audit(env.DB,'DISCLOSURE_'+decision,null,id+'; no personal data released');
  return Response.json({case_id:id,status:decision,personal_data_released:false});
 }
 if(path==='/api/partner/register'){
  const id=safeText(x.partner_id,50),name=safeText(x.name,100);
  if(!/^[a-z0-9-]{4,50}$/.test(id)||name.length<2)return fail('Partner ID and name required');
  // Generate a unique 256-bit secret on the server; never persist plaintext.
  const secret=hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
  await env.DB.prepare('INSERT INTO partners(id,name,key_hash,status,created_at) VALUES(?,?,?,?,?)').bind(id,name,await sha(secret),'PENDING',now()).run();
  await audit(env.DB,'PARTNER_REGISTERED',null,id);return Response.json({partner_id:id,status:'PENDING',partner_key:secret});
 }
 if(!device||! /^[a-f0-9-]{36}$/i.test(device))return fail('Demo device ID required',401);
 if(path==='/api/request/create'){
  const partner=safeText(x.partner_id,50),item=safeText(x.item,100),hours=Number(x.hours);
  if(!await approvedPartner(partner)||!item||!Number.isInteger(hours)||hours<1||hours>168)return fail('Invalid rental request');
  const id=crypto.randomUUID(),nonce=crypto.randomUUID(),expires=new Date(Date.now()+Math.min(hours*3600000,24*3600000)).toISOString();
  const code=`SP1.${id}.${nonce}.${await sign(env.TOKEN_SECRET,`${id}.${nonce}`)}`;
  await env.DB.prepare('INSERT INTO rental_requests(id,partner_id,item,hours,request_code_hash,status,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)').bind(id,partner,item,hours,await sha(code),'REQUESTED',now(),expires).run();
  await audit(env.DB,'REQUEST_CREATED',id);return Response.json({rental_id:id,request_code:code});
 }
 if(path==='/api/request/inspect'||path==='/api/token/issue'){
  const code=safeText(x.request_code,300),parts=code.split('.');
  if(parts.length!==4||parts[0]!=='SP1'||! /^[0-9a-f-]{36}$/i.test(parts[1])||await sign(env.TOKEN_SECRET,`${parts[1]}.${parts[2]}`)!==parts[3])return fail('Invalid request code');
  const row=await env.DB.prepare('SELECT * FROM rental_requests WHERE id=? AND request_code_hash=?').bind(parts[1],await sha(code)).first<Record<string,any>>();
  if(!row||row.status!=='REQUESTED'||row.expires_at<=now())return fail('Request expired or used',409);
  if(path==='/api/request/inspect')return Response.json({rental_id:row.id,partner_name:row.partner_id,item:row.item,hours:row.hours});
  if(x.simulation_pin!=='1234')return fail('Simulation authentication failed',401);
  const token_id=crypto.randomUUID(),expires=new Date(Date.now()+Number(row.hours)*3600000).toISOString(),token=await sign(env.TOKEN_SECRET,`${token_id}.${row.id}.${expires}`);
  const batch=await env.DB.batch([env.DB.prepare("UPDATE rental_requests SET status='ACTIVE' WHERE id=? AND status='REQUESTED'").bind(row.id),env.DB.prepare("INSERT INTO guarantee_tokens(id,rental_id,holder_pseudonym,token_hash,status,issued_at,expires_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM rental_requests WHERE id=? AND status='ACTIVE')").bind(token_id,row.id,await sha(device),await sha(token),'ACTIVE',now(),expires,row.id)]);
  if(batch[0].meta.changes!==1||batch[1].meta.changes!==1)return fail('Request already used',409);
  await audit(env.DB,'TOKEN_ISSUED',row.id);return Response.json({token_id,rental_id:row.id,expires_at:expires,status:'ACTIVE'});
 }
 if(path==='/api/rental/status'){
  const id=safeText(x.rental_id,50);
  const row=await env.DB.prepare('SELECT r.id,r.status,r.partner_id,r.item,r.expires_at,t.status token_status,t.expires_at token_expires,t.holder_pseudonym FROM rental_requests r LEFT JOIN guarantee_tokens t ON t.rental_id=r.id WHERE r.id=?').bind(id).first<Record<string,any>>();
  if(!row)return fail('Rental not found',404);
  const holder=!!device&&row.holder_pseudonym===await sha(device);
  if(!holder&&!await approvedPartner(row.partner_id))return fail('Not authorized for rental',403);
  const valid=row.status==='ACTIVE'&&row.token_status==='ACTIVE'&&row.token_expires>now();
  return Response.json({rental_id:id,item:row.item,status:row.status,token_status:row.token_status||'NOT_ISSUED',valid,expires_at:row.token_expires||row.expires_at});
 }
 if(path==='/api/token/verify'){
  const id=safeText(x.rental_id,50);
  const row=await env.DB.prepare('SELECT r.status rental_status,t.status token_status,t.expires_at FROM rental_requests r LEFT JOIN guarantee_tokens t ON t.rental_id=r.id WHERE r.id=?').bind(id).first<Record<string,any>>();
  if(!row)return fail('Rental not found',404);
  const owner=await env.DB.prepare('SELECT partner_id FROM rental_requests WHERE id=?').bind(id).first<{partner_id:string}>();
  if(!owner||!await approvedPartner(owner.partner_id))return fail('Partner authorization required',403);
  const valid=row.rental_status==='ACTIVE'&&row.token_status==='ACTIVE'&&row.expires_at>now();
  await audit(env.DB,'TOKEN_VERIFIED',id,valid?'valid':'invalid');return Response.json({valid,status:valid?'ACTIVE':row.rental_status==='RETURNED'?'REVOKED':'INVALID'});
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
  const rental=await env.DB.prepare('SELECT id,expires_at,status FROM rental_requests WHERE id=?').bind(id).first<{id:string;expires_at:string;status:string}>();
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
 }};
