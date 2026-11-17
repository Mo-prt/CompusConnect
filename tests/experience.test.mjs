import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';

const core=await fs.readFile(new URL('../src/app.js',import.meta.url),'utf8'),experience=await fs.readFile(new URL('../src/experience.js',import.meta.url),'utf8'),theme=await fs.readFile(new URL('../src/theme.js',import.meta.url),'utf8');
const user={id:'student-id',name:'Amine Test',role:'student',roles:['student'],program:'SIIA',semester:'S9'};
const base={program:'SIIA',semester:'S9',semesterId:'semester-id',academicYear:'2026-2027',programs:[{id:'SIIA',uuid:'program-id',departmentId:'dept',name:'Systèmes intelligents',department:'Informatique',semester:'S9',head:'Responsable Test',initials:'RT',email:'department@example.test',office:'B12',hours:'Mardi'}],semesters:[{id:'semester-id',code:'S9',label:'Semestre 9'}],modules:[['DL','Deep Learning','Enseignant',4,'Apprendre les réseaux','DL']],schedule:[],events:[]};
const articleId='20000000-0000-4000-8000-000000000001';
const publicFixture={institution:{name:'Faculté Polydisciplinaire de Khouribga',university:'Université Sultan Moulay Slimane',city:'Khouribga, Maroc'},departments:[{code:'INFO',name:'Informatique',description:'Sciences informatiques.'}],programs:[{id:'SIIA',name:'Systèmes intelligents',department:'Informatique',description:'Parcours académique.'}],events:[],newsAvailable:true,news:[{id:articleId,title:'Actualité ouverte aux visiteurs',content:'Texte complet de la publication.\n\nInformations sur la vie du campus.',category:'campus',published_at:'2026-11-16T10:00:00Z',cover_url:'/api/public/news/'+articleId+'/cover'}]};
async function context({signedIn=true,offline=false,recoveryValid=false,passwordStatus=200,hash=''}={}){
  const nodes=new Map(),handlers=[],calls=[];
  const get=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',classList:{add(){},remove(){},toggle(){}},focus(){},setSelectionRange(){}});return nodes.get(id)};
  const root={dataset:{},style:{}};
  const document={documentElement:root,getElementById:get,addEventListener(name,fn,capture){handlers.push({name,fn,capture})},querySelector(){return null},querySelectorAll(){return[]},contains(){return true},body:{classList:{add(){},remove(){}}}};
  const location=new URL('https://campus.test/'+hash),history={replaceState(a,b,path){location.href=new URL(path,location.origin).href}};
  const ctx=vm.createContext({document,window:{addEventListener(){},scrollTo(){}},location,history,console,setTimeout,clearTimeout,Date,Intl,URL,URLSearchParams,Blob,Response,FormData:class{constructor(form){this.values=Object.entries(form.values||{})}[Symbol.iterator](){return this.values[Symbol.iterator]()}},fetch:async(url,options={})=>{
    calls.push({url,options});if(offline)throw Error('Hors ligne');
    if(url.endsWith('/public'))return Response.json(structuredClone(publicFixture));
    if(url.includes('/public/news/'))return Response.json({news:structuredClone(publicFixture.news[0])});
    if(url.endsWith('/auth/options'))return Response.json({google:false});
    if(url.endsWith('/auth/me'))return Response.json({user:signedIn?user:null});
    if(url.includes('/bootstrap'))return Response.json({...structuredClone(base),user:signedIn?user:null});
    if(url.endsWith('/campus'))return Response.json(vm.runInContext('emptyCampus()',ctx));
    if(url.endsWith('/auth/recovery'))return Response.json({valid:recoveryValid});
    if(url.endsWith('/auth/recover'))return Response.json({message:'Si un compte correspond à cette adresse, un lien de réinitialisation vous sera envoyé.'});
    if(url.endsWith('/auth/password'))return passwordStatus===200?Response.json({ok:true,sessionsRevoked:true,message:'Votre mot de passe a été modifié. Connectez-vous avec le nouveau mot de passe.'}):Response.json({error:'Ce lien a expiré.'},{status:passwordStatus});
    if(url.endsWith('/auth/login'))return Response.json({user});
    return Response.json({ok:true});
  }});
  vm.runInContext(theme,ctx);vm.runInContext(core,ctx);vm.runInContext(experience,ctx);await new Promise(resolve=>setTimeout(resolve,50));return{ctx,get,calls,handlers,location,root};
}

test('public, account and academic screens share the theme without rerendering a form or calling the API',async()=>{
  const {ctx,get,calls,root}=await context({signedIn:false});
  for(const page of ['landing','campus','news','events','help','login','register','forgot-password','reset-password','documents']){
    vm.runInContext(`state.page='${page}';render()`,ctx);assert.match(get('app').innerHTML,/data-action="toggle-theme"/,page);
  }
  vm.runInContext("state.page='register';render()",ctx);const before=get('app').innerHTML,requestCount=calls.length;
  await vm.runInContext("onAction('toggle-theme',{dataset:{}})",ctx);assert.equal(root.dataset.theme,'light');assert.equal(get('app').innerHTML,before);assert.equal(calls.length,requestCount);
  vm.runInContext("state.page='login';render()",ctx);assert.match(get('app').innerHTML,/Activer le mode sombre/);assert.doesNotMatch(get('app').innerHTML,/name="program"/);
  const member=await context();
  for(const page of ['choose-profile','dashboard','department','modules','schedule','announcements','documents','library','complaints','events','registrations','organizer','news','lost','collaboration','assistant','recommendations','map','marketplace','profile','help']){
    vm.runInContext(`state.page='${page}';render()`,member.ctx);assert.match(member.get('app').innerHTML,/data-action="toggle-theme"/,page);
  }
});

test('public landing stays usable when Supabase is offline and stays within the academic scope',async()=>{
  const {ctx,get}=await context({signedIn:false,offline:true});
  assert.match(get('app').innerHTML,/Le portail étudiant/);assert.match(get('app').innerHTML,/fpk-campus.jpg/);assert.match(get('app').innerHTML,/#register/);
  vm.runInContext("state.page='login';render()",ctx);assert.match(get('app').innerHTML,/experience-auth/);assert.match(get('app').innerHTML,/#forgot-password/);assert.ok(!get('app').innerHTML.includes('remember'));assert.ok(!get('app').innerHTML.includes('Formations'));assert.ok(!get('app').innerHTML.includes('Continuer avec Google'));
});

test('anonymous visitors can discover the campus, list news and read a complete article without private API calls',async()=>{
  const {ctx,get,calls}=await context({signedIn:false});
  assert.match(get('app').innerHTML,/Actualités du campus/);assert.match(get('app').innerHTML,/Actualité ouverte aux visiteurs/);
  vm.runInContext("state.page='campus';render()",ctx);assert.match(get('app').innerHTML,/Informatique/);assert.match(get('app').innerHTML,/Systèmes intelligents/);assert.ok(!get('app').innerHTML.includes('class="sidebar"'));
  vm.runInContext("state.page='news';render()",ctx);assert.match(get('app').innerHTML,/Actualité ouverte aux visiteurs/);assert.match(get('app').innerHTML,/filter-news/);assert.ok(!get('app').innerHTML.includes('experience-auth'));
  vm.runInContext(`state.page='news/${articleId}';render()`,ctx);await new Promise(resolve=>setTimeout(resolve,25));
  assert.match(get('app').innerHTML,/Texte complet de la publication/);assert.match(get('app').innerHTML,/public-article-cover/);assert.match(get('app').innerHTML,/#news/);
  assert.ok(calls.some(c=>c.url==='/api/public'));assert.ok(!calls.some(c=>c.url.includes('/bootstrap')||c.url==='/api/campus'));
  vm.runInContext("state.page='documents';render()",ctx);assert.match(get('app').innerHTML,/Connectez-vous/);
});

test('public news text is escaped and publishers are told that news will be visible without an account',async()=>{
  const {ctx,get}=await context({signedIn:false});
  vm.runInContext(`state.publicData.news[0].title='<img src=x onerror=alert(1)>';state.page='news';render()`,ctx);
  assert.match(get('app').innerHTML,/&lt;img/);assert.ok(!get('app').innerHTML.includes('<img src=x'));
  vm.runInContext("state.user={id:'teacher',role:'teacher',roles:['teacher'],name:'Enseignant',program:'SIIA'};resourceForm('news')",ctx);
  assert.match(get('modal-root').innerHTML,/visibles par tous les visiteurs, sans compte/);
});

test('all sixteen-screen routes render with actual program data and no placeholder records',async()=>{
  const {ctx,get}=await context();
  const pages=['landing','register','login','choose-profile','dashboard','department','modules','schedule','announcements','documents','complaints','events','news','lost','collaboration','assistant','map','marketplace','library','recommendations'];
  for(const page of pages){vm.runInContext(`state.page='${page}';render()`,ctx);const html=get('app').innerHTML;assert.ok(html.length>800,page);assert.ok(!html.includes('undefined'),page);assert.ok(!html.includes('NaN'),page)}
  vm.runInContext("state.page='dashboard';render()",ctx);assert.match(get('app').innerHTML,/SIIA/);assert.match(get('app').innerHTML,/S9/);assert.match(get('app').innerHTML,/0 publication/);
});

test('role choice is restricted to assigned roles without an access-request workflow',async()=>{
  const {ctx,get,calls}=await context();
  vm.runInContext("state.page='choose-profile';render()",ctx);
  assert.match(get('app').innerHTML,/data-value="organizer"[^>]*disabled/);
  await vm.runInContext("onAction('select-role',{dataset:{value:'organizer'}})",ctx);
  assert.equal(vm.runInContext('state.selectedRole',ctx),'student');
  assert.ok(!get('app').innerHTML.includes('Demander cet accès'));
  assert.equal(get('modal-root').innerHTML,'');
  assert.deepEqual(JSON.parse(vm.runInContext('JSON.stringify(state.user.roles)',ctx)),['student']);assert.ok(!calls.some(c=>c.url.includes('/role-requests')));
  vm.runInContext("state.user=null;state.page='complaints';render()",ctx);assert.match(get('app').innerHTML,/Connectez-vous/);assert.ok(!get('app').innerHTML.includes('Nouvelle réclamation'));
});

test('user content is escaped in lists, chat answers and source labels',async()=>{
  const {ctx,get}=await context();
  vm.runInContext(`state.workspace.news=[{id:'test',title:'<img src=x onerror=alert(1)>',content:'<script>danger</script>',created_at:'2026-11-16'}];state.page='news';render()`,ctx);
  assert.ok(!get('app').innerHTML.includes('<script>danger'));assert.match(get('app').innerHTML,/&lt;img/);
  vm.runInContext(`state.chat=[{id:'message',sender:'assistant',content:'<script>danger</script>',sources:[{id:'source',url:'#modules',title:'<b>Source</b>'}]}];state.page='assistant';render()`,ctx);
  assert.ok(!get('app').innerHTML.includes('<script>danger'));assert.match(get('app').innerHTML,/&lt;b&gt;Source/);
});

test('login sends only email and password while registration checks confirmation',async()=>{
  const {ctx,get,calls,handlers}=await context({signedIn:false});
  const submit=handlers.find(h=>h.name==='submit'&&h.capture===true).fn;
  const form={id:'experience-auth',dataset:{mode:'register'},values:{name:'Amine',email:'amine@example.test',password:'password-test',confirmation:'different',program:'SIIA'},elements:{},querySelector(selector){return selector.includes('error')?get('test-error'):{disabled:false}}};
  await submit({target:form,preventDefault(){},stopImmediatePropagation(){}});assert.match(get('test-error').innerHTML,/ne correspondent pas/);assert.ok(!calls.some(c=>c.url.endsWith('/auth/register')));
  form.dataset.mode='login';delete form.values.name;form.values.confirmation='password-test';
  await submit({target:form,preventDefault(){},stopImmediatePropagation(){}});
  const call=calls.find(c=>c.url.endsWith('/auth/login'));assert.deepEqual(Object.keys(JSON.parse(call.options.body)).sort(),['email','password']);assert.equal(vm.runInContext('state.page',ctx),'choose-profile');
});

test('only registration asks for a programme and enforces the university email format',async()=>{
  const {ctx,get,calls,handlers}=await context({signedIn:false});
  vm.runInContext("state.data.programs=[];state.page='login';render()",ctx);let html=get('app').innerHTML;
  assert.doesNotMatch(html,/name="program"|pattern=|type="submit" disabled/);assert.match(html,/#forgot-password/);
  vm.runInContext("state.page='register';render()",ctx);html=get('app').innerHTML;assert.match(html,/name="program" required/);assert.match(html,/pattern=/);assert.match(html,/Format : prenom.nom@usms.ac.ma/);assert.match(html,/type="submit" disabled/);
  const submit=handlers.find(h=>h.name==='submit'&&h.capture===true).fn;
  const form=recoveryForm('register',{name:'Amine Test',email:'amine.test@gmail.com',password:'password-test',confirmation:'password-test',program:'SIIA'},get);
  await submit(submitEvent(form));assert.match(get('test-error').innerHTML,/prenom.nom@usms.ac.ma/);assert.ok(!calls.some(call=>call.url.endsWith('/auth/register')));
  for(const email of ['prenom.nom@usms.ac.ma','Jean-Pierre.El-Alami@USMS.AC.MA'])assert.equal(vm.runInContext(`isUniversityEmail(${JSON.stringify(email)})`,ctx),true);
  for(const email of ['prenom@usms.ac.ma','prenom..nom@usms.ac.ma','prenom.nom@usms.ac.ma.evil'])assert.equal(vm.runInContext(`isUniversityEmail(${JSON.stringify(email)})`,ctx),false);
  form.values.email=' Amine.Test@USMS.AC.MA ';await submit(submitEvent(form));
  const call=calls.find(call=>call.url.endsWith('/auth/register'));assert.deepEqual(JSON.parse(call.options.body),{email:'amine.test@usms.ac.ma',password:'password-test',name:'Amine Test',program:'SIIA'});
});

test('news filters are behind one button and can be applied, edited and reset for visitors and members',async()=>{
  for(const signedIn of [false,true]){
    const {ctx,get,handlers}=await context({signedIn,hash:'#news'}),group=signedIn?'news':'public-news';
    vm.runInContext(`state.publicData.news.push({id:'other',title:'Forum de recherche',content:'Rencontre scientifique.',category:'research',published_at:'2026-11-16'});state.workspace.news=state.publicData.news;render()`,ctx);
    let html=get('app').innerHTML;assert.match(html,/filter-news/);assert.doesNotMatch(html,/id="content-search"|class="tabs"|Les nouvelles de la FPK, accessibles à tous sans connexion/);
    await vm.runInContext(`onAction('filter-news',{dataset:{group:'${group}'}})`,ctx);
    html=get('modal-root').innerHTML;assert.match(html,/name="category"/);assert.match(html,/name="query"/);assert.match(html,/Réinitialiser/);
    const submit=handlers.find(h=>h.name==='submit'&&h.capture===true).fn,form={...recoveryForm('',{category:'research',query:'Forum'},get),id:'news-filter-form',dataset:{group}};
    await submit(submitEvent(form));html=get('app').innerHTML;assert.match(html,/Forum de recherche/);assert.doesNotMatch(html,/Actualité ouverte aux visiteurs/);assert.match(html,/Filtrer \(2\)/);assert.equal(get('modal-root').innerHTML,'');
    await vm.runInContext(`onAction('filter-news',{dataset:{group:'${group}'}})`,ctx);html=get('modal-root').innerHTML;assert.match(html,/value="research" selected/);assert.match(html,/value="Forum"/);
    form.values.query='aucun résultat';await submit(submitEvent(form));assert.doesNotMatch(get('app').innerHTML,/Forum de recherche/);assert.match(get('app').innerHTML,/filter-news/);
    await vm.runInContext(`onAction('reset-news-filters',{dataset:{group:'${group}'}})`,ctx);html=get('app').innerHTML;assert.match(html,/Forum de recherche/);assert.match(html,/Actualité ouverte aux visiteurs/);assert.doesNotMatch(html,/Filtrer \(/);
  }
});

function recoveryForm(mode,values,get){return{id:'experience-auth',dataset:{mode},values,elements:{},querySelector(selector){return selector.includes('error')?get('test-error'):{disabled:false}}}}
const submitEvent=form=>({target:form,preventDefault(){},stopImmediatePropagation(){}});

test('forgot-password is accessible without programme data and sends only the account email',async()=>{
  const {ctx,get,calls,handlers}=await context({signedIn:false,hash:'#forgot-password'});
  vm.runInContext('state.data.programs=[];render()',ctx);
  let html=get('app').innerHTML;assert.match(html,/data-mode="forgot-password"/);assert.match(html,/ce même navigateur/);assert.doesNotMatch(html,/name="program"|name="password"|type="submit" disabled/);
  const submit=handlers.find(h=>h.name==='submit'&&h.capture===true).fn;
  await submit(submitEvent(recoveryForm('forgot-password',{email:'unknown@example.test'},get)));
  const sent=calls.find(call=>call.url.endsWith('/auth/recover'));assert.deepEqual(JSON.parse(sent.options.body),{email:'unknown@example.test'});
  html=get('app').innerHTML;assert.match(html,/Si un compte correspond/);assert.match(html,/unknown@example.test/);assert.equal(vm.runInContext('state.user',ctx),null);
});

test('valid recovery checks the link, rejects mismatched passwords, then returns to login with private state cleared',async()=>{
  const {ctx,get,calls,handlers}=await context({signedIn:true,recoveryValid:true,hash:'#reset-password'});
  await new Promise(resolve=>setTimeout(resolve,25));assert.match(get('app').innerHTML,/data-mode="reset-password"/);assert.match(get('app').innerHTML,/autocomplete="new-password"/);assert.ok(calls.some(call=>call.url.endsWith('/auth/recovery')));
  const submit=handlers.find(h=>h.name==='submit'&&h.capture===true).fn,form=recoveryForm('reset-password',{password:'new-password',confirmation:'different'},get);
  await submit(submitEvent(form));assert.match(get('test-error').innerHTML,/ne correspondent pas/);assert.ok(!calls.some(call=>call.url.endsWith('/auth/password')));
  vm.runInContext("state.chat=[{content:'private chat'}];state.workspace.complaints=[{id:'private'}]",ctx);
  form.values.confirmation='new-password';await submit(submitEvent(form));
  const update=calls.find(call=>call.url.endsWith('/auth/password'));assert.deepEqual(JSON.parse(update.options.body),{password:'new-password',confirmation:'new-password'});
  assert.equal(vm.runInContext('state.page',ctx),'login');assert.equal(vm.runInContext('state.user',ctx),null);assert.equal(vm.runInContext('state.workspace.complaints.length+state.chat.length',ctx),0);assert.match(get('app').innerHTML,/Votre mot de passe a été modifié/);
});

test('invalid, expired and unavailable recovery links offer an appropriate way to retry',async()=>{
  const invalid=await context({signedIn:false,hash:'#reset-password'});await new Promise(resolve=>setTimeout(resolve,25));assert.match(invalid.get('app').innerHTML,/Demander un nouveau lien/);assert.doesNotMatch(invalid.get('app').innerHTML,/name="password"/);
  const expired=await context({signedIn:false,recoveryValid:true,passwordStatus:401,hash:'#reset-password'});await new Promise(resolve=>setTimeout(resolve,25));
  await expired.handlers.find(h=>h.name==='submit'&&h.capture===true).fn(submitEvent(recoveryForm('reset-password',{password:'new-password',confirmation:'new-password'},expired.get)));
  assert.match(expired.get('app').innerHTML,/Demander un nouveau lien/);assert.doesNotMatch(expired.get('app').innerHTML,/name="password"/);
  const offline=await context({signedIn:false,offline:true,hash:'#reset-password'});await new Promise(resolve=>setTimeout(resolve,25));assert.match(offline.get('app').innerHTML,/retry-recovery/);
  const callback=await context({signedIn:false,hash:'?recovery=invalid#forgot-password'});assert.match(callback.get('app').innerHTML,/déjà été utilisé/);assert.equal(callback.location.search,'');
});


test('all application screens omit removed branding and out-of-scope entry points',async()=>{
  const {ctx,get}=await context();
  for(const page of ['landing','login','register','choose-profile','dashboard','department','modules','schedule','announcements','documents','library','complaints','events','news','lost','collaboration','assistant','recommendations','map','marketplace','profile']){
    vm.runInContext(`state.page='${page}';render()`,ctx);
    const html=get('app').innerHTML;
    assert.doesNotMatch(html,/Mine &|Innovation|héritage|intelligence de demain|khouribga-mine|Continuer avec Google|Se souvenir|Mes notifications|Demander un accès|Formations|#programs|#about/,page);
  }
  for(const page of ['about','programs']){
    vm.runInContext(`state.page='${page}';render()`,ctx);assert.equal(vm.runInContext('state.page',ctx),'landing');
  }
});
