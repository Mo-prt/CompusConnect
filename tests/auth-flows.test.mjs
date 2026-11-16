import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handleAuthFlow} from '../worker/auth-flows.mjs';

const program='00000000-0000-4000-8000-000000000001',userId='00000000-0000-4000-8000-000000000002';
const post=path=>new Request('https://campus.test/api'+path,{method:'POST'});
const flowCookie=response=>response.headers.getSetCookie().find(c=>c.startsWith('campus_auth_flow=')).split(';')[0];
const flowData=response=>JSON.parse(decodeURIComponent(flowCookie(response).slice('campus_auth_flow='.length)));
function client(){
  const calls=[];
  return {calls,origin:'https://example.supabase.co',all:async table=>table==='programs'?[{id:program,code:'SIIA',name:'SIIA',is_active:true}]:[],profile:async()=>({id:userId,account_status:'active',roles:['student']}),
    request:async(resource,options={})=>{calls.push({resource,options});if(resource==='settings')return{external:{google:true}};if(resource==='token')return{user:{id:userId,email:'test@example.test'},access_token:'opaque-access-test',refresh_token:'opaque-refresh-test',expires_in:3600};return{}},
    signOut:async token=>calls.push({resource:'logout',token})};
}

test('Google uses an HttpOnly PKCE verifier and exchanges the code only on the server',async()=>{
  const db=client(),start=await handleAuthFlow(post('/auth/google'),db,'/auth/google',async()=>({program:'SIIA'}));
  const {url}=await start.json(),authorize=new URL(url),flow=flowData(start);
  assert.equal(authorize.origin,db.origin);assert.equal(authorize.searchParams.get('provider'),'google');assert.equal(authorize.searchParams.get('code_challenge_method'),'s256');
  assert.equal(authorize.searchParams.get('redirect_to'),'https://campus.test/api/auth/callback');assert.ok(flow.verifier.length>=43);assert.ok(!url.includes(flow.verifier));assert.ok(!url.includes('sb_secret'));
  assert.match(start.headers.get('Set-Cookie'),/HttpOnly; Secure; SameSite=Lax/);
  const callback=await handleAuthFlow(new Request('https://campus.test/api/auth/callback?code=one-time-code',{headers:{Cookie:flowCookie(start)}}),db,'/auth/callback',async()=>({}));
  assert.equal(callback.status,303);assert.equal(callback.headers.get('Location'),'/#choose-profile');
  const exchange=db.calls.find(c=>c.resource==='token');assert.equal(exchange.options.body.code_verifier,flow.verifier);assert.equal(exchange.options.body.auth_code,'one-time-code');
  assert.ok(callback.headers.getSetCookie().some(c=>c.startsWith('campus_access_token=')&&c.includes('HttpOnly')));
  const forged=await handleAuthFlow(new Request('https://campus.test/api/auth/callback?code=unknown'),db,'/auth/callback',async()=>({}));
  assert.equal(forged.headers.get('Location'),'/?auth=failed#login');assert.ok(!forged.headers.getSetCookie().some(c=>c.startsWith('campus_access_token=')));
});

test('password recovery keeps its token separate and revokes it after the password change',async()=>{
  const db=client(),start=await handleAuthFlow(post('/auth/recover'),db,'/auth/recover',async()=>({email:'test@example.test'}));
  const recover=db.calls.find(c=>c.resource==='recover');assert.equal(recover.options.body.code_challenge_method,'s256');assert.ok(recover.options.body.code_challenge);assert.ok(!recover.options.body.code_verifier);
  const callback=await handleAuthFlow(new Request('https://campus.test/api/auth/callback?code=recovery-code&flow=recovery',{headers:{Cookie:flowCookie(start)}}),db,'/auth/callback',async()=>({}));
  assert.equal(callback.headers.get('Location'),'/#reset-password');assert.ok(!callback.headers.getSetCookie().some(c=>c.startsWith('campus_access_token=')));
  const recovery=callback.headers.getSetCookie().find(c=>c.startsWith('campus_recovery='));assert.match(recovery,/HttpOnly; Secure; SameSite=Strict/);
  const changed=await handleAuthFlow(new Request('https://campus.test/api/auth/password',{method:'POST',headers:{Cookie:recovery.split(';')[0]}}),db,'/auth/password',async()=>({password:'new-password-test'}));
  assert.equal(changed.status,200);assert.ok(db.calls.some(c=>c.resource==='user'&&c.options.method==='PUT'));assert.ok(db.calls.some(c=>c.resource==='logout'&&c.token==='opaque-access-test'));assert.match(changed.headers.get('Set-Cookie'),/Max-Age=0/);
});
