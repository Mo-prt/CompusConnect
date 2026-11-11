import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {handleApi} from '../worker/api.mjs';
import {SupabaseStore} from '../worker/storage/supabase.mjs';
import {moroccoInstant,moroccoParts} from '../worker/time.mjs';
import {postgrestFixture} from './helpers/postgrest.mjs';

const env={SUPABASE_URL:'https://example.supabase.co/rest/v1/',SUPABASE_SECRET_KEY:'sb_secret_test_only'};
const id=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const ids={department:id(1),otherDepartment:id(2),program:id(3),otherProgram:id(4),semester:id(5),teacher:id(10),head:id(11),organizer:id(12),student:id(13),second:id(14),admin:id(15),suspended:id(16),otherOrganizer:id(17),module:id(20),room:id(21),timetable:id(22),event:id(30),draft:id(31)};
const code='DEMO-SIIA',otherCode='DEMO-MATH';
const accounts=[];let pg,transport,originalFetch,student,organizer;
const password='Password-test-123';
const eventDate=()=>new Date(Date.now()+30*86400000).toISOString().slice(0,10);
const fields=(overrides={})=>({title:'Atelier sur le campus',description:'Un atelier pratique organisé pour les étudiants du campus.',category:'Atelier',date:eventDate(),time:'09:00',endTime:'12:00',location:'Labo informatique',capacity:2,programs:[],...overrides});
async function call(path,method='GET',body,cookie,headers={}){
  const response=await handleApi(new Request('https://campus.test/api'+path,{method,headers:{'Content-Type':'application/json',Origin:'https://campus.test',...(cookie?{Cookie:cookie}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})}),env);
  return {status:response.status,data:await response.json(),cookie:response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '),cookies:response.headers.getSetCookie()};
}
const login=(name,program=code)=>call('/auth/login','POST',{email:name+'@example.test',password,program});
before(async()=>{
  pg=new PGlite();await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
  await pg.exec(await fs.readFile(new URL('./helpers/existing-schema.sql',import.meta.url),'utf8'));
  await pg.query('INSERT INTO public.departments(id,name,code,email,office_location) VALUES($1,$2,$3,$4,$5),($6,$7,$8,$9,$10)',[ids.department,'Informatique','INFO','department@example.test','Bureau B12',ids.otherDepartment,'Mathématiques','MATH','math@example.test','Bureau A1']);
  await pg.query('INSERT INTO public.programs(id,department_id,name,code) VALUES($1,$2,$3,$4),($5,$6,$7,$8)',[ids.program,ids.department,'Systèmes informatiques',code,ids.otherProgram,ids.otherDepartment,'Mathématiques',otherCode]);
  await pg.query("INSERT INTO public.semesters(id,name,number,academic_year) VALUES($1,'Semestre 1',1,'2026-2027')",[ids.semester]);
  for(const [name,uuid,role,program]of [['teacher',ids.teacher,2,ids.program],['head',ids.head,3,ids.program],['organizer',ids.organizer,4,ids.program],['student',ids.student,1,ids.program],['second',ids.second,1,ids.program],['admin',ids.admin,5,ids.program],['suspended',ids.suspended,1,ids.program],['other-organizer',ids.otherOrganizer,4,ids.otherProgram]]){
    accounts.push({id:uuid,email:name+'@example.test',password,confirmed:true,metadata:{first_name:name,last_name:'Test',role:'admin'}});
    await pg.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[uuid,name+'@example.test']);
    await pg.query("INSERT INTO public.profiles(id,program_id,department_id,first_name,last_name,email,account_status) VALUES($1,$2,$3,$4,'Test',$5,$6)",[uuid,program,program===ids.program?ids.department:ids.otherDepartment,name,name+'@example.test',name==='suspended'?'suspended':'active']);
    await pg.query('INSERT INTO public.user_roles(user_id,role_id) VALUES($1,$2)',[uuid,role]);
  }
  await pg.query("INSERT INTO public.department_heads(department_id,user_id,office_hours) VALUES($1,$2,'Mardi, 10h – 12h')",[ids.department,ids.head]);
  await pg.query("INSERT INTO public.modules(id,code,title,objectives,weekly_hours,semester_id,responsible_teacher_id) VALUES($1,'M101','Données et systèmes','Comprendre les bases relationnelles.',4.5,$2,$3)",[ids.module,ids.semester,ids.teacher]);
  await pg.query("INSERT INTO public.program_modules(program_id,module_id,academic_year) VALUES($1,$2,'2026-2027')",[ids.program,ids.module]);
  await pg.query("INSERT INTO public.classrooms(id,name,building) VALUES($1,'Salle B14','Bâtiment B')",[ids.room]);
  await pg.query("INSERT INTO public.timetables(id,program_id,semester_id,academic_year,title,is_current) VALUES($1,$2,$3,'2026-2027','Semestre 1',true)",[ids.timetable,ids.program,ids.semester]);
  await pg.query("INSERT INTO public.timetable_sessions(timetable_id,module_id,teacher_id,classroom_id,weekday,starts_at,ends_at,session_type) VALUES($1,$2,$3,$4,3,'09:15','11:15','practical')",[ids.timetable,ids.module,ids.teacher,ids.room]);
  for(const [uuid,status]of [[ids.event,'published'],[ids.draft,'draft']])await pg.query('INSERT INTO public.events(id,organizer_id,title,description,category,starts_at,ends_at,location_text,capacity,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[uuid,ids.organizer,'Conférence existante','Description déjà enregistrée dans la base.','conference',moroccoInstant(eventDate(),'14:00'),moroccoInstant(eventDate(),'17:00'),'Amphi A',null,status]);
  await pg.exec("ALTER TABLE public.events ENABLE ROW LEVEL SECURITY; CREATE POLICY preserved_policy ON public.events FOR SELECT TO authenticated USING(status='published');");
  await pg.exec(await fs.readFile(new URL('../supabase/migrations/20261111000100_existing_schema.sql',import.meta.url),'utf8'));
  originalFetch=globalThis.fetch;transport=postgrestFixture(pg,accounts);globalThis.fetch=transport;
});
after(async()=>{globalThis.fetch=originalFetch;await pg?.close()});

test('server configuration refuses public/anon keys, missing credentials and unsafe URLs',()=>{
  for(const key of ['', 'sb_publishable_example','header.'+btoa(JSON.stringify({role:'anon'}))+'.sig'])assert.throws(()=>new SupabaseStore({...env,SUPABASE_SECRET_KEY:key}),/clé serveur/);
  assert.throws(()=>new SupabaseStore({DB:{}}),/clé serveur/);
  for(const url of ['http://example.supabase.co','https://example.supabase.co/other','https://example.supabase.co?key=bad'])assert.throws(()=>new SupabaseStore({...env,SUPABASE_URL:url}),/HTTPS/);
  assert.equal(new SupabaseStore(env).origin,'https://example.supabase.co');
});

test('transport keeps safe status/code diagnostics and never returns SQL or key material',async()=>{
  let options;
  const db=new SupabaseStore(env,async(url,init)=>{options=init;return Response.json({code:'PGRST202',message:'private SQL detail',key:'private value'},{status:404})});
  await assert.rejects(db.rpc('missing',{}),error=>error.status===502&&error.supabaseCode==='PGRST202'&&error.supabaseStatus===404&&!error.message.includes('private'));
  assert.equal(options.headers.apikey,env.SUPABASE_SECRET_KEY);assert.equal(options.headers.Authorization,undefined);assert.equal(options.redirect,'error');
  const legacy='header.'+btoa(JSON.stringify({role:'service_role'}))+'.sig';
  await new SupabaseStore({...env,SUPABASE_SECRET_KEY:legacy},async(url,init)=>{assert.equal(init.headers.Authorization,'Bearer '+legacy);return Response.json([])}).all('roles');
});

test('compatibility migration preserves records, policies and the existing UUID schema',async()=>{
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM public.events')).rows[0].n,2);
  assert.equal((await pg.query("SELECT count(*)::int AS n FROM pg_policies WHERE policyname='preserved_policy'")).rows[0].n,1);
  assert.equal((await pg.query("SELECT to_regclass('public.users') AS users,to_regclass('public.sessions') AS sessions")).rows[0].users,null);
  assert.equal((await pg.query("SELECT has_function_privilege('anon','public.campus_existing_register(uuid,uuid,boolean)','EXECUTE') AS anon,has_function_privilege('service_role','public.campus_existing_register(uuid,uuid,boolean)','EXECUTE') AS backend")).rows[0].anon,false);
  await pg.exec(await fs.readFile(new URL('../supabase/migrations/20261111000100_existing_schema.sql',import.meta.url),'utf8'));
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM public.events')).rows[0].n,2);
});

test('bootstrap reads existing programs, departments, modules and nonstandard session times',async()=>{
  const result=await call('/bootstrap?program='+code+'&semester=S1');assert.equal(result.status,200);
  assert.equal(result.data.program,code);assert.equal(result.data.semester,'S1');assert.equal(result.data.semesterId,ids.semester);
  assert.equal(result.data.modules[0][0],'M101');assert.equal(result.data.modules[0][3],4.5);
  assert.equal(result.data.programs.find(p=>p.id===code).head,'head Test');
  assert.equal(result.data.schedule[0].day,2);assert.equal(result.data.schedule[0].start,'09:15');assert.equal(result.data.schedule[0].type,'TP');
  assert.equal(result.data.events.length,1);assert.equal(result.data.events[0].category,'Conférence');assert.equal(result.data.events[0].capacity,null);
  assert.equal(result.data.demoEnabled,false);
});

test('Supabase Auth validates passwords and roles come exclusively from user_roles',async()=>{
  assert.equal((await call('/auth/login','POST',{email:'student@example.test',password:'wrongpass',program:code})).status,401);
  assert.equal((await login('student',otherCode)).status,401);
  student=await login('student');organizer=await login('organizer');assert.equal(student.status,200);assert.equal(organizer.status,200);
  assert.equal(student.data.user.role,'student');assert.deepEqual(student.data.user.roles,['student']);
  assert.ok(!JSON.stringify(student.data).includes('access-'));assert.equal(student.cookies.length,2);
  for(const value of student.cookies){assert.match(value,/HttpOnly/);assert.match(value,/Secure/);assert.match(value,/SameSite=Strict/)}
  assert.equal((await login('head')).data.user.role,'teacher');assert.equal((await login('suspended')).status,403);
  assert.equal((await call('/auth/me','GET',null,student.cookie)).data.user.id,ids.student);
});

test('signup handles email confirmation and only assigns the student role after validated login',async()=>{
  const body={email:'new@example.test',password,name:'Nouvel Étudiant',program:code,role:'organizer'};
  const signup=await call('/auth/register','POST',body);assert.equal(signup.status,202);assert.equal(signup.data.requiresEmailConfirmation,true);
  const account=accounts.find(a=>a.email===body.email);assert.equal(account.metadata.role,undefined);
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM public.profiles WHERE id=$1',[account.id])).rows[0].n,0);
  assert.equal((await call('/auth/login','POST',body)).status,401);
  account.confirmed=true;
  const signed=await call('/auth/login','POST',body);assert.equal(signed.status,200);assert.equal(signed.data.user.role,'student');
  assert.equal((await pg.query('SELECT r.code FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id WHERE ur.user_id=$1',[account.id])).rows[0].code,'student');
});

test('forged or expired access tokens cannot impersonate a profile and refresh rotates cookies',async()=>{
  const forged=await call('/events','POST',fields(),'campus_access_token=forged',{'oai-authenticated-user-id':ids.organizer});assert.equal(forged.status,401);
  const fresh=await login('student');const access=decodeURIComponent(fresh.cookie.match(/campus_access_token=([^;]+)/)[1]);transport.expireAccess(access);
  const refreshed=await call('/auth/me','GET',null,fresh.cookie);assert.equal(refreshed.status,200);assert.equal(refreshed.data.user.id,ids.student);assert.ok(refreshed.cookie);assert.notEqual(refreshed.cookie,fresh.cookie);
  assert.equal((await call('/auth/me','GET',null,fresh.cookie)).data.user,null);
});

test('anonymous and academic profiles cannot mutate organizer data or grant themselves demo roles',async()=>{
  assert.equal((await call('/events','POST',fields())).status,401);
  assert.equal((await call('/events','POST',fields(),student.cookie)).status,403);
  const teacher=await login('teacher');assert.equal((await call('/events','POST',fields(),teacher.cookie)).status,403);
  assert.equal((await call('/auth/demo','POST',{role:'admin'})).status,410);
  assert.equal((await call('/bootstrap','GET',null,organizer.cookie)).data.events.some(e=>e.id===ids.draft),true);
});

let eventId;
test('organizers create timestamp-based events and multiple program targets transactionally',async()=>{
  assert.equal((await call('/events/'+ids.draft,'PUT',fields({status:'published'}),organizer.cookie)).status,200);
  assert.equal((await pg.query('SELECT status FROM public.events WHERE id=$1',[ids.draft])).rows[0].status,'published');
  const created=await call('/events','POST',fields({programs:[code,otherCode]}),organizer.cookie);assert.equal(created.status,201);eventId=created.data.id;
  const row=(await pg.query('SELECT * FROM public.events WHERE id=$1',[eventId])).rows[0];assert.equal(row.organizer_id,ids.organizer);assert.equal(row.status,'published');
  assert.equal((await pg.query('SELECT count(*)::int AS n FROM public.event_program_targets WHERE event_id=$1',[eventId])).rows[0].n,2);
  const event=(await call('/bootstrap','GET',null,student.cookie)).data.events.find(e=>e.id===eventId);assert.deepEqual(new Set(event.programs),new Set([code,otherCode]));assert.equal(event.time,'09:00');assert.equal(event.endTime,'12:00');
});

test('registration preserves status history, counts active seats and supports re-enrollment',async()=>{
  const path='/events/'+eventId+'/register';
  assert.equal((await call(path,'POST',{},student.cookie)).status,201);
  assert.equal((await call(path,'POST',{},student.cookie)).status,409);
  assert.equal((await call(path,'DELETE',{},student.cookie)).status,200);
  const cancelled=(await pg.query('SELECT * FROM public.event_registrations WHERE event_id=$1 AND student_id=$2',[eventId,ids.student])).rows[0];assert.equal(cancelled.status,'cancelled');assert.ok(cancelled.cancelled_at);
  assert.equal((await call(path,'POST',{},student.cookie)).status,201);
  const active=(await pg.query('SELECT * FROM public.event_registrations WHERE event_id=$1 AND student_id=$2',[eventId,ids.student])).rows[0];assert.equal(active.id,cancelled.id);assert.equal(active.status,'registered');assert.equal(active.cancelled_at,null);
});

test('row-locked functions enforce capacity and ownership even when API validation is bypassed',async()=>{
  const db=new SupabaseStore(env);
  const results=await Promise.all([db.register(ids.second,eventId),db.register(ids.admin,eventId)]);
  assert.equal(results.filter(x=>x.status==='ok').length,1);assert.equal(results.filter(x=>x.status==='full').length,1);
  const body={title:'Capacité réduite',description:'Description test',category:'Atelier',starts_at:moroccoInstant(eventDate(),'09:00'),ends_at:moroccoInstant(eventDate(),'12:00'),location_text:'Salle A',capacity:1,program_ids:[]};
  assert.equal((await db.saveEvent(ids.organizer,eventId,body)).status,'capacity');
  assert.equal((await db.saveEvent(ids.otherOrganizer,eventId,{...body,capacity:10})).status,'forbidden');
  assert.equal((await db.register(ids.teacher,eventId)).status,'forbidden');
});

test('program targeting, participants and profile updates use existing relational fields',async()=>{
  const targeted=await call('/events','POST',fields({programs:[otherCode]}),organizer.cookie);assert.equal(targeted.status,201);
  assert.equal((await call('/events/'+targeted.data.id+'/register','POST',{},student.cookie)).status,403);
  const participants=await call('/events/'+eventId+'/participants','GET',null,organizer.cookie);assert.equal(participants.status,200);assert.equal(participants.data.participants.length,2);assert.ok(participants.data.participants.some(p=>p.email==='student@example.test'));
  assert.equal((await call('/events/'+eventId+'/participants','GET',null,student.cookie)).status,403);
  const other=await login('other-organizer',otherCode);assert.equal((await call('/events/'+eventId,'DELETE',{},other.cookie)).status,403);
  assert.equal((await call('/profile','PUT',{name:'Étudiant Modifié',program:otherCode},student.cookie)).status,200);
  const me=await call('/auth/me','GET',null,student.cookie);assert.equal(me.data.user.program,otherCode);assert.equal(me.data.user.name,'Étudiant Modifié');
  await call('/profile','PUT',{name:'student Test',program:code},student.cookie);
});

test('cross-origin writes and invalid timestamps or event IDs are rejected',async()=>{
  assert.equal((await call('/events','POST',fields(),organizer.cookie,{Origin:'https://other.test'})).status,403);
  assert.equal((await call('/events','POST',fields({date:'2026-02-31'}),organizer.cookie)).status,400);
  assert.equal((await call('/events','POST',fields({capacity:0}),organizer.cookie)).status,400);
  assert.equal((await call('/events/not-a-uuid','DELETE',{},organizer.cookie)).status,400);
  const tomorrow=new Date(Date.parse(eventDate())+86400000).toISOString().slice(0,10);
  assert.equal((await call('/events','POST',fields({time:'20:00',endTime:'08:00',endDate:tomorrow}),organizer.cookie)).status,201);
});

test('cancellation retains registrations and logout invalidates the Auth session',async()=>{
  assert.equal((await call('/events/'+eventId,'DELETE',{},organizer.cookie)).status,200);
  assert.equal((await call('/events/'+eventId+'/register','POST',{},student.cookie)).status,409);
  const joined=(await call('/bootstrap','GET',null,student.cookie)).data.events.find(e=>e.id===eventId);assert.equal(joined.status,'cancelled');assert.equal(joined.joined,true);
  assert.equal((await call('/auth/logout','POST',{},student.cookie)).status,200);
  assert.equal((await call('/auth/me','GET',null,student.cookie)).data.user,null);
});

test('Morocco timestamp conversion follows the date-specific offset, including Ramadan',()=>{
  assert.equal(moroccoInstant('2024-11-18','09:00'),'2024-11-18T08:00:00.000Z');
  assert.equal(moroccoInstant('2024-03-24','09:00'),'2024-03-24T09:00:00.000Z');
  assert.deepEqual(moroccoParts(moroccoInstant('2024-03-24','09:00')),{date:'2024-03-24',time:'09:00'});
});


test('table reads paginate beyond the default PostgREST page without losing seat counts',async()=>{
  const calls=[];
  const client=new SupabaseStore(env,async(url)=>{
    const parsed=new URL(url),offset=Number(parsed.searchParams.get('offset')),limit=Number(parsed.searchParams.get('limit'));
    calls.push(offset);return Response.json(Array.from({length:Math.max(0,Math.min(limit,1001-offset))},(_,i)=>({id:offset+i})));
  });
  const rows=await client.all('event_registrations');assert.equal(rows.length,1001);assert.deepEqual(calls,[0,500,1000]);
});
