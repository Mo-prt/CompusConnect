import {ApiError} from './errors.mjs';
import {readCookie,sessionCookies} from './auth.mjs';
import {references} from './storage/catalog.mjs';

const flowName='campus_auth_flow';
const flowCookie=(value,age=600)=>`${flowName}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Lax; Path=/api/auth; Max-Age=${age}`;
const reply=(data,status=200,cookies=[])=>{const headers=new Headers({'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});cookies.forEach(c=>headers.append('Set-Cookie',c));return new Response(JSON.stringify(data),{status,headers})};
const encoded=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
async function pkce(program,flow){
  const verifier=encoded(crypto.getRandomValues(new Uint8Array(48)));
  const challenge=encoded(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
  return {verifier,challenge,program,flow};
}

/** Only Supabase's own Auth endpoint receives the key and OAuth verifier. */
export async function handleAuthFlow(request,db,path,readBody){
  const url=new URL(request.url);
  if(path==='/auth/options'&&request.method==='GET'){
    const settings=await db.request('settings',{auth:true});
    return reply({google:settings.external?.google===true});
  }
  if(path==='/auth/google'&&request.method==='POST'){
    const input=await readBody(),refs=await references(db);
    if(!refs.programs.some(p=>p.id===input.program))throw new ApiError('Choisissez votre filière.');
    const settings=await db.request('settings',{auth:true});
    if(settings.external?.google!==true)throw new ApiError('La connexion Google n’est pas disponible pour le moment.',503);
    const flow=await pkce(input.program,'login');
    const authorize=new URL('/auth/v1/authorize',db.origin);
    authorize.search=new URLSearchParams({provider:'google',redirect_to:url.origin+'/api/auth/callback',code_challenge:flow.challenge,code_challenge_method:'s256'}).toString();
    return reply({url:authorize.toString()},200,[flowCookie(JSON.stringify(flow))]);
  }
  if(path==='/auth/recover'&&request.method==='POST'){
    const input=await readBody(),email=typeof input.email==='string'?input.email.trim().toLowerCase():'';
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>180)throw new ApiError('Saisissez une adresse email valide.');
    const flow=await pkce('','recovery');
    try{await db.request('recover',{auth:true,method:'POST',query:{redirect_to:url.origin+'/api/auth/callback?flow=recovery'},body:{email,code_challenge:flow.challenge,code_challenge_method:'s256'}})}
    catch(error){if(error.status===429||error.status>=500)throw error;/* Same response for unknown accounts. */}
    return reply({message:'Si cette adresse correspond à un compte, un lien de récupération vous sera envoyé. Ouvrez-le dans ce navigateur.'},200,[flowCookie(JSON.stringify(flow))]);
  }
  if(path==='/auth/callback'&&request.method==='GET'){
    let destination='/?auth=failed#login';
    const cookies=[flowCookie('',0)];
    try{
      const flow=JSON.parse(readCookie(request,flowName)||'null'),code=url.searchParams.get('code');
      if(!flow?.verifier||!code||code.length>2000)throw new ApiError('Lien expiré.',401);
      const session=await db.request('token',{auth:true,method:'POST',query:{grant_type:'pkce'},body:{auth_code:code,code_verifier:flow.verifier}});
      if(!session.user?.id)throw new ApiError('Session invalide.',401);
      if(flow.flow==='recovery'){
        // This flag is set only after exchanging the recovery PKCE code.
        cookies.push(`campus_recovery=${encodeURIComponent(session.access_token)}; HttpOnly; Secure; SameSite=Strict; Path=/api/auth; Max-Age=600`);
        destination='/#reset-password';
      }else{
        const refs=await references(db),program=refs.programs.find(p=>p.id===flow.program);
        const current=await db.profile(session.user.id);
        if(current&&current.account_status!=='active')throw new ApiError('Compte inactif.',403);
        if(!current||!current.roles.length){
          if(!program)throw new ApiError('Filière indisponible.');
          const metadata=session.user.user_metadata||{},name=String(metadata.full_name||metadata.name||'Étudiant').slice(0,100).split(' ');
          await db.ensureProfile(session.user,program.uuid,name.shift()||'Étudiant',name.join(' '));
        }
        cookies.push(...sessionCookies(session));destination='/#choose-profile';
      }
    }catch{/* No tokens or provider errors in the redirect. */}
    const headers=new Headers({Location:destination,'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});cookies.forEach(c=>headers.append('Set-Cookie',c));
    return new Response(null,{status:303,headers});
  }
  if(path==='/auth/password'&&request.method==='POST'){
    const token=readCookie(request,'campus_recovery');if(!token)throw new ApiError('Ouvrez un lien de récupération valide.',401);
    const {password}=await readBody();
    if(typeof password!=='string'||password.length<8||password.length>128)throw new ApiError('Choisissez un mot de passe de 8 à 128 caractères.');
    await db.request('user',{auth:true,method:'PUT',token,body:{password}});
    // Revoke the recovery token after use; sign in normally with the new password.
    await db.signOut(token);
    return reply({ok:true},200,['campus_recovery=; HttpOnly; Secure; SameSite=Strict; Path=/api/auth; Max-Age=0']);
  }
  return null;
}
