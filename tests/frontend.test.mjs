import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';

const source=await fs.readFile(new URL('../src/app.js',import.meta.url),'utf8');
const data={user:null,program:'DEMO-SIIA',semester:'S1',semesterId:'semester-id',academicYear:'2026-2027',demoEnabled:false,
  programs:[{id:'DEMO-SIIA',uuid:'program-id',name:'Filière existante',department:'Informatique',semester:'S1',head:'Professeur Test',initials:'PT',email:'contact@example.test',office:'B12',hours:'Mardi matin'}],
  semesters:[{id:'semester-id',code:'S1',label:'Semestre 1',academicYear:'2026-2027'}],
  modules:[['M101','Données','Enseignant Test',4.5,'Comprendre les données','M10']],
  schedule:[{day:2,start:'09:15',end:'11:15',sessionDate:null,title:'Données',teacher:'Enseignant Test',room:'B14',type:'TP',color:'blue'}],
  events:[{id:'event-id',title:'Une rencontre existante',description:'Une présentation dans les locaux du campus.',category:'Conférence',date:'2030-11-20',endDate:'2030-11-20',time:'09:00',endTime:'12:00',starts_at:'2030-11-20T09:00:00Z',ends_at:'2030-11-20T12:00:00Z',location:'Amphi A',organizer:'Organisateur Test',owner_id:'organizer-id',capacity:null,programs:['DEMO-SIIA','DEMO-GI'],targeted:true,program:'Plusieurs filières',registered:1,joined:false,status:'published',image:'ai'}]
};
async function context(hash=''){
  const nodes=new Map();
  const get=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',classList:{add(){},remove(){},toggle(){}},focus(){}});return nodes.get(id)};
  const document={getElementById:get,addEventListener(){},querySelector(){return null},querySelectorAll(){return[]},body:{classList:{add(){},remove(){}}}};
  const location=new URL('https://campus.test/'+hash),history={replaceState(a,b,path){location.href=new URL(path,location.origin).href}};
  const ctx=vm.createContext({document,window:{addEventListener(){},scrollTo(){}},location,history,console,setTimeout,clearTimeout,Date,Intl,URL,URLSearchParams,Blob,Response,fetch:async url=>Response.json(url.includes('/auth/me')?{user:null}:structuredClone(data))});
  vm.runInContext(source,ctx);await new Promise(resolve=>setTimeout(resolve,30));return{ctx,get,location};
}

test('frontend renders all pages with actual program codes and dynamic semester data',async()=>{
  const {ctx,get}=await context();
  assert.equal(vm.runInContext('state.program',ctx),'DEMO-SIIA');assert.equal(vm.runInContext('state.semesterId',ctx),'semester-id');
  for(const page of ['dashboard','department','modules','schedule','events','registrations','organizer','profile','help']){
    vm.runInContext(`state.page='${page}';render()`,ctx);assert.ok(get('app').innerHTML.length>2000,page);assert.ok(!get('app').innerHTML.includes('undefined'),page);
  }
  vm.runInContext("state.page='schedule';render()",ctx);assert.match(get('app').innerHTML,/09:15/);assert.match(get('app').innerHTML,/semester-id/);
});

test('frontend removes privileged demo creation and preserves multi-target event editing',async()=>{
  const {ctx,get}=await context();vm.runInContext('authModal()',ctx);
  assert.ok(!get('modal-root').innerHTML.includes('demo-organizer'));
  assert.match(get('modal-root').innerHTML,/Supabase Auth/);
  vm.runInContext("state.user={id:'organizer-id',name:'Organisateur Test',role:'organizer',roles:['organizer'],program:'DEMO-SIIA',semester:'S1'};eventForm('event-id')",ctx);
  assert.match(get('modal-root').innerHTML,/name="programs" multiple/);assert.match(get('modal-root').innerHTML,/value="DEMO-SIIA" selected/);assert.match(get('modal-root').innerHTML,/name="status"/);
});

test('unlimited capacity and calendar export preserve existing UTC timestamps',async()=>{
  const {ctx,get}=await context();vm.runInContext("eventDetail('event-id')",ctx);assert.match(get('modal-root').innerHTML,/Sans limite de places/);assert.ok(!get('modal-root').innerHTML.includes('Infinity'));
  vm.runInContext("download=(value)=>{globalThis.calendar=value};calendarExport('event-id')",ctx);
  const ics=vm.runInContext('calendar',ctx);assert.match(ics,/DTSTART:20301120T090000Z\r\n/);assert.match(ics,/DTEND:20301120T120000Z\r\n/);
});


test('email confirmation callback removes URL tokens and asks for password sign-in',async()=>{
  const {get,location}=await context('#access_token=opaque-test-token&refresh_token=opaque-refresh');
  assert.equal(location.hash,'');assert.match(get('auth-error').innerHTML,/adresse email est confirmée/);
  assert.ok(!get('app').innerHTML.includes('opaque-test-token'));assert.ok(!get('modal-root').innerHTML.includes('opaque-refresh'));
});
