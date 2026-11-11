import {ApiError} from '../errors.mjs';

function serverKey(key){
  if(typeof key!=='string')return false;
  if(key.startsWith('sb_secret_')&&key.length>10)return true;
  try{return JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role==='service_role'}catch{return false}
}
export class SupabaseStore {
  constructor(env,fetchImpl=globalThis.fetch){
    if(!env.SUPABASE_URL||!serverKey(env.SUPABASE_SECRET_KEY))throw new ApiError('Configurez SUPABASE_URL et SUPABASE_SECRET_KEY avec une clé serveur Supabase. La clé publique ne suffit pas.',503);
    let url;try{url=new URL(env.SUPABASE_URL)}catch{throw new ApiError('SUPABASE_URL est invalide.',503)}
    if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!['','/rest/v1'].includes(url.pathname.replace(/\/+$/,'')))throw new ApiError('SUPABASE_URL doit être une URL HTTPS de projet Supabase, sans paramètres.',503);
    this.origin=url.origin;this.key=env.SUPABASE_SECRET_KEY;this.fetch=fetchImpl.bind(globalThis);
  }
  async request(resource,{method='GET',query={},body,prefer,token,auth=false}={}){
    const url=new URL((auth?'/auth/v1/':'/rest/v1/')+resource,this.origin);
    if(url.origin!==this.origin)throw new ApiError('Ressource Supabase invalide.',500);
    url.search=new URLSearchParams(query).toString();
    const headers={apikey:this.key,'Content-Type':'application/json'};
    if(token)headers.Authorization='Bearer '+token;
    else if(!this.key.startsWith('sb_secret_'))headers.Authorization='Bearer '+this.key;
    if(prefer)headers.Prefer=prefer;
    let response;
    // Manual redirects are workerd-compatible; reject 3xx below without forwarding credentials.
    try{response=await this.fetch(url.toString(),{method,headers,redirect:'manual',signal:AbortSignal.timeout(10000),...(body===undefined?{}:{body:JSON.stringify(body)})})}
    catch{throw new ApiError('Supabase est temporairement inaccessible. Réessayez dans un instant.',503)}
    if(response.status>=300&&response.status<400){
      const failure=new ApiError('Supabase a renvoyé une redirection inattendue. Vérifiez SUPABASE_URL.',502);
      failure.supabaseStatus=response.status;
      throw failure;
    }
    if(!response.ok){
      let remote={};try{remote=await response.json()}catch{}
      let failure;
      if(auth){
        const code=remote.error_code||remote.code;
        const message=code==='email_not_confirmed'?'Confirmez votre email avant de vous connecter.':response.status===429?'Trop de tentatives. Réessayez plus tard.':'Email ou mot de passe incorrect, ou session expirée.';
        failure=new ApiError(message,response.status===429?429:response.status>=500?503:401);
      }else failure=remote.code==='23505'?new ApiError('Cette entrée existe déjà.',409):new ApiError('La requête Supabase a échoué. Vérifiez la configuration et la migration du projet.',502);
      failure.supabaseStatus=response.status;
      const code=remote.error_code||remote.code;
      if(typeof code==='string'&&/^[A-Za-z0-9_]{1,40}$/.test(code))failure.supabaseCode=code;
      throw failure;
    }
    if(response.status===204)return null;
    const raw=await response.text();if(!raw)return null;
    try{return JSON.parse(raw)}catch{throw new ApiError('Réponse Supabase invalide.',502)}
  }
  rpc(name,args){return this.request('rpc/'+name,{method:'POST',body:args})}
  async all(table,query={}){
    const explicitLimit=query.limit!==undefined,pageSize=explicitLimit?Number(query.limit):500;
    const initialOffset=Number(query.offset||0),rows=[];
    if(!Number.isInteger(pageSize)||pageSize<1||!Number.isInteger(initialOffset)||initialOffset<0)throw new ApiError('Pagination invalide.',500);
    for(let page=0;page<100;page++){
      const result=await this.request(table,{query:{select:'*',...query,limit:String(pageSize),offset:String(initialOffset+page*pageSize)}});
      if(!Array.isArray(result))throw new ApiError('Réponse de table Supabase invalide.',502);
      rows.push(...result);
      if(explicitLimit||result.length<pageSize)return rows;
    }
    throw new ApiError('Trop de données pour cette requête. Réduisez le périmètre demandé.',503);
  }
  async one(table,query={}){return(await this.all(table,{...query,limit:'1'}))[0]||null}
  authUser(token){return this.request('user',{auth:true,token})}
  signIn(email,password){return this.request('token',{auth:true,method:'POST',query:{grant_type:'password'},body:{email,password}})}
  refreshSession(refresh_token){return this.request('token',{auth:true,method:'POST',query:{grant_type:'refresh_token'},body:{refresh_token}})}
  signUp(email,password,data,redirectTo){return this.request('signup',{auth:true,method:'POST',query:redirectTo?{redirect_to:redirectTo}:{},body:{email,password,data}})}
  signOut(token){return this.request('logout',{auth:true,method:'POST',query:{scope:'local'},token,body:{}})}
  async profile(userId){
    const [profile,links]=await Promise.all([this.one('profiles',{id:'eq.'+userId}),this.all('user_roles',{user_id:'eq.'+userId,select:'role:roles(code)'})]);
    return profile?{...profile,roles:links.map(x=>x.role?.code).filter(Boolean)}:null;
  }
  ensureProfile(user,program,firstName,lastName){
    return this.rpc('campus_existing_ensure_profile',{p_user_id:user.id,p_program_id:program,p_first_name:firstName,p_last_name:lastName,p_email:user.email});
  }
  updateProfile(userId,values){return this.request('profiles',{method:'PATCH',query:{id:'eq.'+userId},body:values,prefer:'return=minimal'})}
  getEvent(id){return this.one('events',{id:'eq.'+id})}
  saveEvent(userId,id,event){return this.rpc('campus_existing_save_event',{p_user_id:userId,p_event_id:id,p_event:event})}
  register(userId,eventId,cancel=false){return this.rpc('campus_existing_register',{p_user_id:userId,p_event_id:eventId,p_cancel:cancel})}
  cancelEvent(userId,eventId){return this.rpc('campus_existing_cancel_event',{p_user_id:userId,p_event_id:eventId})}
  schema(){return this.request('')}
}
