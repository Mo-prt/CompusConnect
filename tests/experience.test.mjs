import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';

const core=await fs.readFile(new URL('../src/app.js',import.meta.url),'utf8'),experience=await fs.readFile(new URL('../src/experience.js',import.meta.url),'utf8');
const user={id:'student-id',name:'Amine Test',role:'student',roles:['student'],program:'SIIA',semester:'S9'};
const base={program:'SIIA',semester:'S9',semesterId:'semester-id',academicYear:'2026-2027',programs:[{id:'SIIA',uuid:'program-id',departmentId:'dept',name:'Systèmes intelligents',department:'Informatique',semester:'S9',head:'Responsable Test',initials:'RT',email:'department@example.test',office:'B12',hours:'Mardi'}],semesters:[{id:'semester-id',code:'S9',label:'Semestre 9'}],modules:[['DL','Deep Learning','Enseignant',4,'Apprendre les réseaux','DL']],schedule:[],events:[]};
async function context({signedIn=true,offline=false,hash=''}={}){
  const nodes=new Map(),handlers=[],calls=[];
  const get=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',classList:{add(){},remove(){},toggle(){}},focus(){},setSelectionRange(){}});return nodes.get(id)};
  const document={getElementById:get,addEventListener(name,fn,capture){handlers.push({name,fn,capture})},querySelector(){return null},querySelectorAll(){return[]},contains(){return true},body:{classList:{add(){},remove(){}}}};
  const location=new URL('https://campus.test/'+hash),history={replaceState(a,b,path){location.href=new URL(path,location.origin).href}};
  const ctx=vm.createContext({document,window:{addEventListener(){},scrollTo(){}},location,history,console,setTimeout,clearTimeout,Date,Intl,URL,URLSearchParams,Blob,Response,FormData:class{constructor(form){this.values=Object.entries(form.values||{})}[Symbol.iterator](){return this.values[Symbol.iterator]()}},fetch:async(url,options={})=>{
    calls.push({url,options});if(offline)throw Error('Hors ligne');
    if(url.endsWith('/auth/options'))return Response.json({google:false});
    if(url.endsWith('/auth/me'))return Response.json({user:signedIn?user:null});
    if(url.includes('/bootstrap'))return Response.json({...structuredClone(base),user:signedIn?user:null});
    if(url.endsWith('/campus'))return Response.json(vm.runInContext('emptyCampus()',ctx));
    if(url.endsWith('/auth/login'))return Response.json({user});
    return Response.json({ok:true});
  }});
  vm.runInContext(core,ctx);vm.runInContext(experience,ctx);await new Promise(resolve=>setTimeout(resolve,50));return{ctx,get,calls,handlers,location};
}

test('public landing stays usable when Supabase is offline and sign-in is a full-page flow',async()=>{
  const {ctx,get}=await context({signedIn:false,offline:true});
  assert.match(get('app').innerHTML,/Un héritage/);assert.match(get('app').innerHTML,/khouribga-mine.png/);assert.match(get('app').innerHTML,/#register/);
  vm.runInContext("state.page='login';render()",ctx);assert.match(get('app').innerHTML,/experience-auth/);assert.match(get('app').innerHTML,/forgot-password/);assert.ok(!get('app').innerHTML.includes('Continuer avec Google'));
});

test('all sixteen-screen routes render with actual program data and no placeholder records',async()=>{
  const {ctx,get}=await context();
  const pages=['landing','register','login','choose-profile','dashboard','department','modules','schedule','announcements','documents','complaints','events','news','lost','collaboration','assistant','map','marketplace','library','recommendations'];
  for(const page of pages){vm.runInContext(`state.page='${page}';render()`,ctx);const html=get('app').innerHTML;assert.ok(html.length>800,page);assert.ok(!html.includes('undefined'),page);assert.ok(!html.includes('NaN'),page)}
  vm.runInContext("state.page='dashboard';render()",ctx);assert.match(get('app').innerHTML,/SIIA/);assert.match(get('app').innerHTML,/S9/);assert.match(get('app').innerHTML,/0 publication/);
});

test('role choice creates a request instead of granting a role and private pages require login',async()=>{
  const {ctx,get,calls}=await context();
  await vm.runInContext("onAction('select-role',{dataset:{value:'organizer'}})",ctx);
  vm.runInContext("state.page='choose-profile';render()",ctx);assert.match(get('app').innerHTML,/Demander cet accès/);
  await vm.runInContext("onAction('continue-role',{dataset:{}})",ctx);assert.match(get('modal-root').innerHTML,/Demander un accès/);
  assert.match(get('modal-root').innerHTML,/value="organizer" selected/);
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

test('login submission preserves remember-me choice and registration rejects mismatched passwords',async()=>{
  const {ctx,get,calls,handlers}=await context({signedIn:false});
  const submit=handlers.find(h=>h.name==='submit'&&h.capture===true).fn;
  const form={id:'experience-auth',dataset:{mode:'register'},values:{name:'Amine',email:'amine@example.test',password:'password-test',confirmation:'different',program:'SIIA'},elements:{},querySelector(selector){return selector.includes('error')?get('test-error'):{disabled:false}}};
  await submit({target:form,preventDefault(){},stopImmediatePropagation(){}});assert.match(get('test-error').innerHTML,/ne correspondent pas/);assert.ok(!calls.some(c=>c.url.endsWith('/auth/register')));
  form.dataset.mode='login';form.elements.remember={checked:false};form.values.confirmation='password-test';
  await submit({target:form,preventDefault(){},stopImmediatePropagation(){}});
  const call=calls.find(c=>c.url.endsWith('/auth/login'));assert.equal(JSON.parse(call.options.body).remember,false);assert.equal(vm.runInContext('state.page',ctx),'choose-profile');
});
