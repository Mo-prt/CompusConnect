import {programs,modules,schedule,eventSeeds} from '../src/data.mjs';
import {ApiError} from './errors.mjs';
import {createStore} from './storage/index.mjs';
export {ApiError} from './errors.mjs';
const must=(condition,msg,status=400)=>{if(!condition)throw new ApiError(msg,status)};
const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const random=()=>crypto.randomUUID();
export async function hashPassword(password,salt){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);return Array.from(new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:new TextEncoder().encode(salt),iterations:100000,hash:'SHA-256'},key,256))).map(x=>x.toString(16).padStart(2,'0')).join('')}
const safeUser=u=>u?({id:u.id,name:u.name,email:u.email,program:u.program,semester:u.semester,role:u.role,demo:!!u.demo}):null;
const json=(data,status=200,headers={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store',...headers}});
const cookie=(token,max=86400)=>`campus_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${max}`;
const future=e=>new Date(`${e.date}T${e.time}:00+01:00`).getTime()>Date.now();
const text=(v,max=200)=>typeof v==='string'?v.trim().slice(0,max):'';
const validProgram=p=>programs.some(x=>x.id===p);
function fields(b){
 const e={title:text(b.title,160),category:text(b.category,40),date:text(b.date,10),time:text(b.time,5),endTime:text(b.endTime,5),location:text(b.location,160),organizer:text(b.organizer,120),capacity:Number(b.capacity),program:text(b.program,20),image:text(b.image,20)||'web',description:text(b.description,6000)};
 must(e.title.length>=5,'Le titre doit contenir au moins 5 caractères.');must(['Conférence','Atelier','Compétition','Vie associative'].includes(e.category),'Catégorie invalide.');must(/^\d{4}-\d{2}-\d{2}$/.test(e.date)&&!isNaN(Date.parse(e.date))&&new Date(e.date+'T12:00:00Z').toISOString().slice(0,10)===e.date,'Date invalide.');must(/^([01]\d|2[0-3]):[0-5]\d$/.test(e.time)&&/^([01]\d|2[0-3]):[0-5]\d$/.test(e.endTime)&&e.endTime>e.time,'Vérifiez les heures de début et de fin.');must(future(e),'Choisissez un événement à venir.');must(e.location.length>=3&&e.organizer.length>=3&&e.description.length>=20,'Complétez le lieu, l’organisateur et la description (20 caractères minimum).');must(Number.isInteger(e.capacity)&&e.capacity>0&&e.capacity<=10000,'La capacité doit être comprise entre 1 et 10 000.');must(e.program==='Toutes'||validProgram(e.program),'Filière invalide.');must(['ai','web','hack','eco','math','bio'].includes(e.image),'Visuel invalide.');return e;
}
export async function handleApi(request,env){
 try{
  const db=createStore(env),url=new URL(request.url),path=url.pathname.slice(4),method=request.method;
  if(!['GET','HEAD'].includes(method)){const origin=request.headers.get('origin');must(!origin||origin===url.origin,'Origine de requête non autorisée.',403);must(request.headers.get('content-type')?.includes('application/json'),'Format JSON requis.',415)}
  const owner=request.headers.get('oai-authenticated-user-id')||'private-preview';
  const demoScope='demo:'+await digest(owner);
  const rawCookie=request.headers.get('cookie')?.match(/(?:^|;\s*)campus_session=([^;]+)/)?.[1];
  let user=rawCookie?await db.sessionUser(await digest(rawCookie),Date.now()):null;
  if(user?.demo&&user.scope!==demoScope)user=null;
  const scope=user?.scope||demoScope;
  const body=async()=>{must(Number(request.headers.get('content-length')||0)<20000,'Requête trop volumineuse.',413);try{const s=await request.text();must(s.length<20000,'Requête trop volumineuse.',413);const b=JSON.parse(s);must(b&&typeof b==='object'&&!Array.isArray(b),'Données invalides.');return b}catch(e){if(e instanceof ApiError)throw e;throw new ApiError('Données JSON invalides.')}};
  const auth=role=>{must(user,'Connectez-vous pour continuer.',401);if(role)must(user.role===role,'Votre profil ne permet pas cette action.',403)};
  const session=async u=>{const token=random()+random();await db.createSession(await digest(token),u.id,Date.now()+86400000);return json({user:safeUser(u)},200,{'Set-Cookie':cookie(token)})};
  const seed=s=>db.seed(s,eventSeeds);
  if(path==='/auth/me')return json({user:safeUser(user)});
  if(path==='/auth/demo'&&method==='POST'){
   const b=await body();must(['student','teacher','organizer'].includes(b.role),'Profil invalide.');const p=programs.find(p=>p.id===b.program)||programs[0];const id=demoScope+':'+b.role;
   const u=await db.ensureDemoUser({id,email:b.role+'@demo.campusconnect.ma',name:b.role==='student'?'Yasmine El Amrani':b.role==='teacher'?'Amine Bennani':'Club Informatique FPK',program:p.id,semester:p.semester,role:b.role,scope:demoScope});await seed(demoScope);return session(u);
  }
  if((path==='/auth/register'||path==='/auth/login')&&method==='POST'){
   const b=await body(),email=text(b.email,180).toLowerCase(),password=typeof b.password==='string'?b.password:'';
   must(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&password.length<=128&&password.length>=8,'Saisissez un email valide et un mot de passe de 8 à 128 caractères.');must(validProgram(b.program),'Sélectionnez votre filière.');
   const key=await digest((request.headers.get('cf-connecting-ip')||owner)+':'+email),now=Date.now();
   must(await db.recordAuthAttempt(key,now)<=12,'Trop de tentatives. Réessayez dans 15 minutes.',429);
   let u=await db.userByEmail(email,'campus');
   if(path==='/auth/register'){
    must(!u,'Cette adresse est déjà utilisée.',409);const name=text(b.name,100);must(name.length>=2,'Indiquez votre nom complet.');const salt=random();u={id:random(),email,name,program:b.program,semester:programs.find(p=>p.id===b.program).semester,role:'student',scope:'campus',demo:0};
    await db.createUser({...u,password_hash:await hashPassword(password,salt),salt});
   }else{const h=await hashPassword(password,u?.salt||'invalid-user-salt');must(u&&u.password_hash===h&&u.program===b.program,'Email, mot de passe ou filière incorrects.',401)}
   await db.clearAuthAttempts(key);await seed('campus');return session(u);
  }
  if(path==='/auth/logout'&&method==='POST'){if(rawCookie)await db.deleteSession(await digest(rawCookie));return json({ok:true},200,{'Set-Cookie':cookie('',0)})}
  if(path==='/profile'&&method==='PUT'){auth();const b=await body();must(text(b.name,100).length>=2&&validProgram(b.program),'Vérifiez votre nom et votre filière.');await db.updateProfile(user.id,text(b.name,100),b.program,programs.find(p=>p.id===b.program).semester);return json({ok:true})}
  if(path==='/bootstrap'){
   await seed(scope);const p=validProgram(url.searchParams.get('program'))?url.searchParams.get('program'):(user?.program||'SIIA');
   const rows=await db.listEvents(scope,user?.id);
   return json({user:safeUser(user),programs,modules:modules[p],schedule:schedule(p,url.searchParams.get('semester')),events:rows.map(e=>({...e,endTime:e.end_time,joined:!!e.joined})),program:p});
  }
  if(path==='/events'&&method==='POST'){
   auth('organizer');const e=fields(await body()),id=random();const {endTime,...values}=e;await db.createEvent({...values,id,scope,owner_id:user.id,end_time:endTime});return json({id},201);
  }
  const match=path.match(/^\/events\/([^/]+)(?:\/(register|participants))?$/);
  if(match){auth();const id=decodeURIComponent(match[1]),action=match[2],event=await db.eventById(id,scope);must(event,'Événement introuvable.',404);
   if(action==='register'){
    auth('student');must(event.status==='published'&&future(event),'Les inscriptions sont fermées pour cet événement.',409);must(event.program==='Toutes'||event.program===user.program,'Cet événement est réservé à une autre filière.',403);
    if(method==='POST'){must(await db.joinEvent(id,user.id,scope),'Vous êtes déjà inscrit ou l’événement est complet.',409);return json({ok:true},201)}
    if(method==='DELETE'){await db.leaveEvent(id,user.id);return json({ok:true})}
   }
   auth('organizer');must(event.owner_id===user.id,'Vous pouvez gérer uniquement vos événements.',403);
   if(action==='participants'&&method==='GET')return json({participants:await db.participants(id,user.id,scope)});
   if(!action&&method==='PUT'){const e=fields(await body());must(e.capacity>=event.registered,'La capacité ne peut pas être inférieure au nombre d’inscrits.');const {endTime,...values}=e;must(await db.updateEvent(id,{...values,end_time:endTime},user.id,scope),'De nouvelles inscriptions ont été reçues. Augmentez la capacité.',409);return json({ok:true})}
   if(!action&&method==='DELETE'){await db.cancelEvent(id,user.id,scope);return json({ok:true})}
  }
  return json({error:'Ressource introuvable.'},404);
 }catch(e){if(e instanceof ApiError)return json({error:e.message},e.status);console.error('CampusConnect API:',e.message);return json({error:'Une erreur est survenue. Réessayez dans un instant.'},500)}
}
