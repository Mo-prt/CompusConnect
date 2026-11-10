import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {handleApi} from '../worker/api.mjs';
import {SupabaseStore} from '../worker/storage/supabase.mjs';
import {postgrestFixture} from './helpers/postgrest.mjs';

const env={SUPABASE_URL:'https://example.supabase.co/rest/v1/',SUPABASE_SECRET_KEY:'sb_secret_test_only'};
let pg,originalFetch,student,organizer;
async function call(path,method='GET',body,cookie,owner='owner1'){
  const result=await handleApi(new Request('https://campus.test/api'+path,{method,headers:{'Content-Type':'application/json',Origin:'https://campus.test','oai-authenticated-user-id':owner,...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})}),env);
  return {status:result.status,data:await result.json(),cookie:result.headers.get('set-cookie')?.split(';')[0]};
}
const futureDate=()=>new Date(Date.now()+86400000*30).toISOString().slice(0,10);
const newEvent=(overrides={})=>({title:'Atelier PostgreSQL',category:'Atelier',date:futureDate(),time:'09:00',endTime:'12:00',location:'Labo FPK',organizer:'Club Informatique',capacity:2,program:'Toutes',image:'web',description:'Un atelier pour découvrir PostgreSQL et vérifier les inscriptions.',...overrides});
before(async()=>{
  pg=new PGlite();
  await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
  await pg.exec(await fs.readFile(new URL('../supabase/migrations/20261110000100_campusconnect.sql',import.meta.url),'utf8'));
  originalFetch=globalThis.fetch;globalThis.fetch=postgrestFixture(pg);
});
after(async()=>{globalThis.fetch=originalFetch;await pg?.close()});

test('configuration rejects publishable keys, missing secrets and unsafe project URLs',()=>{
  assert.throws(()=>new SupabaseStore({...env,SUPABASE_SECRET_KEY:'sb_publishable_example'}),/clé serveur/);
  assert.throws(()=>new SupabaseStore({...env,SUPABASE_SECRET_KEY:''}),/clé serveur/);
  assert.throws(()=>new SupabaseStore({DB:{}}),/clé serveur/);
  assert.throws(()=>new SupabaseStore({...env,SUPABASE_URL:'http://example.supabase.co'}),/HTTPS/);
  assert.throws(()=>new SupabaseStore({...env,SUPABASE_URL:'https://example.supabase.co/other'}),/HTTPS/);
  assert.equal(new SupabaseStore(env).base,'https://example.supabase.co/rest/v1/');
  const anonJwt='header.'+btoa(JSON.stringify({role:'anon'}))+'.signature';
  assert.throws(()=>new SupabaseStore({...env,SUPABASE_SECRET_KEY:anonJwt}),/clé serveur/);
});

test('secret keys use apikey without JWT authorization and remote errors never leak',async()=>{
  let received;
  const client=new SupabaseStore(env,async(url,options)=>{received={url,options};return Response.json({message:'sensitive SQL detail',secret:'not-for-clients'},{status:500})});
  await assert.rejects(client.listEvents('campus','u'),error=>error.status===502&&!error.message.includes('sensitive'));
  assert.equal(received.options.headers.apikey,env.SUPABASE_SECRET_KEY);
  assert.equal(received.options.headers.Authorization,undefined);
  assert.equal(received.options.redirect,'error');
  const legacy='header.'+btoa(JSON.stringify({role:'service_role'}))+'.signature';
  const oldClient=new SupabaseStore({...env,SUPABASE_SECRET_KEY:legacy},async(url,options)=>{assert.equal(options.headers.Authorization,'Bearer '+legacy);return Response.json([])});
  assert.deepEqual(await oldClient.listEvents('campus',''),[]);
  const unavailable=new SupabaseStore(env,async()=>{throw new Error('network failure')});
  await assert.rejects(unavailable.listEvents('campus',''),error=>error.status===503);
});

test('migration denies anonymous table and RPC access, grants backend access and enables RLS',async()=>{
  const row=(await pg.query("SELECT has_table_privilege('anon','public.users','SELECT') AS anon_read,has_table_privilege('service_role','public.users','SELECT') AS backend_read,has_function_privilege('anon','public.campus_register(text,text,text)','EXECUTE') AS anon_rpc,has_function_privilege('service_role','public.campus_register(text,text,text)','EXECUTE') AS backend_rpc")).rows[0];
  assert.deepEqual(row,{anon_read:false,backend_read:true,anon_rpc:false,backend_rpc:true});
  const tables=(await pg.query("SELECT relname,relrowsecurity FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r'")).rows;
  assert.equal(tables.length,5);assert.ok(tables.every(t=>t.relrowsecurity));
  await pg.exec('SET ROLE anon');
  try { await assert.rejects(pg.query('SELECT * FROM public.users'),/permission denied/); await assert.rejects(pg.query("SELECT public.campus_list_events('campus','')"),/permission denied/); }
  finally { await pg.exec('RESET ROLE'); }
});

test('PostgreSQL-backed API preserves demos and bootstrap response shapes',async()=>{
  const bootstrap=await call('/bootstrap');assert.equal(bootstrap.status,200);assert.equal(bootstrap.data.events.length,6);assert.equal(bootstrap.data.modules.length,6);
  assert.equal(bootstrap.data.events[0].endTime,'17:00');assert.equal(typeof bootstrap.data.events[0].joined,'boolean');
  student=await call('/auth/demo','POST',{role:'student'});organizer=await call('/auth/demo','POST',{role:'organizer'});
  assert.equal(student.data.user.role,'student');assert.equal(organizer.data.user.role,'organizer');
  assert.equal((await call('/auth/me','GET',null,student.cookie)).data.user.id,student.data.user.id);
  assert.equal((await call('/auth/me','GET',null,student.cookie,'other-owner')).data.user,null);
});

test('anonymous, student and teacher profiles cannot perform organizer actions',async()=>{
  assert.equal((await call('/events','POST',newEvent())).status,401);
  assert.equal((await call('/events','POST',newEvent(),student.cookie)).status,403);
  const teacher=await call('/auth/demo','POST',{role:'teacher'});
  assert.equal(teacher.status,200);assert.equal(teacher.data.user.role,'teacher');
  assert.equal((await call('/events','POST',newEvent(),teacher.cookie)).status,403);
  const created=await call('/events','POST',newEvent(),organizer.cookie);
  assert.equal(created.status,201);
  const other=await call('/auth/demo','POST',{role:'organizer'},null,'other-owner');
  assert.equal((await call('/events/'+created.data.id,'PUT',newEvent(),other.cookie,'other-owner')).status,404);
});

test('API rejects cross-origin writes, invalid input and duplicate accounts',async()=>{
  const response=await handleApi(new Request('https://campus.test/api/auth/demo',{
    method:'POST',headers:{Origin:'https://other.test','Content-Type':'application/json'},body:'{"role":"organizer"}'
  }),env);
  assert.equal(response.status,403);
  assert.equal((await call('/events','POST',newEvent({date:'2026-02-31'}),organizer.cookie)).status,400);
  assert.equal((await call('/events','POST',newEvent({capacity:0}),organizer.cookie)).status,400);
  const user={name:'Unique account',email:'unique@example.ma',password:'Password-test-123',program:'SIIA'};
  assert.equal((await call('/auth/register','POST',user)).status,200);
  assert.equal((await call('/auth/register','POST',user)).status,409);
});

test('PostgreSQL accounts hash passwords, enforce roles, filter filiere and update profiles',async()=>{
  const body={name:'Test PostgreSQL',email:'postgres@example.ma',password:'Password-test-123',program:'SIIA',role:'organizer'};
  const registered=await call('/auth/register','POST',body);assert.equal(registered.status,200);assert.equal(registered.data.user.role,'student');
  const stored=(await pg.query('SELECT * FROM public.users WHERE email=$1',[body.email])).rows[0];assert.equal(stored.password_hash.length,64);assert.notEqual(stored.password_hash,body.password);
  assert.equal((await call('/auth/login','POST',{...body,program:'SVI'})).status,401);
  assert.equal((await call('/auth/login','POST',{...body,password:'wrongpass'})).status,401);
  const login=await call('/auth/login','POST',body);assert.equal(login.status,200);
  assert.equal((await call('/profile','PUT',{name:'Nouveau nom',program:'SVI'},login.cookie)).status,200);
  const me=await call('/auth/me','GET',null,login.cookie);assert.equal(me.data.user.program,'SVI');assert.equal(me.data.user.name,'Nouveau nom');
});

let eventId;
test('event creation, registration, duplicate prevention and participants work through PostgreSQL RPC',async()=>{
  const created=await call('/events','POST',newEvent(),organizer.cookie);assert.equal(created.status,201);eventId=created.data.id;
  const path='/events/'+eventId;
  assert.equal((await call(path+'/register','POST',{},student.cookie)).status,201);
  assert.equal((await call(path+'/register','POST',{},student.cookie)).status,409);
  const list=await call(path+'/participants','GET',null,organizer.cookie);assert.equal(list.status,200);assert.equal(list.data.participants.length,1);
  assert.equal((await call(path+'/participants','GET',null,student.cookie)).status,403);
  const rows=(await call('/bootstrap','GET',null,student.cookie)).data.events;
  assert.equal(rows.find(e=>e.id===eventId).registered,1);assert.equal(rows.find(e=>e.id===eventId).joined,true);
});

test('database capacity and ownership checks survive direct concurrent RPC requests',async()=>{
  const scope=(await pg.query('SELECT scope FROM public.users WHERE id=$1',[student.data.user.id])).rows[0].scope;
  for(const [id,program]of [['second-student','SIIA'],['third-student','SIIA'],['other-program','SVI']])await pg.query("INSERT INTO public.users(id,email,name,program,semester,role,scope) VALUES($1,$2,$1,$3,'S9','student',$4)",[id,id+'@example.ma',program,scope]);
  const store=new SupabaseStore(env);
  const joined=await Promise.all([store.joinEvent(eventId,'second-student',scope),store.joinEvent(eventId,'third-student',scope)]);
  assert.equal(joined.filter(Boolean).length,1);
  assert.equal((await store.eventById(eventId,scope)).registered,2);
  assert.equal(await store.updateEvent(eventId,{...newEvent(),end_time:'12:00',capacity:1},organizer.data.user.id,scope),false);
  assert.equal(await store.updateEvent(eventId,{...newEvent(),end_time:'12:00',capacity:10},'not-owner',scope),false);
  assert.deepEqual(await store.participants(eventId,'not-owner',scope),[]);
  assert.equal(await store.eventById(eventId,'another-scope'),null);
  const targeted=await call('/events','POST',newEvent({program:'SVI'}),organizer.cookie);
  await assert.rejects(store.joinEvent(targeted.data.id,student.data.user.id,scope),error=>error.status===403);
});

test('modification, disenrollment, cancellation and session invalidation preserve API behavior',async()=>{
  assert.equal((await call('/events/'+eventId,'PUT',newEvent({capacity:3,title:'Atelier modifié PostgreSQL'}),organizer.cookie)).status,200);
  assert.equal((await call('/events/'+eventId+'/register','DELETE',{},student.cookie)).status,200);
  assert.equal((await call('/events/'+eventId,'DELETE',{},organizer.cookie)).status,200);
  assert.equal((await call('/events/'+eventId+'/register','POST',{},student.cookie)).status,409);
  assert.equal((await call('/auth/logout','POST',{},student.cookie)).status,200);
  assert.equal((await call('/auth/me','GET',null,student.cookie)).data.user,null);
});

test('PostgreSQL rate limiting uses one atomic upsert and resets expired windows',async()=>{
  const client=new SupabaseStore(env),now=Date.now();
  const counts=await Promise.all(Array.from({length:15},()=>client.recordAuthAttempt('atomic-test',now)));
  assert.deepEqual(counts.sort((a,b)=>a-b),Array.from({length:15},(_,i)=>i+1));
  assert.equal(await client.recordAuthAttempt('atomic-test',now+900001),1);
});
