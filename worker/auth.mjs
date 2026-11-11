import {ApiError} from './errors.mjs';
const accessName='campus_access_token',refreshName='campus_refresh_token';
export function readCookie(request,name){
  const raw=request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1);
  try{return raw?decodeURIComponent(raw):null}catch{return null}
}
const cookie=(name,value,maxAge)=>`${name}=${encodeURIComponent(value)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
export const clearSessionCookies=()=>[cookie(accessName,'',0),cookie(refreshName,'',0),cookie('campus_session','',0)];
export function sessionCookies(session){
  if(!session.access_token||!session.refresh_token)throw new ApiError('Session Supabase Auth invalide.',502);
  const lifetime=Math.max(1,Math.min(Number(session.expires_in)||3600,86400));
  return [cookie(accessName,session.access_token,lifetime),cookie(refreshName,session.refresh_token,604800)];
}
export async function readSession(request,db){
  const token=readCookie(request,accessName),refresh=readCookie(request,refreshName);
  if(token){
    try{return {authUser:await db.authUser(token),cookies:[]}}
    catch(error){if(error.status!==401)throw error}
  }
  if(refresh){
    try{
      const session=await db.refreshSession(refresh);
      return {authUser:session.user,cookies:sessionCookies(session)};
    }catch(error){if(error.status!==401)throw error}
  }
  return {authUser:null,cookies:token||refresh?clearSessionCookies():[]};
}
export async function logout(request,db){
  const token=readCookie(request,accessName);
  if(token){try{await db.signOut(token)}catch{}}
  return clearSessionCookies();
}
