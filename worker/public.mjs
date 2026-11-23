import {ApiError} from './errors.mjs';
import {loadEvents} from './storage/catalog.mjs';
import {supportsNewsCategories} from './news-schema.mjs';

const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const published=row=>row?.status==='published'&&Number.isFinite(Date.parse(row.published_at||row.created_at))&&Date.parse(row.published_at||row.created_at)<=Date.now();
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const publicNews=row=>({
  id:row.id,title:row.title,content:row.content,category:row.category||'campus',
  published_at:row.published_at||row.created_at,
  cover_url:row.cover_file_id?'/api/public/news/'+encodeURIComponent(row.id)+'/cover':null
});

/** Public DTOs are independent of the visitor's cookies and contain no account data. */
export async function handlePublic(request,db,path){
  if(path!=='/public'&&!path.startsWith('/public/'))return null;
  if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers:{Allow:'GET, HEAD','Cache-Control':'no-store'}});
  const detail=path.match(/^\/public\/news\/([^/]+)(\/cover)?$/);
  if(detail){
    if(!uuid(detail[1]))return json({error:'Actualité introuvable.'},404);
    const row=await db.one('news_posts',{id:'eq.'+detail[1],status:'eq.published'});
    if(!published(row))return json({error:'Actualité introuvable.'},404);
    if(!detail[2]){const response=json({news:publicNews(row)});return request.method==='HEAD'?new Response(null,{status:response.status,headers:response.headers}):response}
    if(!uuid(row.cover_file_id))return json({error:'Image introuvable.'},404);
    const file=await db.one('files',{id:'eq.'+row.cover_file_id,select:'bucket_id,object_path,mime_type'});
    if(!file||!['image/png','image/jpeg','image/webp'].includes(file.mime_type)||!/^[a-zA-Z0-9._-]+$/.test(file.bucket_id)||typeof file.object_path!=='string'||file.object_path.split('/').includes('..'))return json({error:'Image introuvable.'},404);
    const response=await db.storage(file.bucket_id+'/'+file.object_path);
    return new Response(request.method==='HEAD'?null:response.body,{headers:{
      'Content-Type':file.mime_type,'Content-Disposition':'inline','Cache-Control':'no-store',
      'X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"
    }});
  }
  if(path!=='/public')return json({error:'Ressource introuvable.'},404);
  let newsAvailable=true;
  const [departments,programs,rows]=await Promise.all([
    db.all('departments',{select:'id,code,name,description',order:'name.asc'}),
    db.all('programs',{is_active:'eq.true',select:'id,code,name,description,department_id',order:'name.asc'}),
    db.all('news_posts',{
      status:'eq.published',or:'(published_at.is.null,published_at.lte.'+new Date().toISOString()+')',
      select:'*',order:'created_at.desc',limit:'100'
    }).catch(error=>{if(!['PGRST205','42P01'].includes(error.supabaseCode))throw error;newsAvailable=false;return[]})
  ]);
  const events=await loadEvents(db,{programs:programs.map(p=>({uuid:p.id,id:p.code}))},null);
  const safeEvents=events.map(e=>({
    id:e.id,title:e.title,description:e.description,category:e.category,status:'published',
    date:e.date,time:e.time,endDate:e.endDate,endTime:e.endTime,starts_at:e.starts_at,ends_at:e.ends_at,
    location:e.location,organizer:e.organizer,capacity:e.capacity,registered:e.registered,
    program:e.program,programs:e.programs,targeted:e.targeted,joined:false
  }));
  const response=json({
    institution:{name:'Faculté Polydisciplinaire de Khouribga',university:'Université Sultan Moulay Slimane',city:'Khouribga, Maroc',photo:'/assets/fpk-campus.jpg'},
    departments:departments.map(d=>({code:d.code,name:d.name,description:d.description||''})),
    programs:programs.map(p=>({id:p.code,name:p.name,description:p.description||'',department:departments.find(d=>d.id===p.department_id)?.name||''})),
    events:safeEvents,
    news:rows.filter(published).sort((a,b)=>Date.parse(b.published_at||b.created_at)-Date.parse(a.published_at||a.created_at)).map(publicNews),
    newsAvailable,newsCategories:newsAvailable&&await supportsNewsCategories(db)
  });
  return request.method==='HEAD'?new Response(null,{status:response.status,headers:response.headers}):response;
}
