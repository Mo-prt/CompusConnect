/** Minimal PostgREST transport fixture; SQL and RPC functions run in PostgreSQL. */
export function postgrestFixture(pg) {
  const tables=new Set(['users','sessions','events','registrations','auth_attempts']);
  const listFunctions=new Set(['campus_list_events','campus_participants']);
  const identifier=value=>{
    if(!/^[a-z_][a-z0-9_]*$/.test(value))throw Error('Invalid fixture identifier');
    return '"'+value+'"';
  };
  return async (input,init={})=>{
    const url=new URL(input),path=url.pathname.slice('/rest/v1/'.length);
    if(url.origin!=='https://example.supabase.co')throw Error('Unexpected network destination');
    if(init.headers.apikey!=='sb_secret_test_only')return Response.json({message:'unauthorized'},{status:401});
    try{
      const body=init.body?JSON.parse(init.body):undefined,method=init.method||'GET';
      if(path.startsWith('rpc/')){
        const name=path.slice(4);if(!name.startsWith('campus_'))throw Error('Unexpected RPC');
        const entries=Object.entries(body),values=entries.map(([,v])=>v);
        const args=entries.map(([k],i)=>identifier(k)+'=> $'+(i+1)).join(',');
        if(name==='campus_update_event')values[entries.findIndex(([k])=>k==='p_event')]=JSON.stringify(body.p_event);
        const result=await pg.query('SELECT public.'+identifier(name)+'('+args+') AS value',values);
        return Response.json(listFunctions.has(name)?result.rows.map(r=>r.value):(result.rows[0]?.value??null));
      }
      if(!tables.has(path))return Response.json({message:'unknown table'},{status:404});
      const table='public.'+identifier(path);
      const params=[],where=[];
      for(const [key,value]of url.searchParams){
        if(['select','limit','on_conflict'].includes(key))continue;
        if(!value.startsWith('eq.'))throw Error('Unexpected filter');
        params.push(value.slice(3));where.push(identifier(key)+'=$'+params.length);
      }
      const condition=where.length?' WHERE '+where.join(' AND '):'';
      if(method==='GET'){
        const limit=url.searchParams.get('limit');if(limit&&!/^\d+$/.test(limit))throw Error('Invalid limit');
        return Response.json((await pg.query('SELECT * FROM '+table+condition+(limit?' LIMIT '+limit:''),params)).rows);
      }
      if(method==='DELETE')await pg.query('DELETE FROM '+table+condition,params);
      else if(method==='PATCH'){
        const entries=Object.entries(body),assignments=entries.map(([key,value])=>{params.push(value);return identifier(key)+'=$'+params.length});
        await pg.query('UPDATE '+table+' SET '+assignments.join(',')+condition,params);
      }else if(method==='POST'){
        for(const row of Array.isArray(body)?body:[body]){
          const entries=Object.entries(row),conflict=init.headers.Prefer?.includes('resolution=ignore-duplicates');
          await pg.query('INSERT INTO '+table+'('+entries.map(([k])=>identifier(k)).join(',')+') VALUES('+entries.map((_,i)=>'$'+(i+1)).join(',')+')'+(conflict?' ON CONFLICT('+identifier(url.searchParams.get('on_conflict'))+') DO NOTHING':''),entries.map(([,v])=>v));
        }
      }else throw Error('Unexpected method');
      return new Response(null,{status:204});
    }catch(error){return Response.json({code:error.code||'FIXTURE',message:error.message},{status:400})}
  };
}
