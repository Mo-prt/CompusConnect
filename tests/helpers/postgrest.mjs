/** HTTP transport fixture. PostgreSQL executes the actual compatibility functions. */
export function postgrestFixture(pg,accounts){
  const tables=new Set(['profiles','roles','user_roles','programs','departments','department_heads','semesters','modules','program_modules','timetables','timetable_sessions','classrooms','events','event_program_targets','event_registrations']);
  const access=new Map(),refresh=new Map();let sequence=0;
  const identifier=v=>{if(!/^[a-z_][a-z0-9_]*$/.test(v))throw Error('Invalid identifier');return '"'+v+'"'};
  const authUser=a=>({id:a.id,email:a.email,user_metadata:a.metadata||{first_name:a.name||'Étudiant',last_name:'Test'}});
  const issue=a=>{const token='access-'+(++sequence),refreshToken='refresh-'+sequence;access.set(token,{account:a,refreshToken});refresh.set(refreshToken,a);return{access_token:token,refresh_token:refreshToken,expires_in:3600,user:authUser(a)}};
  const dateRows=result=>result.rows.map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,result.fields.find(f=>f.name===key)?.dataTypeID===1082&&value instanceof Date?value.toISOString().slice(0,10):value])));
  const transport=async(input,init={})=>{
    const url=new URL(input),headers=new Headers(init.headers),method=init.method||'GET',body=init.body?JSON.parse(init.body):undefined;
    if(url.origin!=='https://example.supabase.co')throw Error('Unexpected destination');
    if(headers.get('apikey')!=='sb_secret_test_only')return Response.json({message:'rejected'},{status:401});
    try{
      if(url.pathname.startsWith('/auth/v1/')){
        const path=url.pathname.slice('/auth/v1/'.length),token=headers.get('Authorization')?.replace('Bearer ','');
        if(path==='user')return access.has(token)?Response.json(authUser(access.get(token).account)):Response.json({error_code:'bad_jwt'},{status:401});
        if(path==='logout'){
          const session=access.get(token);if(session){refresh.delete(session.refreshToken);access.delete(token)}
          return new Response(null,{status:204});
        }
        if(path==='signup'){
          const existing=accounts.find(a=>a.email===body.email);
          if(existing)return Response.json(authUser(existing));
          const a={id:crypto.randomUUID(),email:body.email,password:body.password,confirmed:false,metadata:body.data};
          accounts.push(a);await pg.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[a.id,a.email]);
          return Response.json(authUser(a));
        }
        if(path==='token'&&url.searchParams.get('grant_type')==='refresh_token'){
          const a=refresh.get(body.refresh_token);if(!a)return Response.json({error_code:'refresh_token_not_found'},{status:401});
          refresh.delete(body.refresh_token);return Response.json(issue(a));
        }
        if(path==='token'){
          const a=accounts.find(a=>a.email===body.email&&a.password===body.password);
          if(!a)return Response.json({error_code:'invalid_credentials'},{status:400});
          if(!a.confirmed)return Response.json({error_code:'email_not_confirmed'},{status:400});
          return Response.json(issue(a));
        }
        return Response.json({message:'unknown auth route'},{status:404});
      }
      const path=url.pathname.slice('/rest/v1/'.length);
      if(!path)return Response.json({definitions:Object.fromEntries([...tables].map(name=>[name,{properties:name==='events'?{id:{format:'uuid'},starts_at:{},organizer_id:{}}:name==='profiles'?{id:{format:'uuid'},first_name:{},program_id:{}}:{}}])),paths:Object.fromEntries(['campus_existing_ensure_profile','campus_existing_save_event','campus_existing_register','campus_existing_cancel_event'].map(name=>['/rpc/'+name,{}]))});
      if(path.startsWith('rpc/')){
        const name=path.slice(4),entries=Object.entries(body),params=entries.map(([,v])=>v&&typeof v==='object'?JSON.stringify(v):v);
        const args=entries.map(([key],i)=>identifier(key)+'=> $'+(i+1)).join(',');
        return Response.json((await pg.query('SELECT public.'+identifier(name)+'('+args+') AS value',params)).rows[0]?.value??null);
      }
      if(!tables.has(path))return Response.json({code:'PGRST205'},{status:404});
      const params=[],where=[];
      const filter=(key,value)=>{
        const field=identifier(key);
        if(value.startsWith('eq.')){params.push(value.slice(3));return field+'=$'+params.length}
        if(value.startsWith('in.(')&&value.endsWith(')')){
          const values=value.slice(4,-1).split(',');return field+' IN ('+values.map(v=>{params.push(v);return '$'+params.length}).join(',')+')';
        }
        throw Error('Unsupported filter');
      };
      for(const [key,value]of url.searchParams){
        if(['select','limit','offset','order'].includes(key))continue;
        if(key==='or')where.push('('+value.slice(1,-1).split(',').map(v=>{const [field,...rest]=v.split('.');return filter(field,rest.join('.'))}).join(' OR ')+')');
        else where.push(filter(key,value));
      }
      const condition=where.length?' WHERE '+where.join(' AND '):'';
      if(method==='GET'){
        if(path==='user_roles'&&url.searchParams.get('select')==='role:roles(code)'){
          return Response.json((await pg.query('SELECT r.code FROM public.user_roles ur JOIN public.roles r ON r.id=ur.role_id WHERE ur.user_id=$1',params)).rows.map(r=>({role:{code:r.code}})));
        }
        const order=url.searchParams.get('order');
        const sort=order?' ORDER BY '+order.split(',').map(v=>{const [field,direction]=v.split('.');return identifier(field)+(direction==='desc'?' DESC':' ASC')}).join(','):'';
        const limit=url.searchParams.get('limit');if(limit&&!/^\d+$/.test(limit))throw Error('Invalid limit');
        const offset=url.searchParams.get('offset');if(offset&&!/^\d+$/.test(offset))throw Error('Invalid offset');
        return Response.json(dateRows(await pg.query('SELECT * FROM public.'+identifier(path)+condition+sort+(limit?' LIMIT '+limit:'')+(offset?' OFFSET '+offset:''),params)));
      }
      if(method==='PATCH'){
        const set=Object.entries(body).map(([key,value])=>{params.push(value);return identifier(key)+'=$'+params.length});
        await pg.query('UPDATE public.'+identifier(path)+' SET '+set.join(',')+condition,params);
        return new Response(null,{status:204});
      }
      throw Error('Unexpected mutation outside transactional RPC');
    }catch(error){return Response.json({code:error.code==='42883'?'PGRST202':error.code||'FIXTURE',message:'SQL test error: '+error.message},{status:400})}
  };
  transport.expireAccess=token=>access.delete(token);
  return transport;
}
