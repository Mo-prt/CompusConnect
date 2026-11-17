import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {handleApi} from '../worker/api.mjs';
import {SupabaseStore} from '../worker/storage/supabase.mjs';

const env={SUPABASE_URL:'https://example.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_test_only'};
const site='https://campus.test',flowName='campus_recovery_flow',resetName='campus_recovery_token';
const user={id:'10000000-0000-4000-8000-000000000001',email:'student@example.test'};
const cookies=response=>response.headers.getSetCookie();
const cookieValue=(response,name)=>cookies(response).find(value=>value.startsWith(name+'='))?.split(';')[0];

// Simulate the provider transport; the production HTTP adapter, API and cookie signing run unchanged.
async function fixture(run){
  const original=globalThis.fetch,calls=[],deliveries=[],codes=new Map(),tokens=new Map();
  const state={password:'original-password',recoverStatus:200,updateCode:'',logoutFails:false,userOffline:false};
  const error=(code,status=400)=>Response.json({error_code:code,message:'PRIVATE PROVIDER DETAIL'},{status});
  const fetch=async(input,options={})=>{
    const url=new URL(input),path=url.pathname.slice('/auth/v1/'.length),body=options.body?JSON.parse(options.body):{};
    calls.push({url,options,body});assert.equal(url.origin,env.SUPABASE_URL);assert.ok(url.pathname.startsWith('/auth/v1/'),'Recovery must not touch academic data');
    if(path==='recover'){
      if(state.recoverStatus!==200)return error('provider_failure',state.recoverStatus);
      if(body.email===user.email){const code='mail-code-'+(deliveries.length+1),delivery={code,challenge:body.code_challenge,redirectTo:url.searchParams.get('redirect_to')};deliveries.push(delivery);codes.set(code,delivery)}
      return Response.json({});
    }
    if(path==='token'&&url.searchParams.get('grant_type')==='pkce'){
      const delivery=codes.get(body.auth_code),challenge=createHash('sha256').update(body.code_verifier||'').digest('base64url');
      if(!delivery||delivery.challenge!==challenge)return error('bad_code_verifier');
      codes.delete(body.auth_code);const token='recovery-access-'+deliveries.length;tokens.set(token,user);
      return Response.json({access_token:token,refresh_token:'NEVER_EXPOSE_REFRESH',expires_in:3600,user});
    }
    if(path==='token'&&url.searchParams.get('grant_type')==='password')return body.email===user.email&&body.password===state.password?Response.json({user}):error('invalid_credentials');
    const token=options.headers.Authorization?.replace('Bearer ','');
    if(path==='user'){
      if(state.userOffline)throw Error('private network error');
      if(!tokens.has(token))return error('bad_jwt',401);
      if(options.method==='PUT'){
        if(state.updateCode)return error(state.updateCode,422);
        if(body.password===state.password)return error('same_password',422);
        state.password=body.password;
      }
      return Response.json(tokens.get(token));
    }
    if(path==='logout'){
      if(state.logoutFails)return error('unavailable',503);
      assert.equal(url.searchParams.get('scope'),'global');tokens.clear();return new Response(null,{status:204});
    }
    throw Error('Unexpected provider route '+url.pathname);
  };
  globalThis.fetch=fetch;
  const call=(path,{method='GET',body,cookie,origin=site,type='application/json'}={})=>handleApi(new Request(site+'/api'+path,{method,headers:{Origin:origin,'Content-Type':type,...(cookie?{Cookie:cookie}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),env);
  const start=async()=>{
    const sent=await call('/auth/recover',{method:'POST',body:{email:user.email}});assert.equal(sent.status,200);
    const flow=cookieValue(sent,flowName),code=deliveries.at(-1).code;
    const callback=await call('/auth/recovery/callback?code='+code,{cookie:flow});assert.equal(callback.headers.get('Location'),'/#reset-password');
    return {sent,flow,code,callback,reset:cookieValue(callback,resetName)};
  };
  try{await run({call,start,calls,deliveries,tokens,state,db:new SupabaseStore(env,fetch)})}finally{globalThis.fetch=original}
}

test('recovery gives the same receipt for known and unknown accounts, with PKCE and protected cookies',()=>fixture(async({call,calls,deliveries})=>{
  const known=await call('/auth/recover',{method:'POST',body:{email:' Student@Example.Test '}});
  const unknown=await call('/auth/recover',{method:'POST',body:{email:'unknown@example.test'}});
  assert.equal(known.status,200);assert.deepEqual(await known.json(),await unknown.json());assert.equal(deliveries.length,1);
  assert.equal(deliveries[0].redirectTo,site+'/api/auth/recovery/callback');
  assert.equal(calls[0].body.code_challenge_method,'s256');assert.match(calls[0].body.code_challenge,/^[A-Za-z0-9_-]{43}$/);
  const flow=cookies(known).find(value=>value.startsWith(flowName+'='));
  assert.match(flow,/HttpOnly; Secure; SameSite=Lax; Path=\/api\/auth; Max-Age=1200/);
  assert.match(cookies(known).find(value=>value.startsWith(resetName+'=')),/Max-Age=0/);
  const invalid=await call('/auth/recover',{method:'POST',body:{email:'not an email'}});assert.equal(invalid.status,400);assert.equal(calls.length,2);
}));

test('email callback consumes the PKCE code on the server without signing in or exposing tokens',()=>fixture(async({call,start,calls})=>{
  const {flow,code,callback,reset}=await start();
  assert.equal(callback.status,303);assert.equal(callback.headers.get('Cache-Control'),'no-store');assert.equal(callback.headers.get('Referrer-Policy'),'no-referrer');
  assert.equal(await callback.text(),'');assert.ok(!cookies(callback).some(value=>value.startsWith('campus_access_token=')));assert.ok(!cookies(callback).some(value=>value.includes('NEVER_EXPOSE_REFRESH')));
  assert.match(cookies(callback).find(value=>value.startsWith(resetName+'=')),/HttpOnly; Secure; SameSite=Strict; Path=\/api\/auth; Max-Age=600/);
  assert.equal(calls[1].url.searchParams.get('grant_type'),'pkce');assert.equal(calls[1].body.auth_code,code);assert.match(calls[1].body.code_verifier,/^[A-Za-z0-9_-]{64}$/);
  const status=await call('/auth/recovery',{cookie:reset});assert.deepEqual(await status.json(),{valid:true});
  const replay=await call('/auth/recovery/callback?code='+code+'&next=https://attacker.test',{cookie:flow});assert.equal(replay.headers.get('Location'),'/?recovery=invalid#forgot-password');
}));

test('callback rejects missing, tampered and expired browser state before exchanging a code',()=>fixture(async({call,calls,deliveries})=>{
  const sent=await call('/auth/recover',{method:'POST',body:{email:user.email}}),flow=cookieValue(sent,flowName),path='/auth/recovery/callback?code='+deliveries[0].code;
  for(const cookie of [undefined,flow+'x']){const response=await call(path,{cookie});assert.equal(response.headers.get('Location'),'/?recovery=invalid#forgot-password')}
  const originalNow=Date.now;try{Date.now=()=>originalNow()+1201_000;assert.equal((await call(path,{cookie:flow})).headers.get('Location'),'/?recovery=invalid#forgot-password')}finally{Date.now=originalNow}
  assert.equal(calls.length,1);
}));

test('ordinary login sessions, unsigned tokens, wrong-purpose and expired cookies cannot change a password',()=>fixture(async({call,start,tokens})=>{
  const {flow,reset}=await start();tokens.set('ordinary-access',user);
  for(const cookie of ['campus_access_token=ordinary-access',resetName+'=ordinary-access',flow.replace(flowName,resetName),reset+'x']){
    assert.deepEqual(await (await call('/auth/recovery',{cookie})).json(),{valid:false});
    assert.equal((await call('/auth/password',{method:'POST',body:{password:'attacker-password',confirmation:'attacker-password'},cookie})).status,401);
  }
  const originalNow=Date.now;try{Date.now=()=>originalNow()+601_000;assert.deepEqual(await (await call('/auth/recovery',{cookie:reset})).json(),{valid:false})}finally{Date.now=originalNow}
}));

test('password reset validates confirmation and provider password policy before updating',()=>fixture(async({call,start,calls,state})=>{
  const {reset}=await start();
  for(const body of [{password:'short',confirmation:'short'},{password:'new-password',confirmation:'different'},{password:'x'.repeat(129),confirmation:'x'.repeat(129)}])assert.equal((await call('/auth/password',{method:'POST',body,cookie:reset})).status,400);
  assert.ok(!calls.some(call=>call.options.method==='PUT'));
  for(const [code,message] of [['weak_password',/trop faible/],['same_password',/différent/]]){
    state.updateCode=code;const response=await call('/auth/password',{method:'POST',body:{password:'new-password',confirmation:'new-password'},cookie:reset});
    assert.equal(response.status,400);assert.match((await response.json()).error,message);
  }
  assert.equal(state.password,'original-password');
}));

test('complete recovery changes the password, signs out globally, clears cookies and requires a fresh login',()=>fixture(async({call,start,db,state})=>{
  const {reset}=await start(),response=await call('/auth/password',{method:'POST',body:{password:'new-strong-password',confirmation:'new-strong-password'},cookie:reset});
  assert.equal(response.status,200);const result=await response.json();assert.equal(result.ok,true);assert.equal(result.sessionsRevoked,true);assert.ok(!JSON.stringify(result).includes('access'));
  assert.equal(state.password,'new-strong-password');assert.ok(cookies(response).length>=6);assert.ok(cookies(response).every(value=>value.includes('Max-Age=0')));
  await assert.rejects(db.signIn(user.email,'original-password'));assert.equal((await db.signIn(user.email,'new-strong-password')).user.id,user.id);
  assert.deepEqual(await (await call('/auth/recovery',{cookie:reset})).json(),{valid:false});
}));

test('a changed password is reported honestly if global signout fails',()=>fixture(async({call,start,state})=>{
  const {reset}=await start();state.logoutFails=true;
  const response=await call('/auth/password',{method:'POST',body:{password:'new-strong-password',confirmation:'new-strong-password'},cookie:reset});
  assert.equal(response.status,200);assert.equal(state.password,'new-strong-password');const result=await response.json();assert.equal(result.sessionsRevoked,false);assert.match(result.message,/n’a pas pu être confirmée/);
}));

test('recovery handles provider outages and rate limits without leaking provider details',()=>fixture(async({call,start,state})=>{
  for(const [remote,expected] of [[429,429],[500,503],[401,503],[403,503]]){
    state.recoverStatus=remote;const response=await call('/auth/recover',{method:'POST',body:{email:user.email}});assert.equal(response.status,expected);assert.ok(!(await response.text()).includes('PRIVATE'));
  }
  state.recoverStatus=200;const {reset}=await start();state.userOffline=true;
  assert.equal((await call('/auth/recovery',{cookie:reset})).status,503);
  assert.equal((await call('/auth/password',{method:'POST',body:{password:'new-password',confirmation:'new-password'},cookie:reset})).status,503);
}));

test('recovery rejects cross-origin writes, non-JSON and unsupported methods without provider calls',()=>fixture(async({call,calls})=>{
  assert.equal((await call('/auth/recover',{method:'POST',body:{email:user.email},origin:'https://attacker.test'})).status,403);
  assert.equal((await call('/auth/recover',{method:'POST',body:{email:user.email},type:'text/plain'})).status,415);
  for(const [path,method,allow] of [['/auth/recover','GET','POST'],['/auth/password','GET','POST'],['/auth/recovery','POST','GET'],['/auth/recovery/callback','POST','GET']]){
    const response=await call(path,{method});assert.equal(response.status,405);assert.equal(response.headers.get('Allow'),allow);
  }
  assert.equal(calls.length,0);
}));
