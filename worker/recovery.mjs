import {ApiError} from './errors.mjs';
import {readCookie,clearSessionCookies} from './auth.mjs';

const flowName='campus_recovery_flow',resetName='campus_recovery_token';
const flowTTL=1200,resetTTL=600;
const now=()=>Math.floor(Date.now()/1000);
const encode=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const decode=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const encoder=new TextEncoder(),decoder=new TextDecoder();
const cookie=(name,value,maxAge,sameSite='Strict')=>`${name}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=${sameSite}; Path=/api/auth; Max-Age=${maxAge}`;
const clearFlow=()=>cookie(flowName,'',0,'Lax');
const clearReset=()=>cookie(resetName,'',0);
const json=(data,status=200,cookies=[])=>{
  const headers=new Headers({'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
  cookies.forEach(value=>headers.append('Set-Cookie',value));
  return new Response(JSON.stringify(data),{status,headers});
};
const invalid=()=>new ApiError('Ce lien a expiré ou n’est plus valide. Demandez un nouveau lien.',401);
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

async function signingKey(db){return crypto.subtle.importKey('raw',encoder.encode(db.key),{name:'HMAC',hash:'SHA-256'},false,['sign','verify'])}
async function seal(db,payload){
  const data=encode(encoder.encode(JSON.stringify(payload)));
  const signature=await crypto.subtle.sign('HMAC',await signingKey(db),encoder.encode('campus-password-recovery-v1|'+data));
  return data+'.'+encode(signature);
}
async function unseal(db,value,purpose){
  try{
    if(typeof value!=='string'||value.length>8000)return null;
    const [data,signature,extra]=value.split('.');if(!data||!signature||extra)return null;
    if(!await crypto.subtle.verify('HMAC',await signingKey(db),decode(signature),encoder.encode('campus-password-recovery-v1|'+data)))return null;
    const payload=JSON.parse(decoder.decode(decode(data)));
    return payload?.purpose===purpose&&Number.isFinite(payload.expiresAt)&&payload.expiresAt>now()?payload:null;
  }catch{return null}
}
async function recoverySession(request,db){
  const session=await unseal(db,readCookie(request,resetName),'reset');
  if(!session?.accessToken||!uuid(session.userId))return null;
  try{
    const user=await db.authUser(session.accessToken);
    return user?.id===session.userId?session:null;
  }catch(error){if(error.status===401)return null;throw new ApiError('La validation du lien est momentanément indisponible. Réessayez.',503)}
}

/** Password recovery only; this flow never creates a campus session or grants roles. */
export async function handleRecovery(request,db,path,readBody){
  const methods={'/auth/recover':'POST','/auth/recovery/callback':'GET','/auth/recovery':'GET','/auth/password':'POST'};
  if(!Object.hasOwn(methods,path))return null;
  if(request.method!==methods[path])return new Response(null,{status:405,headers:{Allow:methods[path],'Cache-Control':'no-store'}});
  if(path==='/auth/recover'){
    const input=await readBody(),email=typeof input.email==='string'?input.email.trim().toLowerCase():'';
    if(email.length>180||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new ApiError('Saisissez une adresse email valide.');
    const verifier=encode(crypto.getRandomValues(new Uint8Array(48)));
    const challenge=encode(await crypto.subtle.digest('SHA-256',encoder.encode(verifier)));
    try{
      await db.request('recover',{auth:true,method:'POST',query:{redirect_to:new URL('/api/auth/recovery/callback',request.url).href},body:{email,code_challenge:challenge,code_challenge_method:'s256'}});
    }catch(error){
      if(error.status===429)throw new ApiError('Trop de demandes. Patientez avant de réessayer.',429);
      if(error.status>=500||[401,403].includes(error.supabaseStatus))throw new ApiError('Le service d’envoi est momentanément indisponible. Réessayez plus tard.',503);
      // The same message is returned for unknown accounts and other recipient errors.
    }
    const flow=await seal(db,{purpose:'pkce',verifier,expiresAt:now()+flowTTL});
    return json({message:'Si un compte correspond à cette adresse, un lien de réinitialisation vous sera envoyé. Consultez votre messagerie et vos courriers indésirables.'},200,[cookie(flowName,flow,flowTTL,'Lax'),clearReset()]);
  }
  if(path==='/auth/recovery/callback'){
    const url=new URL(request.url),cookies=[clearFlow()];let destination='/?recovery=invalid#forgot-password';
    try{
      const flow=await unseal(db,readCookie(request,flowName),'pkce'),code=url.searchParams.get('code');
      if(!flow||!code||code.length>2000||typeof flow.verifier!=='string'||!/^[A-Za-z0-9_-]{43,128}$/.test(flow.verifier)||url.searchParams.has('error'))throw invalid();
      const session=await db.request('token',{auth:true,method:'POST',query:{grant_type:'pkce'},body:{auth_code:code,code_verifier:flow.verifier}});
      if(!uuid(session.user?.id)||typeof session.access_token!=='string'||!session.access_token)throw invalid();
      const lifetime=Math.max(1,Math.min(resetTTL,Number(session.expires_in)||resetTTL));
      const reset=await seal(db,{purpose:'reset',userId:session.user.id,accessToken:session.access_token,expiresAt:now()+lifetime});
      cookies.push(cookie(resetName,reset,lifetime));destination='/#reset-password';
    }catch{cookies.push(clearReset())}
    const headers=new Headers({Location:destination,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
    cookies.forEach(value=>headers.append('Set-Cookie',value));
    return new Response(null,{status:303,headers});
  }
  if(path==='/auth/recovery'){
    const session=await recoverySession(request,db);
    return json({valid:!!session},200,session?[]:[clearReset()]);
  }
  const session=await recoverySession(request,db);
  if(!session)return json({error:invalid().message},401,[clearReset()]);
  const input=await readBody();
  if(typeof input.password!=='string'||input.password.length<8||input.password.length>128)throw new ApiError('Choisissez un mot de passe de 8 à 128 caractères.');
  if(input.password!==input.confirmation)throw new ApiError('Les mots de passe ne correspondent pas.');
  try{
    await db.request('user',{auth:true,method:'PUT',token:session.accessToken,body:{password:input.password}});
  }catch(error){
    if(error.supabaseCode==='weak_password')throw new ApiError('Ce mot de passe est trop faible. Choisissez-en un plus robuste.');
    if(error.supabaseCode==='same_password')throw new ApiError('Choisissez un mot de passe différent du précédent.');
    if(error.status===401)return json({error:invalid().message},401,[clearReset()]);
    throw new ApiError('Le mot de passe n’a pas pu être modifié. Réessayez dans un instant.',503);
  }
  let sessionsRevoked=true;
  try{await db.signOut(session.accessToken,'global')}catch{sessionsRevoked=false}
  return json({ok:true,sessionsRevoked,message:sessionsRevoked?'Votre mot de passe a été modifié. Connectez-vous avec le nouveau mot de passe.':'Votre mot de passe a été modifié. La fermeture des autres sessions n’a pas pu être confirmée.'},200,[clearFlow(),clearReset(),...clearSessionCookies()]);
}
