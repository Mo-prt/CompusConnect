import {ApiError} from './errors.mjs';
import {SupabaseStore} from './storage/supabase.mjs';
import {references,displayUser,bootstrap} from './storage/catalog.mjs';
import {readSession,readCookie,sessionCookies,clearSessionCookies,logout} from './auth.mjs';
import {moroccoInstant} from './time.mjs';
import {handleCampus} from './campus.mjs';
import {handlePublic} from './public.mjs';
import {handleRecovery} from './recovery.mjs';
export {ApiError} from './errors.mjs';
const must=(condition,message,status=400)=>{if(!condition)throw new ApiError(message,status)};
const text=(value,max=200)=>typeof value==='string'?value.trim().slice(0,max):'';
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const firstAndLast=name=>{const parts=name.split(/\s+/);return [parts.shift()||'',parts.join(' ')||parts[0]||'']};
const can=(user,role)=>user&&(user.roles.includes(role)||user.roles.includes('admin'));
const safeUser=user=>user?({id:user.id,name:user.name,email:user.email,program:user.program,semester:user.semester,role:user.role,roles:user.roles,demo:false}):null;
const uuidList=ids=>'in.('+[...new Set(ids)].join(',')+')';
const capacity=value=>value===''||value===null||value===undefined?null:Number(value);

function eventFields(body,refs){
  const e={title:text(body.title,160),description:text(body.description,6000),category:text(body.category,40),status:text(body.status,20)||'published',date:text(body.date,10),endDate:text(body.endDate,10)||text(body.date,10),time:text(body.time,5),endTime:text(body.endTime,5),location_text:text(body.location,160),capacity:capacity(body.capacity)};
  must(e.title.length>=5&&e.description.length>=20&&e.location_text.length>=3,'Complétez le titre, la description et le lieu.');
  must(['Conférence','Atelier','Compétition','Vie associative'].includes(e.category),'Catégorie invalide.');
  must(['draft','published'].includes(e.status),'Statut invalide.');
  must(/^\d{4}-\d{2}-\d{2}$/.test(e.date)&&!isNaN(Date.parse(e.date))&&new Date(e.date+'T12:00:00Z').toISOString().slice(0,10)===e.date,'Date invalide.');
  must(/^([01]\d|2[0-3]):[0-5]\d$/.test(e.time)&&/^([01]\d|2[0-3]):[0-5]\d$/.test(e.endTime),'Vérifiez les heures de début et de fin.');
  must(e.capacity===null||(Number.isInteger(e.capacity)&&e.capacity>=1&&e.capacity<=10000),'La capacité doit être comprise entre 1 et 10 000, ou laissée vide.');
  const codes=Array.isArray(body.programs)?body.programs:body.program==='Toutes'?[]:[body.program];
  must(codes.every(code=>refs.programs.some(p=>p.id===code)),'Filière invalide.');
  must(/^\d{4}-\d{2}-\d{2}$/.test(e.endDate)&&!isNaN(Date.parse(e.endDate))&&new Date(e.endDate+'T12:00:00Z').toISOString().slice(0,10)===e.endDate,'Date de fin invalide.');
  let starts_at,ends_at;try{starts_at=moroccoInstant(e.date,e.time);ends_at=moroccoInstant(e.endDate,e.endTime)}catch{throw new ApiError('Heure locale invalide pour cette date.');}
  must(new Date(ends_at)>new Date(starts_at),'La fin doit suivre le début.');
  must(new Date(starts_at)>new Date(),'Choisissez un événement à venir.');
  return {title:e.title,description:e.description,category:e.category,status:e.status,starts_at,ends_at,location_text:e.location_text,capacity:e.capacity,program_ids:[...new Set(codes)].map(code=>refs.programs.find(p=>p.id===code).uuid)};
}
function rpcResult(result){
  const status=result?.status;
  if(status==='forbidden')throw new ApiError('Votre profil ne permet pas cette action.',403);
  if(status==='not_found')throw new ApiError('Événement introuvable.',404);
  if(status==='closed')throw new ApiError('Les inscriptions sont fermées pour cet événement.',409);
  if(status==='full'||status==='duplicate')throw new ApiError('Vous êtes déjà inscrit ou l’événement est complet.',409);
  if(status==='capacity')throw new ApiError('La capacité ne peut pas être inférieure au nombre d’inscrits.',409);
  if(status!=='ok')throw new ApiError('Réponse de fonction Supabase invalide.',502);
  return result;
}
export async function handleApi(request,env){
  let cookies=[];
  const json=(data,status=200)=>{
    const headers=new Headers({'Cache-Control':'no-store'});for(const value of cookies)headers.append('Set-Cookie',value);
    return Response.json(data,{status,headers});
  };
  try{
    const db=new SupabaseStore(env),url=new URL(request.url),path=url.pathname.slice(4),method=request.method;
    const publicResponse=await handlePublic(request,db,path);
    if(publicResponse)return publicResponse;
    if(!['GET','HEAD'].includes(method)){
      const origin=request.headers.get('origin');must(!origin||origin===url.origin,'Origine de requête non autorisée.',403);
      if(path!=='/uploads')must(request.headers.get('content-type')?.includes('application/json'),'Format JSON requis.',415);
    }
    const body=async()=>{
      must(Number(request.headers.get('content-length')||0)<20000,'Requête trop volumineuse.',413);
      let raw;try{raw=await request.text()}catch{throw new ApiError('Corps de requête invalide.')}
      must(raw.length<20000,'Requête trop volumineuse.',413);
      let value;try{value=JSON.parse(raw)}catch{throw new ApiError('Données JSON invalides.')}
      must(value&&typeof value==='object'&&!Array.isArray(value),'Données invalides.');return value;
    };
    const recoveryResponse=await handleRecovery(request,db,path,body);
    if(recoveryResponse)return recoveryResponse;
    if(path==='/auth/logout'&&method==='POST'){cookies=await logout(request,db);return json({ok:true})}
    if(path==='/auth/demo')throw new ApiError('Connectez-vous avec un compte Supabase Auth. Les rôles sont attribués par l’administration.',410);
    const session=await readSession(request,db);cookies=session.cookies;
    if(path==='/auth/me'&&!session.authUser)return json({user:null});
    if(path==='/bootstrap'&&!session.authUser)throw new ApiError('Connectez-vous pour accéder à votre espace académique.',401);
    const refs=await references(db);
    let user=session.authUser?await displayUser(db,session.authUser,refs):null;
    const requireActive=actor=>{
      must(actor,'Votre profil académique doit être configuré. Reconnectez-vous ou contactez l’administration.',403);
      must(actor.accountStatus==='active','Votre compte est en attente, suspendu ou désactivé. Contactez l’administration.',403);
      must(actor.role,'Aucun rôle n’est attribué à ce compte. Contactez l’administration.',403);
    };
    if(path==='/auth/me'&&session.authUser&&(!user||user.accountStatus!=='active'||!user.role)){cookies=clearSessionCookies();return json({user:null})}
    if(user&&!['/auth/login','/auth/register'].includes(path))requireActive(user);
    if(session.authUser&&!user&&!['/auth/login','/auth/register'].includes(path))requireActive(user);
    const auth=role=>{must(user,'Connectez-vous pour continuer.',401);requireActive(user);if(role)must(can(user,role),'Votre profil ne permet pas cette action.',403)};
    if(path==='/auth/me')return json({user:safeUser(user)});
    if((path==='/auth/login'||path==='/auth/register')&&method==='POST'){
      const b=await body(),email=typeof b.email==='string'?b.email.trim().toLowerCase():'',password=typeof b.password==='string'?b.password:'';
      must(email.length<=180&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)&&password.length>=8&&password.length<=128,'Saisissez un email valide et un mot de passe de 8 à 128 caractères.');
      let signed,program;
      if(path==='/auth/register'){
        must(/^[a-z]+(?:-[a-z]+)*\.[a-z]+(?:-[a-z]+)*@usms\.ac\.ma$/.test(email),'Utilisez votre email universitaire au format prenom.nom@usms.ac.ma.');
        program=refs.programs.find(p=>p.id===b.program);must(program,'Sélectionnez une filière disponible.');
        const name=text(b.name,100);must(name.length>=2,'Indiquez votre nom complet.');const [first_name,last_name]=firstAndLast(name);
        signed=await db.signUp(email,password,{first_name,last_name,full_name:name,name,program_id:program.uuid},url.origin);
        if(!signed.access_token){cookies=clearSessionCookies();return json({requiresEmailConfirmation:true,message:'Consultez votre messagerie pour confirmer votre adresse, puis connectez-vous.'},202)}
      }else signed=await db.signIn(email,password);
      must(signed.user?.id&&uuid(signed.user.id),'Réponse Supabase Auth invalide.',502);
      const current=await db.profile(signed.user.id);
      if(current)must(current.account_status==='active','Votre compte est en attente, suspendu ou désactivé.',403);
      if(!current||!current.roles.length){
        const metadata=signed.user.user_metadata||{};
        const profileProgram=refs.programs.find(p=>p.uuid===(current?.program_id||program?.uuid||metadata.program_id));
        must(profileProgram,'Votre filière doit être configurée. Contactez l’administration.',403);
        await db.ensureProfile(signed.user,profileProgram.uuid,text(metadata.first_name,100)||email.split('@')[0],text(metadata.last_name,100));
      }
      const display=await displayUser(db,signed.user,refs);requireActive(display);
      if(program&&display.programId)must(display.program===program.id,'La filière choisie ne correspond pas à votre profil.',401);
      cookies=sessionCookies(signed,b.remember!==false);
      if(b.remember!==false&&readCookie(request,'campus_ephemeral'))cookies.push('campus_ephemeral=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');
      return json({user:safeUser(display)});
    }
    const campus=await handleCampus({request,db,user,refs,env,path,method,body});
    if(campus instanceof Response){for(const value of cookies)campus.headers.append('Set-Cookie',value);return campus}
    if(campus)return json(campus.value,campus.status);
    if(path==='/bootstrap'){
      auth();must(method==='GET','Méthode non autorisée.',405);
      const result=await bootstrap(db,refs,url.searchParams.get('program'),url.searchParams.get('semester'),user);
      result.user=safeUser(user);return json(result);
    }
    if(path==='/profile'&&method==='PUT'){
      auth();const b=await body(),name=text(b.name,100),program=refs.programs.find(p=>p.id===b.program);must(name.length>=2&&program,'Vérifiez votre nom et votre filière.');
      if(!can(user,'student')&&user.departmentId)must(program.departmentId===user.departmentId,'Contactez l’administration pour changer de département.',403);
      const [first_name,last_name]=firstAndLast(name);
      await db.updateProfile(user.id,{first_name,last_name,program_id:program.uuid,department_id:program.departmentId});return json({ok:true});
    }
    if(path==='/events'&&method==='POST'){
      auth('organizer');const fields=eventFields(await body(),refs);
      return json({id:rpcResult(await db.saveEvent(user.id,null,fields)).id},201);
    }
    const match=path.match(/^\/events\/([^/]+)(?:\/(register|participants))?$/);
    if(match){
      auth();const id=decodeURIComponent(match[1]),action=match[2];must(uuid(id),'Identifiant d’événement invalide.');
      const event=await db.getEvent(id);must(event,'Événement introuvable.',404);
      if(action==='register'&&['POST','DELETE'].includes(method)){
        auth('student');rpcResult(await db.register(user.id,id,method==='DELETE'));return json({ok:true},method==='POST'?201:200);
      }
      auth('organizer');must(event.organizer_id===user.id||user.roles.includes('admin'),'Vous pouvez gérer uniquement vos événements.',403);
      if(action==='participants'&&method==='GET'){
        const registrations=await db.all('event_registrations',{event_id:'eq.'+id,status:'in.(registered,attended)',order:'registered_at.asc'});
        const ids=registrations.map(r=>r.student_id);
        const people=ids.length?await db.all('profiles',{id:uuidList(ids),select:'id,first_name,last_name,email,program_id'}):[];
        return json({participants:registrations.map(r=>{
          const p=people.find(p=>p.id===r.student_id);return {name:[p?.first_name,p?.last_name].filter(Boolean).join(' ')||'Non renseigné',email:p?.email||'',program:refs.programs.find(x=>x.uuid===p?.program_id)?.id||'',created_at:r.registered_at};
        })});
      }
      if(!action&&method==='PUT'){rpcResult(await db.saveEvent(user.id,id,eventFields(await body(),refs)));return json({ok:true})}
      if(!action&&method==='DELETE'){rpcResult(await db.cancelEvent(user.id,id));return json({ok:true})}
    }
    return json({error:'Ressource introuvable.'},404);
  }catch(error){
    if(error instanceof ApiError)return json({error:error.message},error.status);
    console.error('CampusConnect API: unexpected failure.');return json({error:'Une erreur est survenue. Réessayez dans un instant.'},500);
  }
}
