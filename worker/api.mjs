import {programs,modules,schedule,eventSeeds} from '../src/data.mjs';
export class ApiError extends Error {constructor(message,status=400){super(message);this.status=status}}
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
  must(env.DB,'La base de données est temporairement indisponible.',503);
  const db=env.DB,url=new URL(request.url),path=url.pathname.slice(4),method=request.method;
  if(!['GET','HEAD'].includes(method)){const origin=request.headers.get('origin');must(!origin||origin===url.origin,'Origine de requête non autorisée.',403);must(request.headers.get('content-type')?.includes('application/json'),'Format JSON requis.',415)}
  const owner=request.headers.get('oai-authenticated-user-id')||'private-preview';
  const demoScope='demo:'+await digest(owner);
  const rawCookie=request.headers.get('cookie')?.match(/(?:^|;\s*)campus_session=([^;]+)/)?.[1];
  let user=rawCookie?await db.prepare('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').bind(await digest(rawCookie),Date.now()).first():null;
  if(user?.demo&&user.scope!==demoScope)user=null;
  const scope=user?.scope||demoScope;
  const body=async()=>{must(Number(request.headers.get('content-length')||0)<20000,'Requête trop volumineuse.',413);try{const s=await request.text();must(s.length<20000,'Requête trop volumineuse.',413);const b=JSON.parse(s);must(b&&typeof b==='object'&&!Array.isArray(b),'Données invalides.');return b}catch(e){if(e instanceof ApiError)throw e;throw new ApiError('Données JSON invalides.')}};
  const auth=role=>{must(user,'Connectez-vous pour continuer.',401);if(role)must(user.role===role,'Votre profil ne permet pas cette action.',403)};
  const session=async u=>{const token=random()+random();await db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').bind(await digest(token),u.id,Date.now()+86400000).run();return json({user:safeUser(u)},200,{'Set-Cookie':cookie(token)})};
  async function seed(s){await db.batch(eventSeeds.map(e=>db.prepare('INSERT OR IGNORE INTO events(id,scope,owner_id,title,category,date,time,end_time,location,organizer,capacity,program,image,description) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(s+':'+e.id,s,s+':organizer',e.title,e.category,e.date,e.time,e.endTime,e.location,e.organizer,e.capacity,e.program,e.image,e.description)))}
  if(path==='/auth/me')return json({user:safeUser(user)});
  if(path==='/auth/demo'&&method==='POST'){
   const b=await body();must(['student','teacher','organizer'].includes(b.role),'Profil invalide.');const p=programs.find(p=>p.id===b.program)||programs[0];const id=demoScope+':'+b.role;
   await db.prepare('INSERT OR IGNORE INTO users(id,email,name,program,semester,role,scope,demo) VALUES(?,?,?,?,?,?,?,1)').bind(id,b.role+'@demo.campusconnect.ma',b.role==='student'?'Yasmine El Amrani':b.role==='teacher'?'Amine Bennani':'Club Informatique FPK',p.id,p.semester,b.role,demoScope).run();await seed(demoScope);return session(await db.prepare('SELECT * FROM users WHERE id=?').bind(id).first());
  }
  if((path==='/auth/register'||path==='/auth/login')&&method==='POST'){
   const b=await body(),email=text(b.email,180).toLowerCase(),password=typeof b.password==='string'?b.password:'';
   must(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&password.length<=128&&password.length>=8,'Saisissez un email valide et un mot de passe de 8 à 128 caractères.');must(validProgram(b.program),'Sélectionnez votre filière.');
   const key=await digest((request.headers.get('cf-connecting-ip')||owner)+':'+email),now=Date.now();
   await db.prepare('INSERT INTO auth_attempts(key,attempts,window_start) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET attempts=CASE WHEN window_start<? THEN 1 ELSE attempts+1 END, window_start=CASE WHEN window_start<? THEN ? ELSE window_start END').bind(key,now,now-900000,now-900000,now).run();const a=await db.prepare('SELECT attempts FROM auth_attempts WHERE key=?').bind(key).first();must(a.attempts<=12,'Trop de tentatives. Réessayez dans 15 minutes.',429);
   let u=await db.prepare('SELECT * FROM users WHERE email=? AND scope=?').bind(email,'campus').first();
   if(path==='/auth/register'){
    must(!u,'Cette adresse est déjà utilisée.',409);const name=text(b.name,100);must(name.length>=2,'Indiquez votre nom complet.');const salt=random();u={id:random(),email,name,program:b.program,semester:programs.find(p=>p.id===b.program).semester,role:'student',scope:'campus',demo:0};
    await db.prepare('INSERT INTO users(id,email,name,password_hash,salt,program,semester,role,scope) VALUES(?,?,?,?,?,?,?,?,?)').bind(u.id,email,name,await hashPassword(password,salt),salt,u.program,u.semester,u.role,u.scope).run();
   }else{const h=await hashPassword(password,u?.salt||'invalid-user-salt');must(u&&u.password_hash===h&&u.program===b.program,'Email, mot de passe ou filière incorrects.',401)}
   await db.prepare('DELETE FROM auth_attempts WHERE key=?').bind(key).run();await seed('campus');return session(u);
  }
  if(path==='/auth/logout'&&method==='POST'){if(rawCookie)await db.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await digest(rawCookie)).run();return json({ok:true},200,{'Set-Cookie':cookie('',0)})}
  if(path==='/profile'&&method==='PUT'){auth();const b=await body();must(text(b.name,100).length>=2&&validProgram(b.program),'Vérifiez votre nom et votre filière.');await db.prepare('UPDATE users SET name=?,program=?,semester=? WHERE id=?').bind(text(b.name,100),b.program,programs.find(p=>p.id===b.program).semester,user.id).run();return json({ok:true})}
  if(path==='/bootstrap'){
   await seed(scope);const p=validProgram(url.searchParams.get('program'))?url.searchParams.get('program'):(user?.program||'SIIA');
   const result=await db.prepare('SELECT e.*, (SELECT COUNT(*) FROM registrations r WHERE r.event_id=e.id) as registered, EXISTS(SELECT 1 FROM registrations r WHERE r.event_id=e.id AND r.user_id=?) as joined FROM events e WHERE e.scope=? AND (e.status=\'published\' OR e.owner_id=?) ORDER BY e.date,e.time').bind(user?.id||'',scope,user?.id||'').all();
   return json({user:safeUser(user),programs,modules:modules[p],schedule:schedule(p,url.searchParams.get('semester')),events:result.results.map(e=>({...e,endTime:e.end_time,joined:!!e.joined})),program:p});
  }
  if(path==='/events'&&method==='POST'){
   auth('organizer');const e=fields(await body()),id=random();await db.prepare('INSERT INTO events(id,scope,owner_id,title,category,date,time,end_time,location,organizer,capacity,program,image,description) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,scope,user.id,e.title,e.category,e.date,e.time,e.endTime,e.location,e.organizer,e.capacity,e.program,e.image,e.description).run();return json({id},201);
  }
  const match=path.match(/^\/events\/([^/]+)(?:\/(register|participants))?$/);
  if(match){auth();const id=decodeURIComponent(match[1]),action=match[2],event=await db.prepare('SELECT e.*,(SELECT COUNT(*) FROM registrations r WHERE r.event_id=e.id) as registered FROM events e WHERE e.id=? AND e.scope=?').bind(id,scope).first();must(event,'Événement introuvable.',404);
   if(action==='register'){
    auth('student');must(event.status==='published'&&future(event),'Les inscriptions sont fermées pour cet événement.',409);must(event.program==='Toutes'||event.program===user.program,'Cet événement est réservé à une autre filière.',403);
    if(method==='POST'){const result=await db.prepare('INSERT OR IGNORE INTO registrations(event_id,user_id) SELECT ?,? WHERE (SELECT COUNT(*) FROM registrations WHERE event_id=?) < (SELECT capacity FROM events WHERE id=? AND status=\'published\')').bind(id,user.id,id,id).run();must(result.meta.changes>0,'Vous êtes déjà inscrit ou l’événement est complet.',409);return json({ok:true},201)}
    if(method==='DELETE'){await db.prepare('DELETE FROM registrations WHERE event_id=? AND user_id=?').bind(id,user.id).run();return json({ok:true})}
   }
   auth('organizer');must(event.owner_id===user.id,'Vous pouvez gérer uniquement vos événements.',403);
   if(action==='participants'&&method==='GET'){const rows=await db.prepare('SELECT u.name,u.email,u.program,r.created_at FROM registrations r JOIN users u ON u.id=r.user_id WHERE r.event_id=? ORDER BY r.created_at').bind(id).all();return json({participants:rows.results})}
   if(!action&&method==='PUT'){const e=fields(await body());must(e.capacity>=event.registered,'La capacité ne peut pas être inférieure au nombre d’inscrits.');const updated=await db.prepare('UPDATE events SET title=?,category=?,date=?,time=?,end_time=?,location=?,organizer=?,capacity=?,program=?,image=?,description=? WHERE id=? AND (SELECT COUNT(*) FROM registrations WHERE event_id=?)<=?').bind(e.title,e.category,e.date,e.time,e.endTime,e.location,e.organizer,e.capacity,e.program,e.image,e.description,id,id,e.capacity).run();must(updated.meta.changes>0,'De nouvelles inscriptions ont été reçues. Augmentez la capacité.',409);return json({ok:true})}
   if(!action&&method==='DELETE'){await db.prepare('UPDATE events SET status=\'cancelled\' WHERE id=?').bind(id).run();return json({ok:true})}
  }
  return json({error:'Ressource introuvable.'},404);
 }catch(e){if(e instanceof ApiError)return json({error:e.message},e.status);console.error('CampusConnect API:',e.message);return json({error:'Une erreur est survenue. Réessayez dans un instant.'},500)}
}
