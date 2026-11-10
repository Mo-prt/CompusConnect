import {ApiError} from '../errors.mjs';

function serverKey(key) {
  if (typeof key !== 'string') return false;
  if (key.startsWith('sb_secret_') && key.length > 10) return true;
  // Legacy service_role JWTs remain supported. A publishable/anon key never is.
  try { return JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role === 'service_role'; }
  catch { return false; }
}

export class SupabaseStore {
  constructor(env, fetchImpl = globalThis.fetch) {
    if (!env.SUPABASE_URL || !serverKey(env.SUPABASE_SECRET_KEY)) {
      throw new ApiError('Configurez SUPABASE_URL et SUPABASE_SECRET_KEY avec une clé serveur Supabase. La clé publique ne suffit pas.',503);
    }
    let url;
    try { url = new URL(env.SUPABASE_URL); } catch { throw new ApiError('SUPABASE_URL est invalide.',503); }
    const path = url.pathname.replace(/\/+$/,'');
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['','/rest/v1'].includes(path)) {
      throw new ApiError('SUPABASE_URL doit être une URL HTTPS de projet Supabase, sans paramètres.',503);
    }
    this.base = url.origin + '/rest/v1/';
    this.key = env.SUPABASE_SECRET_KEY;
    this.fetch = fetchImpl;
  }
  async request(resource,{method='GET',query={},body,prefer}={}) {
    const url=new URL(resource,this.base);
    if (url.origin !== new URL(this.base).origin) throw new ApiError('Ressource Supabase invalide.',500);
    url.search=new URLSearchParams(query).toString();
    const headers={apikey:this.key,'Content-Type':'application/json'};
    if (!this.key.startsWith('sb_secret_')) headers.Authorization='Bearer '+this.key;
    if (prefer) headers.Prefer=prefer;
    let response;
    try { response=await this.fetch(url.toString(),{method,headers,redirect:'error',signal:AbortSignal.timeout(10000),...(body===undefined?{}:{body:JSON.stringify(body)})}); }
    catch { throw new ApiError('Supabase est temporairement inaccessible. Réessayez dans un instant.',503); }
    if (!response.ok) {
      let error={};try{error=await response.json()}catch{}
      if (error.code==='23505') throw new ApiError('Cette entrée existe déjà.',409);
      // Never return remote error bodies, SQL, headers or credentials to visitors.
      throw new ApiError('La requête Supabase a échoué. Vérifiez la configuration et la migration du projet.',502);
    }
    if (response.status===204) return null;
    const raw=await response.text();
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { throw new ApiError('Réponse Supabase invalide.',502); }
  }
  rpc(name,args) { return this.request('rpc/'+name,{method:'POST',body:args}); }
  async one(table,query) { return (await this.request(table,{query:{select:'*',...query,limit:'1'}}))?.[0]||null; }
  sessionUser(hash,now) { return this.rpc('campus_session_user',{p_hash:hash,p_now:now}); }
  createSession(hash,userId,expires) {
    return this.request('sessions',{method:'POST',body:{token_hash:hash,user_id:userId,expires_at:expires},prefer:'return=minimal'});
  }
  deleteSession(hash) { return this.request('sessions',{method:'DELETE',query:{token_hash:'eq.'+hash},prefer:'return=minimal'}); }
  async ensureDemoUser(u) {
    await this.request('users',{method:'POST',query:{on_conflict:'id'},body:{...u,demo:true},prefer:'resolution=ignore-duplicates,return=minimal'});
    return this.userById(u.id);
  }
  userById(id) { return this.one('users',{id:'eq.'+id}); }
  userByEmail(email,scope) { return this.one('users',{email:'eq.'+email,scope:'eq.'+scope}); }
  createUser(u) { return this.request('users',{method:'POST',body:{...u,demo:!!u.demo},prefer:'return=minimal'}); }
  recordAuthAttempt(key,now) { return this.rpc('campus_auth_attempt',{p_key:key,p_now:now}); }
  clearAuthAttempts(key) { return this.request('auth_attempts',{method:'DELETE',query:{key:'eq.'+key},prefer:'return=minimal'}); }
  updateProfile(id,name,program,semester) {
    return this.request('users',{method:'PATCH',query:{id:'eq.'+id},body:{name,program,semester},prefer:'return=minimal'});
  }
  seed(scope,seeds) {
    return this.request('events',{method:'POST',query:{on_conflict:'id'},prefer:'resolution=ignore-duplicates,return=minimal',body:seeds.map(e=>({id:scope+':'+e.id,scope,owner_id:scope+':organizer',title:e.title,category:e.category,date:e.date,time:e.time,end_time:e.endTime,location:e.location,organizer:e.organizer,capacity:e.capacity,program:e.program,image:e.image,description:e.description}))});
  }
  listEvents(scope,userId) { return this.rpc('campus_list_events',{p_scope:scope,p_user_id:userId||''}); }
  createEvent(e) { return this.request('events',{method:'POST',body:e,prefer:'return=minimal'}); }
  eventById(id,scope) { return this.rpc('campus_get_event',{p_id:id,p_scope:scope}); }
  async joinEvent(id,userId,scope) {
    const result=await this.rpc('campus_register',{p_event_id:id,p_user_id:userId,p_scope:scope});
    if(result==='closed') throw new ApiError('Les inscriptions sont fermées pour cet événement.',409);
    if(result==='forbidden') throw new ApiError('Votre profil ou votre filière ne permet pas cette inscription.',403);
    if(result==='not_found') throw new ApiError('Événement introuvable.',404);
    return result==='ok';
  }
  leaveEvent(id,userId) { return this.request('registrations',{method:'DELETE',query:{event_id:'eq.'+id,user_id:'eq.'+userId},prefer:'return=minimal'}); }
  participants(id,userId,scope) { return this.rpc('campus_participants',{p_event_id:id,p_user_id:userId,p_scope:scope}); }
  updateEvent(id,e,userId,scope) {
    return this.rpc('campus_update_event',{p_id:id,p_user_id:userId,p_scope:scope,p_event:e});
  }
  cancelEvent(id,userId,scope) {
    return this.request('events',{method:'PATCH',query:{id:'eq.'+id,owner_id:'eq.'+userId,scope:'eq.'+scope},body:{status:'cancelled'},prefer:'return=minimal'});
  }
}
