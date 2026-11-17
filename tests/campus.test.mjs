import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {handleApi} from '../worker/api.mjs';
import {SupabaseStore} from '../worker/storage/supabase.mjs';
import {postgrestFixture} from './helpers/postgrest.mjs';

const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test_only'};
const uid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const ids={department:uid(1),otherDepartment:uid(2),program:uid(3),otherProgram:uid(4),semester:uid(5),module:uid(6),otherModule:uid(7)};
const people={student:uid(10),second:uid(11),outsider:uid(12),teacher:uid(13),head:uid(14),admin:uid(15),otherTeacher:uid(16)};
let pg,originalFetch;const accounts=[],sessions={};
const extraTables=['files','announcements','announcement_targets','course_documents','library_resources','library_resource_programs','complaints','complaint_messages','news_posts','lost_found_items','collaboration_spaces','collaboration_members','shared_resources','campus_discussions','campus_locations','marketplace_listings','marketplace_categories','marketplace_images','marketplace_transactions','notifications','campus_role_requests','recommendations','recommendation_feedback','resource_views','chat_conversations','chat_messages','campus_message_citations','campus_chat_feedback'];
async function call(path,method='GET',body,actor='student',headers={}){
  const response=await handleApi(new Request('https://campus.test/api'+path,{method,headers:{'Content-Type':'application/json',...(sessions[actor]?{Cookie:sessions[actor]}:{}),...headers},...(body===undefined?{}:{body:typeof body==='string'||body instanceof Uint8Array?body:JSON.stringify(body)})}),env);
  const data=method==='HEAD'?null:response.headers.get('Content-Type')?.includes('json')?await response.json():await response.text();return {status:response.status,data,response};
}
before(async()=>{
  pg=new PGlite();await pg.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
  await pg.exec(await fs.readFile(new URL('./helpers/existing-schema.sql',import.meta.url),'utf8'));
  await pg.exec(await fs.readFile(new URL('./helpers/campus-schema.sql',import.meta.url),'utf8'));
  await pg.query("INSERT INTO departments(id,name,code) VALUES($1,'Informatique','INFO'),($2,'Sciences','SCI')",[ids.department,ids.otherDepartment]);
  await pg.query("INSERT INTO programs(id,department_id,name,code) VALUES($1,$2,'SIIA','SIIA'),($3,$4,'Sciences','SCI')",[ids.program,ids.department,ids.otherProgram,ids.otherDepartment]);
  await pg.query("INSERT INTO semesters(id,name,number,academic_year) VALUES($1,'Semestre 9',9,'2026-2027')",[ids.semester]);
  for(const [name,userId]of Object.entries(people)){
    const other=['outsider','otherTeacher'].includes(name),role=name==='teacher'||name==='otherTeacher'?2:name==='head'?3:name==='admin'?5:1;
    accounts.push({id:userId,email:name.toLowerCase()+'@example.test',password:'password-test',confirmed:true});
    await pg.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[userId,name.toLowerCase()+'@example.test']);
    await pg.query("INSERT INTO profiles(id,first_name,last_name,program_id,department_id) VALUES($1,$2,'Test',$3,$4)",[userId,name,other?ids.otherProgram:ids.program,other?ids.otherDepartment:ids.department]);
    await pg.query('INSERT INTO user_roles(user_id,role_id) VALUES($1,$2)',[userId,role]);
  }
  await pg.query("INSERT INTO modules(id,code,title,semester_id,responsible_teacher_id) VALUES($1,'DL','Deep Learning',$2,$3),($4,'SCI','Sciences privées',$2,$5)",[ids.module,ids.semester,people.teacher,ids.otherModule,people.otherTeacher]);
  await pg.query("INSERT INTO program_modules(program_id,module_id,academic_year) VALUES($1,$2,'2026-2027'),($3,$4,'2026-2027')",[ids.program,ids.module,ids.otherProgram,ids.otherModule]);
  await pg.exec(await fs.readFile(new URL('../supabase/migrations/20261111000100_existing_schema.sql',import.meta.url),'utf8'));
  await pg.exec(await fs.readFile(new URL('../supabase/migrations/20261116000100_campus_services.sql',import.meta.url),'utf8'));
  originalFetch=globalThis.fetch;globalThis.fetch=postgrestFixture(pg,accounts,extraTables);
  for(const name of Object.keys(people)){
    const login=await call('/auth/login','POST',{email:name.toLowerCase()+'@example.test',password:'password-test'},'anonymous');
    assert.equal(login.status,200,JSON.stringify(login.data));sessions[name]=login.response.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  }
});
after(async()=>{globalThis.fetch=originalFetch;await pg?.close()});

test('service migration is repeatable, preserves data and denies anonymous access',async()=>{
  await pg.exec(await fs.readFile(new URL('../supabase/migrations/20261116000100_campus_services.sql',import.meta.url),'utf8'));
  assert.equal((await pg.query('SELECT count(*)::int n FROM profiles')).rows[0].n,7);
  const permission=(await pg.query("SELECT has_table_privilege('anon','public.campus_role_requests','SELECT') AS anon,has_function_privilege('authenticated','public.campus_marketplace_request(uuid,uuid)','EXECUTE') AS browser")).rows[0];
  assert.equal(permission.anon,false);assert.equal(permission.browser,false);
  assert.equal((await call('/campus','GET',undefined,'anonymous')).status,401);
});

test('teachers publish atomically for their modules and other programs cannot read targeted announcements',async()=>{
  const created=await call('/announcements','POST',{module_id:ids.module,title:'Changement de salle',body:'Le prochain cours de Deep Learning se déroule en salle B12.'},'teacher');
  assert.equal(created.status,201,JSON.stringify(created.data));
  assert.equal((await pg.query('SELECT count(*)::int n FROM announcement_targets WHERE announcement_id=$1',[created.data.id])).rows[0].n,1);
  assert.ok((await call('/campus')).data.announcements.some(a=>a.id===created.data.id));
  assert.ok(!(await call('/campus','GET',undefined,'outsider')).data.announcements.some(a=>a.id===created.data.id));
  assert.equal((await call('/announcements','POST',{module_id:ids.otherModule,title:'Mauvais module',body:'Un message qui ne doit pas être publié.'},'teacher')).status,403);
  assert.equal((await call('/announcements','POST',{module_id:ids.module,title:'Fausse autorisation',body:'Tentative avec rôle forgé.',role:'teacher'})).status,403);
});

let privateFile,privateResource;
test('uploads validate bytes and downloads enforce the resource audience, including guessed file IDs',async()=>{
  const upload=await call('/uploads?name=cours.pdf','POST',new TextEncoder().encode('%PDF-1.7\nsource test'),'student',{'Content-Type':'application/pdf'});
  assert.equal(upload.status,201,JSON.stringify(upload.data));privateFile=upload.data.file.id;
  assert.equal((await call('/uploads?name=bad.pdf','POST',new TextEncoder().encode('<script>bad</script>'),'student',{'Content-Type':'application/pdf'})).status,415);
  const saved=await call('/library','POST',{title:'Document confidentiel',resource_type:'book',file_id:privateFile,abstract:'Document visible par son auteur uniquement.',visibility:'private'});
  assert.equal(saved.status,201,JSON.stringify(saved.data));privateResource=saved.data.id;
  assert.equal((await call('/files/'+privateFile)).status,200);
  assert.equal((await call('/files/'+privateFile,'GET',undefined,'second')).status,403);
  assert.ok(!(await call('/campus','GET',undefined,'second')).data.library.some(r=>r.id===privateResource));
  assert.equal((await call('/library/'+privateResource+'/view','POST',{},'second')).status,404);
  assert.equal((await call('/documents','POST',{title:'Publication volée',module_id:ids.module,document_type:'course',file_id:privateFile},'teacher')).status,403);
});

test('complaints remain private and only authorized staff can make valid status transitions',async()=>{
  const created=await call('/complaints','POST',{subject:'Accès au cours',description:'Je ne peux pas ouvrir le document du module.',complaint_type:'pedagogical',module_id:ids.module});
  assert.equal(created.status,201,JSON.stringify(created.data));const path='/complaints/'+created.data.id;
  assert.equal((await call(path,'GET',undefined,'second')).status,403);
  assert.equal((await call(path,'GET',undefined,'outsider')).status,403);
  assert.equal((await call(path,'PATCH',{status:'resolved',resolution_note:'Tentative étudiante'})).status,403);
  assert.equal((await call(path,'PATCH',{status:'resolved',resolution_note:'Résolution trop tôt'},'head')).status,409);
  assert.equal((await call(path,'PATCH',{status:'under_review',resolution_note:'Nous vérifions le support.'},'head')).status,200);
  assert.equal((await call(path+'/messages','POST',{message:'Merci pour votre aide.'})).status,201);
  assert.equal((await call(path,'PATCH',{status:'resolved',resolution_note:'Le document est accessible.'},'head')).status,200);
  assert.equal((await call(path,'PATCH',{status:'under_review',resolution_note:'Réouverture non autorisée'},'head')).status,409);
});

test('course documents can be published by their teacher and downloaded only within the module audience',async()=>{
  const upload=await call('/uploads?name=deep-learning.pdf','POST',new TextEncoder().encode('%PDF-1.7\nDeep Learning'),'teacher',{'Content-Type':'application/pdf'});
  assert.equal(upload.status,201);const fileId=upload.data.file.id;
  const published=await call('/documents','POST',{module_id:ids.module,file_id:fileId,title:'Cours de Deep Learning',document_type:'course',description:'Support du module.'},'teacher');
  assert.equal(published.status,201,JSON.stringify(published.data));
  assert.ok((await call('/campus','GET',undefined,'second')).data.documents.some(r=>r.id===published.data.id));
  assert.equal((await call('/files/'+fileId,'GET',undefined,'second')).status,200);
  assert.equal((await call('/files/'+fileId,'GET',undefined,'outsider')).status,403);
});

test('news publication, lost-item closure and map editing respect their distinct role and ownership rules',async()=>{
  const news={title:'Journée de la recherche',content:'Une rencontre scientifique ouverte aux étudiants du campus.',category:'research'};
  assert.equal((await call('/news','POST',news,'second')).status,403);
  const published=await call('/news','POST',news,'teacher');assert.equal(published.status,201,JSON.stringify(published.data));
  assert.equal((await call('/campus','GET',undefined,'outsider')).data.news.find(n=>n.id===published.data.id).category,'research');
  const lost=await call('/lost-found','POST',{title:'Calculatrice trouvée',item_type:'found',description:'Calculatrice près de la bibliothèque.',location_text:'Bibliothèque',contact_info:'Accueil de la bibliothèque'});
  assert.equal(lost.status,201,JSON.stringify(lost.data));
  assert.equal((await call('/lost-found/'+lost.data.id,'PATCH',{status:'returned'},'second')).status,403);
  assert.equal((await call('/lost-found/'+lost.data.id,'PATCH',{status:'returned'})).status,200);
  const location={name:'Salle B12',location_type:'classroom',building:'B',description:'Salle de cours.',map_x:40,map_y:60};
  assert.equal((await call('/locations','POST',location)).status,403);
  assert.equal((await call('/locations','POST',{...location,map_x:150},'admin')).status,400);
  assert.equal((await call('/locations','POST',location,'admin')).status,201);
});

test('out-of-scope role-request routes are unavailable and cannot grant privileges',async()=>{
  assert.equal((await call('/role-requests','POST',{role:'organizer',reason:'Demande hors du périmètre fonctionnel.'})).status,404);
  assert.equal((await call('/role-requests/'+uid(999),'PATCH',{approve:true},'admin')).status,404);
  assert.equal((await call('/auth/me')).data.user.roles.includes('organizer'),false);
  assert.equal((await pg.query('SELECT count(*)::int n FROM campus_role_requests')).rows[0].n,0);
  const data=(await call('/campus')).data;assert.ok(!('requests' in data));assert.ok(!('notifications' in data));
  assert.equal((await call('/notifications/'+uid(999),'PATCH',{})).status,404);
});

test('collaboration enforces membership and prevents sharing a private library resource',async()=>{
  const created=await call('/collaboration','POST',{title:'Projet vision',description:'Projet de recherche collaborative entre filières.',topic:'IA'});
  assert.equal(created.status,201,JSON.stringify(created.data));const path='/collaboration/'+created.data.id;
  assert.equal((await call(path+'/discussions','POST',{message:'Intrusion sans adhésion'},'outsider')).status,403);
  assert.equal((await call(path+'/join','POST',{},'outsider')).status,200);
  assert.equal((await call(path+'/discussions','POST',{message:'Je souhaite contribuer au projet.'},'outsider')).status,201);
  assert.equal((await call(path+'/resources','POST',{title:'Ressource privée',description:'Ne doit pas être diffusée.',library_resource_id:privateResource})).status,400);
  assert.equal((await call(path,'PATCH',{},'outsider')).status,403);
  assert.equal((await call(path,'PATCH',{})).status,200);
  assert.equal((await call(path+'/discussions','POST',{message:'Un message après clôture.'})).status,409);
});

test('marketplace serializes competing acceptances, prevents own requests and preserves history on closure',async()=>{
  const created=await call('/marketplace','POST',{title:'Livre de programmation',description:'Livre en bon état à échanger sur le campus.',listing_type:'sale',item_condition:'good',price:80});
  assert.equal(created.status,201,JSON.stringify(created.data));const path='/marketplace/'+created.data.id;
  assert.equal((await call(path+'/request','POST',{})).status,409);
  const first=await call(path+'/request','POST',{},'second'),second=await call(path+'/request','POST',{},'outsider');
  assert.equal(first.status,201,JSON.stringify(first.data));assert.equal(second.status,201,JSON.stringify(second.data));
  assert.equal((await call(path+'/request','POST',{},'second')).status,409);
  assert.equal((await call('/marketplace/transactions/'+first.data.id,'PATCH',{status:'accepted'},'outsider')).status,409);
  const outcomes=await Promise.all([first,second].map(tx=>call('/marketplace/transactions/'+tx.data.id,'PATCH',{status:'accepted'})));
  assert.equal(outcomes.filter(x=>x.status===200).length,1);assert.equal(outcomes.filter(x=>x.status===409).length,1);
  assert.equal((await pg.query('SELECT status FROM marketplace_listings WHERE id=$1',[created.data.id])).rows[0].status,'reserved');
  assert.equal((await call(path,'PATCH',{status:'withdrawn'},'second')).status,403);
  assert.equal((await call(path,'PATCH',{status:'withdrawn'})).status,200);
  const history=(await pg.query('SELECT status FROM marketplace_transactions WHERE listing_id=$1',[created.data.id])).rows;
  assert.equal(history.length,2);assert.ok(history.every(r=>['cancelled','rejected'].includes(r.status)));
});

test('assistant uses accessible sources, abstains for private information and isolates conversations',async()=>{
  const answer=await call('/assistant','POST',{question:'Où se déroule le cours Deep Learning ?'});
  assert.equal(answer.status,200,JSON.stringify(answer.data));assert.equal(answer.data.mode,'source-search');
  assert.ok(answer.data.message.sources.some(s=>s.type==='announcement'));assert.match(answer.data.message.content,/B12/);
  const secret=await call('/assistant','POST',{question:'Document confidentiel uniquement'},'second');
  assert.equal(secret.status,200,JSON.stringify(secret.data));assert.equal(secret.data.message.abstained,true);
  assert.ok(!secret.data.message.content.includes('Document confidentiel'));
  assert.equal((await call('/assistant/'+answer.data.conversation_id,'GET',undefined,'second')).status,404);
  assert.equal((await call('/assistant/'+answer.data.message.id+'/feedback','POST',{is_relevant:true},'second')).status,403);
  assert.equal((await call('/assistant/'+answer.data.message.id+'/feedback','POST',{is_relevant:true})).status,200);
});

test('authentication supports password recovery and keeps third-party login disabled',async()=>{
  for(const [path,method,body] of [['/auth/options','GET',undefined],['/auth/google','POST',{program:'SIIA'}]]){
    assert.equal((await call(path,method,body,'anonymous')).status,404,path);
  }
  assert.equal((await call('/auth/recover','POST',{email:'student@example.test'},'anonymous')).status,200);
  assert.equal((await call('/auth/password','POST',{password:'new-password',confirmation:'new-password'},'anonymous')).status,401);
  assert.equal((await call('/auth/login','POST',{email:'student@example.test',password:'password-test'},'anonymous')).status,200);
});

test('the optional AI connector sends only accessible sources and refuses unrecognized citations',async()=>{
  const fixture=globalThis.fetch,calls=[];env.FASTAPI_URL='https://ai.example.test/api/';env.FASTAPI_TOKEN='test-service-token';
  globalThis.fetch=async(url,options)=>{
    if(new URL(url).origin!=='https://ai.example.test')return fixture(url,options);
    calls.push({url,options});const payload=JSON.parse(options.body);
    assert.ok(!payload.sources.some(source=>source.id===privateResource));
    assert.equal(options.redirect,'manual');assert.equal(options.headers.Authorization,'Bearer test-service-token');
    return Response.json({answer:'Invented unsupported answer',source_ids:['unknown-source'],abstained:false});
  };
  try{
    const response=await call('/assistant','POST',{question:'Deep Learning et salle du cours'},'second');
    assert.equal(response.status,200,JSON.stringify(response.data));assert.equal(response.data.mode,'rag');assert.equal(response.data.message.abstained,true);assert.ok(!response.data.message.content.includes('Invented'));assert.equal(calls.length,1);
  }finally{globalThis.fetch=fixture;delete env.FASTAPI_URL;delete env.FASTAPI_TOKEN}
});

const publicIds={published:uid(600),draft:uid(601),scheduled:uid(602),undated:uid(603),futureCreated:uid(604)};
let publicCover;
test('visitors can read campus information and only published news without any Auth call or private DTO fields',async()=>{
  const image=await fs.readFile(new URL('../src/assets/fpk-campus.jpg',import.meta.url));
  const upload=await call('/uploads?name=actualite.jpg','POST',image,'teacher',{'Content-Type':'image/jpeg'});assert.equal(upload.status,201);publicCover=upload.data.file.id;
  const past=new Date(Date.now()-3600000).toISOString(),future=new Date(Date.now()+86400000).toISOString();
  for(const [newsId,status,publishedAt,createdAt]of [[publicIds.published,'published',past,past],[publicIds.draft,'draft',past,past],[publicIds.scheduled,'published',future,past],[publicIds.undated,'published',null,past],[publicIds.futureCreated,'published',null,future]]){
    await pg.query('INSERT INTO news_posts(id,author_id,title,content,status,category,published_at,created_at,cover_file_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[newsId,people.teacher,'Actualité '+newsId,'Informations publiques sur la vie du campus.',status,'campus',publishedAt,createdAt,publicCover]);
  }
  const fixture=globalThis.fetch,paths=[];globalThis.fetch=async(url,options)=>{paths.push(new URL(url).pathname);return fixture(url,options)};
  try{
    const result=await call('/public','GET',undefined,'anonymous',{Cookie:'campus_access_token=invalid; campus_refresh_token=expired'});
    assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.institution.name,'Faculté Polydisciplinaire de Khouribga');
    assert.ok(result.data.programs.some(p=>p.id==='SIIA'));assert.ok(result.data.departments.some(d=>d.name==='Informatique'));
    const ids=result.data.news.map(n=>n.id);assert.ok(ids.includes(publicIds.published));assert.ok(ids.includes(publicIds.undated));
    for(const hidden of [publicIds.draft,publicIds.scheduled,publicIds.futureCreated])assert.ok(!ids.includes(hidden));
    assert.ok(!paths.some(path=>path.startsWith('/auth/')));assert.deepEqual(result.response.headers.getSetCookie(),[]);
    for(const key of ['modules','schedule','profiles','complaints','user','roles','sessions'])assert.ok(!(key in result.data));
    for(const row of result.data.news)assert.deepEqual(Object.keys(row).sort(),['id','title','content','category','published_at','cover_url'].sort());
    for(const row of result.data.programs)for(const key of ['uuid','department_id','email','head'])assert.ok(!(key in row));
    assert.ok(!JSON.stringify(result.data).includes('sb_secret'));
    assert.equal((await call('/bootstrap','GET',undefined,'anonymous')).status,401);
    assert.equal((await call('/campus','GET',undefined,'anonymous')).status,401);
    assert.equal((await call('/assistant','GET',undefined,'anonymous')).status,401);
  }finally{globalThis.fetch=fixture}
});

test('public article and cover routes reject drafts, scheduled posts, arbitrary files and withdrawn articles',async()=>{
  const detail=await call('/public/news/'+publicIds.published,'GET',undefined,'anonymous');assert.equal(detail.status,200);
  assert.match(detail.data.news.content,/Informations publiques/);assert.equal(detail.data.news.cover_url,'/api/public/news/'+publicIds.published+'/cover');
  const cover=await call(detail.data.news.cover_url.slice(4),'GET',undefined,'anonymous');assert.equal(cover.status,200);assert.equal(cover.response.headers.get('Content-Type'),'image/jpeg');assert.equal(cover.response.headers.get('Cache-Control'),'no-store');
  for(const newsId of [publicIds.draft,publicIds.scheduled,publicIds.futureCreated]){
    assert.equal((await call('/public/news/'+newsId,'GET',undefined,'anonymous')).status,404);
    assert.equal((await call('/public/news/'+newsId+'/cover','GET',undefined,'anonymous')).status,404);
  }
  assert.equal((await call('/public/files/'+privateFile,'GET',undefined,'anonymous')).status,404);
  assert.equal((await call('/files/'+privateFile,'GET',undefined,'anonymous')).status,401);
  assert.equal((await call('/public/news/'+privateFile+'/cover','GET',undefined,'anonymous')).status,404);
  assert.equal((await call('/public/news/not-a-uuid','GET',undefined,'anonymous')).status,404);
  assert.equal((await call('/public/news/'+publicIds.published,'HEAD',undefined,'anonymous')).data,null);
  assert.equal((await call('/public','POST',{title:'Unauthorized edit'},'anonymous')).status,405);
  await pg.query("UPDATE news_posts SET status='draft' WHERE id=$1",[publicIds.published]);
  assert.equal((await call('/public/news/'+publicIds.published,'GET',undefined,'anonymous')).status,404);
  assert.equal((await call('/public/news/'+publicIds.published+'/cover','GET',undefined,'anonymous')).status,404);
});

test('public information remains available when the optional news table is not configured',async()=>{
  const fixture=globalThis.fetch;
  globalThis.fetch=async(url,options)=>new URL(url).pathname==='/rest/v1/news_posts'?Response.json({code:'PGRST205'},{status:404}):fixture(url,options);
  try{const result=await call('/public','GET',undefined,'anonymous');assert.equal(result.status,200);assert.equal(result.data.newsAvailable,false);assert.deepEqual(result.data.news,[]);assert.ok(result.data.programs.length>0)}
  finally{globalThis.fetch=fixture}
});

test('public news also supports the original schema without an optional category column',async()=>{
  await pg.exec('BEGIN; ALTER TABLE news_posts DROP COLUMN category;');
  try{
    const result=await call('/public','GET',undefined,'anonymous');assert.equal(result.status,200);assert.ok(result.data.news.length>0);assert.ok(result.data.news.every(row=>row.category==='campus'));
    const detail=await call('/public/news/'+publicIds.undated,'GET',undefined,'anonymous');assert.equal(detail.status,200);assert.equal(detail.data.news.category,'campus');
  }finally{await pg.exec('ROLLBACK;')}
});
