import {ApiError} from './errors.mjs';
import {teachingWorkspace} from './teaching.mjs';
import {supportsNewsCategories} from './news-schema.mjs';

const check=(condition,message='Cette action n’est pas autorisée.',status=403)=>{if(!condition)throw new ApiError(message,status)};
const has=(user,...roles)=>user.roles.includes('admin')||roles.some(role=>user.roles.includes(role));
const clean=(value,max=200)=>typeof value==='string'?value.trim().slice(0,max):'';
const required=(value,label,min=3,max=200)=>{const text=clean(value,max);check(text.length>=min,'Vérifiez le champ « '+label+' ».',400);return text};
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const id=value=>{check(uuid(value),'Identifiant invalide.',400);return value};
const now=()=>new Date().toISOString();
const one=rows=>Array.isArray(rows)?rows[0]:rows;
const pick=(value,allowed,label)=>{check(allowed.includes(value),'Valeur invalide : '+label+'.',400);return value};
const safeURL=value=>{if(!value)return null;let url;try{url=new URL(value)}catch{throw new ApiError('Lien invalide.')}check(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password,'Utilisez un lien web sans identifiants.',400);return url.toString()};
const missing=error=>['PGRST205','42P01'].includes(error.supabaseCode);
const published=row=>row.published_at&&new Date(row.published_at)<=new Date();
const visibleLibrary=(row,targets,user)=>row.uploaded_by===user.id||has(user,'admin')||row.visibility==='all_students'||row.visibility==='selected_programs'&&targets.some(t=>t.resource_id===row.id&&t.program_id===user.programId);

export async function academicScope(db,user,refs){
  const programs=refs.programs.filter(p=>has(user,'admin')||p.uuid===user.programId||has(user,'department_head')&&p.departmentId===user.departmentId);
  const links=await db.all('program_modules');
  const allModules=await db.all('modules');
  const ids=new Set(links.filter(link=>programs.some(p=>p.uuid===link.program_id)).map(link=>link.module_id));
  const modules=allModules.filter(m=>ids.has(m.id)||m.responsible_teacher_id===user.id||has(user,'admin'));
  return {programs,links,modules,allModules,canTeach:module=>!!module&&(has(user,'admin')||has(user,'teacher')&&module.responsible_teacher_id===user.id||has(user,'department_head')&&links.some(l=>l.module_id===module.id&&programs.some(p=>p.uuid===l.program_id&&p.departmentId===user.departmentId)))};
}

export async function readCampus(db,user,refs,includeEventSuggestions=false,includeTeaching=false){
  const scope=await academicScope(db,user,refs),unavailable=[];
  const read=async(table,query={})=>{try{return await db.all(table,query)}catch(error){if(!missing(error))throw error;unavailable.push(table);return[]}};
  const [announcements,targets,documents,library,libraryTargets,complaints,news,lost,spaces,members,resources,locations,listings,categories,transactions,recommendations,images]=await Promise.all([
    read('announcements',{order:'created_at.desc'}),read('announcement_targets'),read('course_documents',{order:'created_at.desc'}),
    read('library_resources',{order:'created_at.desc'}),read('library_resource_programs'),read('complaints',{order:'submitted_at.desc'}),
    read('news_posts',{status:'eq.published',order:'created_at.desc'}),read('lost_found_items',{order:'created_at.desc'}),
    read('collaboration_spaces',{order:'created_at.desc'}),read('collaboration_members'),read('shared_resources',{order:'shared_at.desc'}),
    read('campus_locations'),read('marketplace_listings',{order:'created_at.desc'}),read('marketplace_categories'),
    read('marketplace_transactions',{or:`(requester_id.eq.${user.id},owner_id.eq.${user.id})`,order:'requested_at.desc'}),
    read('recommendations',{user_id:'eq.'+user.id,order:'generated_at.desc'}),read('marketplace_images',{order:'sort_order.asc'})
  ]);
  const readableLibrary=library.filter(row=>visibleLibrary(row,libraryTargets,user));
  const readableSpaces=spaces.filter(row=>row.status==='open'||row.created_by===user.id||members.some(m=>m.space_id===row.id&&m.user_id===user.id)||has(user,'admin'));
  let departmentStudents=[];
  if(has(user,'department_head')&&user.departmentId)departmentStudents=await db.all('profiles',{department_id:'eq.'+user.departmentId,select:'id'});
  const canHandleComplaint=row=>has(user,'admin')||row.student_id!==user.id&&(row.assigned_to===user.id&&has(user,'teacher','department_head')||has(user,'department_head')&&row.complaint_type==='pedagogical'&&departmentStudents.some(p=>p.id===row.student_id));
  const readableComplaints=complaints.filter(row=>row.student_id===user.id||canHandleComplaint(row)).map(row=>({...row,manageable:canHandleComplaint(row)}));
  const readableResources=resources.filter(row=>readableSpaces.some(s=>s.id===row.space_id)&&(!row.library_resource_id||readableLibrary.some(r=>r.id===row.library_resource_id)));
  const result={
    modules:scope.modules.map(m=>({...m,writable:scope.canTeach(m)})),
    announcements:announcements.filter(row=>row.author_id===user.id||row.status==='published'&&published(row)&&(!row.expires_at||new Date(row.expires_at)>new Date())&&(!row.module_id||scope.modules.some(m=>m.id===row.module_id))&&(!targets.some(t=>t.announcement_id===row.id)||targets.some(t=>t.announcement_id===row.id&&t.program_id===user.programId)||has(user,'admin'))),
    documents:documents.filter(row=>row.uploaded_by===user.id||published(row)&&scope.modules.some(m=>m.id===row.module_id)),
    library:readableLibrary,complaints:readableComplaints,news:news.filter(row=>!row.published_at||published(row)),lost,
    spaces:readableSpaces.map(s=>({...s,memberCount:new Set([s.created_by,...members.filter(m=>m.space_id===s.id).map(m=>m.user_id)]).size,joined:s.created_by===user.id||members.some(m=>m.space_id===s.id&&m.user_id===user.id)})),
    resources:readableResources,locations,listings:listings.filter(row=>['available','reserved','completed'].includes(row.status)||row.seller_id===user.id).map(row=>({...row,image_file_id:images.find(image=>image.listing_id===row.id)?.file_id||null})),categories,transactions,
    recommendations:recommendations.filter(row=>(!row.expires_at||new Date(row.expires_at)>new Date())&&(row.target_type==='library_resource'&&readableLibrary.some(x=>x.id===row.target_id)||row.target_type==='shared_resource'&&readableResources.some(x=>x.id===row.target_id))),
    unavailable:[...new Set(unavailable)]
  };
  result.newsCategories=!unavailable.includes('news_posts')&&await supportsNewsCategories(db);
  if(includeTeaching)result.teaching=await teachingWorkspace(db,user,refs,scope);
  const eventSuggestions=recommendations.filter(row=>row.target_type==='event'&&(!row.expires_at||new Date(row.expires_at)>new Date()));
  if(includeEventSuggestions&&eventSuggestions.length){
    const {loadEvents}=await import('./storage/catalog.mjs');
    const events=await loadEvents(db,refs,user);
    result.recommendations.push(...eventSuggestions.filter(row=>events.some(e=>e.id===row.target_id&&e.status==='published'&&new Date(e.starts_at)>new Date()&&(!e.targeted||e.programs.includes(user.program)))));
  }

  return result;
}

async function ownedFile(db,fileId,user){
  if(!fileId)return null;const file=await db.one('files',{id:'eq.'+id(fileId)});
  check(file&&(file.uploaded_by===user.id||has(user,'admin')),'Ce fichier ne vous appartient pas.');return file;
}
async function resolveComplaint(db,complaintId,user,refs){
  const row=await db.one('complaints',{id:'eq.'+id(complaintId)});check(row,'Réclamation introuvable.',404);
  const workspace=await readCampus(db,user,refs),visible=workspace.complaints.find(x=>x.id===row.id);check(visible);return {...row,manageable:visible.manageable};
}
async function resolveSpace(db,spaceId,user,write=false){
  const space=await db.one('collaboration_spaces',{id:'eq.'+id(spaceId)});check(space,'Espace introuvable.',404);
  const member=await db.one('collaboration_members',{space_id:'eq.'+space.id,user_id:'eq.'+user.id});
  check(has(user,'admin')||space.created_by===user.id||member||!write&&space.status==='open');
  if(write)check(space.status==='open','Cet espace est clôturé.',409);return space;
}
async function canDownload(db,file,user,refs){
  if(file.uploaded_by===user.id||has(user,'admin'))return true;
  const data=await readCampus(db,user,refs);
  if(data.documents.some(x=>x.file_id===file.id)||data.library.some(x=>x.file_id===file.id)||data.resources.some(x=>x.file_id===file.id)||data.lost.some(x=>x.image_file_id===file.id)||data.news.some(x=>x.cover_file_id===file.id))return true;
  const timetable=refs.timetables.find(t=>t.file_id===file.id&&t.program_id===user.programId);if(timetable)return true;
  const images=await db.all('marketplace_images',{file_id:'eq.'+file.id});return images.some(image=>data.listings.some(l=>l.id===image.listing_id));
}
async function limitedBody(request,limit){
  check(Number(request.headers.get('Content-Length')||0)<=limit,'Fichier trop volumineux (10 Mo maximum).',413);
  const reader=request.body?.getReader();check(reader,'Fichier vide.',400);const chunks=[];let length=0;
  while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>limit){await reader.cancel();throw new ApiError('Fichier trop volumineux (10 Mo maximum).',413)}chunks.push(value)}
  const result=new Uint8Array(length);let offset=0;chunks.forEach(chunk=>{result.set(chunk,offset);offset+=chunk.length});return result;
}
async function upload(request,db,user){
  const type=request.headers.get('Content-Type')?.split(';')[0],bytes=await limitedBody(request,10*1024*1024);
  const signatures={'application/pdf':()=>String.fromCharCode(...bytes.slice(0,5))==='%PDF-','image/png':()=>[137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v),'image/jpeg':()=>bytes[0]===255&&bytes[1]===216&&bytes[2]===255,'image/webp':()=>String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP'};
  check(signatures[type]?.(),'Choisissez un PDF ou une image PNG, JPEG ou WebP valide.',415);
  const filename=clean(new URL(request.url).searchParams.get('name'),180).replace(/[\x00-\x1f/\\"<>]/g,'_')||'document';
  const path=user.id+'/'+crypto.randomUUID(),bucket='campus-files';
  const bucketConfig=await db.request('bucket/'+bucket,{storage:true});
  check(bucketConfig?.public===false,'L’envoi de fichiers est temporairement indisponible.',503);
  await db.storage(bucket+'/'+path,{method:'POST',body:bytes,contentType:type});
  try{return one(await db.insert('files',{uploaded_by:user.id,bucket_id:bucket,object_path:path,original_name:filename,mime_type:type,file_size:bytes.length,visibility:'private',checksum_sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('')}))}
  catch(error){try{await db.storage(bucket+'/'+path,{method:'DELETE'})}catch{}throw error}
}

export function sourceDocuments(data){
  return [
    ...data.announcements.map(x=>({id:x.id,type:'announcement',title:x.title,text:x.body,url:'#announcements'})),
    ...data.modules.map(x=>({id:x.id,type:'module',title:x.title,text:[x.description,x.objectives].filter(Boolean).join(' '),url:'#modules'})),
    ...data.library.map(x=>({id:x.id,type:'library_resource',title:x.title,text:x.abstract||'',url:'#library'})),
    ...data.documents.map(x=>({id:x.id,type:'course_document',title:x.title,text:x.description||'',url:'#documents'}))
  ];
}
const words=value=>clean(value,20000).toLocaleLowerCase('fr').normalize('NFD').replace(/[\u0300-\u036f]/g,'').match(/[a-z0-9]{3,}/g)||[];
export function searchSources(question,sources){
  const stop=new Set(['les','des','une','est','pour','dans','que','qui','avec','sur','mon','mes','comment','quel','quelle','quels','quelles','sont','cours','bonjour','trouver','cherche','propose','proposes','disponible','disponibles']);
  const tokens=[...new Set(words(question))].filter(w=>!stop.has(w));
  const typeWords={event:['evenement','evenements','atelier','conference'],timetable:['emploi','horaire','horaires','seance','seances'],course_document:['document','documents','support','supports'],announcement:['annonce','annonces'],library_resource:['livre','livres','bibliotheque']};
  // Category-only questions can list a type. A specific unmatched title must abstain.
  const typeOnly=tokens.length>0&&tokens.every(token=>Object.values(typeWords).flat().includes(token));
  return sources.map(source=>({...source,score:tokens.reduce((sum,token)=>sum+(words(source.title).includes(token)?3:0)+(words(source.text).includes(token)?1:0)+(typeOnly&&typeWords[source.type]?.includes(token)?2:0),0)})).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,4);
}

async function assistant(request,db,user,refs,env,input){
  const question=required(input.question,'question',3,1500),data=await readCampus(db,user,refs);
  const {bootstrap}=await import('./storage/catalog.mjs');
  const academic=await bootstrap(db,refs,user.program,null,user);
  const events=academic.events.filter(e=>e.status==='published'&&(!e.targeted||e.programs.includes(user.program)));
  const sources=sourceDocuments(data).concat(events.map(e=>({id:e.id,type:'event',title:e.title,text:`${e.description} • ${e.date} à ${e.time} • ${e.location}`,url:'#events'})));
  const timetable=refs.timetables.find(t=>t.program_id===user.programId&&t.semester_id===academic.semesterId);
  if(timetable&&academic.schedule.length)sources.push({id:timetable.id,type:'timetable',title:'Emploi du temps '+user.program,text:academic.schedule.map(s=>`${['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'][s.day]} ${s.start}–${s.end} : ${s.title}, ${s.room}${s.sessionDate?' ('+s.sessionDate+')':''}`).join('\n'),url:'#schedule'});
  const matches=searchSources(question,sources);
  let conversation=input.conversation_id?await db.one('chat_conversations',{id:'eq.'+id(input.conversation_id),user_id:'eq.'+user.id}):null;
  check(!input.conversation_id||conversation,'Conversation introuvable.',404);
  const started=Date.now();let answer,selected=matches,mode='source-search',abstained=matches.length===0;
  if(env.FASTAPI_URL&&env.FASTAPI_TOKEN){
    let base;try{base=new URL(env.FASTAPI_URL)}catch{throw new ApiError('Le service IA est indisponible.',503)}
    check(base.protocol==='https:'&&!base.username&&!base.password&&!base.search&&!base.hash,'Le service IA est indisponible.',503);
    let response;try{response=await fetch(new URL('query',base.href.replace(/\/?$/,'/')).href,{method:'POST',headers:{Authorization:'Bearer '+env.FASTAPI_TOKEN,'Content-Type':'application/json'},body:JSON.stringify({question,sources:matches.map(({id,type,title,text})=>({id,type,title,text}))}),redirect:'manual',signal:AbortSignal.timeout(12000)})}catch{throw new ApiError('L’assistant met trop de temps à répondre. Réessayez.',503)}
    check(response.ok,'L’assistant est momentanément indisponible.',503);
    const remote=await response.json();const citations=Array.isArray(remote.source_ids)?remote.source_ids:[];
    selected=matches.filter(s=>citations.includes(s.id));
    abstained=remote.abstained===true||!selected.length;
    answer=abstained?'Je ne dispose pas de source suffisante pour répondre à cette question.':required(remote.answer,'réponse',1,8000);mode='rag';
  }else{
    answer=abstained?'Je ne trouve pas cette information dans les sources auxquelles vous avez accès. Essayez de préciser un module, une annonce ou un événement.':matches.map(s=>`${s.title}\n${s.text.slice(0,700)||'Consultez la fiche pour en savoir plus.'}`).join('\n\n');
  }
  if(!conversation)conversation=one(await db.insert('chat_conversations',{user_id:user.id,title:question.slice(0,90)}));
  // Persist an answer only when the provider succeeded, or a source search completed.
  await db.insert('chat_messages',{conversation_id:conversation.id,sender:'user',content:question});
  const message=one(await db.insert('chat_messages',{conversation_id:conversation.id,sender:'assistant',content:answer,model_name:mode,response_time_ms:Date.now()-started}));
  if(selected.length)await db.insert('campus_message_citations',selected.map(s=>({message_id:message.id,source_type:s.type,source_id:s.id,title:s.title,url:s.url})));
  await db.update('chat_conversations',conversation.id,{updated_at:now()},{user_id:'eq.'+user.id});
  return {conversation_id:conversation.id,message:{...message,sources:selected.map(({id,type,title,url})=>({id,type,title,url})),abstained},mode};
}

/** Service-role transport requires explicit ownership and scope checks on every route. */
export async function handleCampus({request,db,user,refs,env,path,method,body}){
  const roots=['/campus','/uploads','/files/','/announcements','/documents','/library','/complaints','/news','/lost-found','/collaboration','/locations','/marketplace','/assistant','/recommendations'];
  if(!roots.some(root=>path===root||path.startsWith(root.endsWith('/')?root:root+'/')))return null;
  check(user,'Connectez-vous pour accéder à cet espace.',401);check(user.accountStatus==='active');
  const respond=(value,status=200)=>({value,status});
  if(path==='/campus'&&method==='GET')return respond(await readCampus(db,user,refs,true,true));
  if(path==='/uploads'&&method==='POST')return respond({file:await upload(request,db,user)},201);
  const matchFile=path.match(/^\/files\/([^/]+)$/);
  if(matchFile&&method==='GET'){
    const file=await db.one('files',{id:'eq.'+id(matchFile[1])});check(file,'Fichier introuvable.',404);check(await canDownload(db,file,user,refs));
    check(/^[a-zA-Z0-9._-]+$/.test(file.bucket_id)&&typeof file.object_path==='string'&&!file.object_path.split('/').includes('..'),'Chemin de fichier invalide.',502);
    const remote=await db.storage(file.bucket_id+'/'+file.object_path),inline=new URL(request.url).searchParams.get('inline')==='1'&&['image/png','image/jpeg','image/webp'].includes(file.mime_type);
    return new Response(remote.body,{headers:{'Content-Type':file.mime_type,'Content-Disposition':`${inline?'inline':'attachment'}; filename*=UTF-8''${encodeURIComponent(file.original_name)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; sandbox"}});
  }
  if(path==='/announcements'&&method==='POST'){
    check(has(user,'teacher','department_head'));const input=await body(),scope=await academicScope(db,user,refs);
    const module=scope.modules.find(m=>m.id===input.module_id);check(scope.canTeach(module),'Vous ne pouvez pas publier pour ce module.');
    const targetPrograms=scope.links.filter(l=>l.module_id===module.id).map(l=>l.program_id);
    check(targetPrograms.length,'Aucune filière n’est associée à ce module.',409);
    const result=await db.rpc('campus_publish_announcement',{p_user_id:user.id,p_module_id:module.id,p_title:required(input.title,'titre'),p_body:required(input.body,'message',10,6000)});
    check(result?.id,'La publication n’a pas été enregistrée.',502);return respond(result,201);
  }
  if(path==='/documents'&&method==='POST'){
    check(has(user,'teacher','department_head'));const input=await body(),scope=await academicScope(db,user,refs),module=scope.modules.find(m=>m.id===input.module_id);
    check(scope.canTeach(module),'Vous ne pouvez pas publier pour ce module.');
    const file=await ownedFile(db,input.file_id,user);check(file,'Ajoutez un document.',400);
    return respond(one(await db.insert('course_documents',{module_id:module.id,uploaded_by:user.id,file_id:file.id,title:required(input.title,'titre'),document_type:pick(input.document_type,['course','td','tp','exam','handout','other'],'type de document'),description:clean(input.description,4000),published_at:now()})),201);
  }
  if(path==='/library'&&method==='POST'){
    const input=await body(),file=await ownedFile(db,input.file_id,user),external_url=safeURL(input.external_url);
    check(file||external_url,'Ajoutez un fichier ou un lien.',400);
    const visibility=pick(input.visibility||'all_students',['all_students','selected_programs','private'],'visibilité');
    const resource=one(await db.insert('library_resources',{uploaded_by:user.id,file_id:file?.id||null,title:required(input.title,'titre'),authors:clean(input.authors),abstract:clean(input.abstract,6000),resource_type:pick(input.resource_type,['book','article','project_report','course_support','website','other'],'type de ressource'),external_url,visibility:'private'}));
    if(visibility==='selected_programs'){
      check(user.programId,'Votre filière doit être configurée.',409);
      await db.insert('library_resource_programs',{resource_id:resource.id,program_id:user.programId});
    }
    await db.update('library_resources',resource.id,{visibility},{uploaded_by:'eq.'+user.id});return respond({id:resource.id},201);
  }
  const viewResource=path.match(/^\/library\/([^/]+)\/view$/);
  if(viewResource&&method==='POST'){
    const data=await readCampus(db,user,refs),resource=data.library.find(r=>r.id===id(viewResource[1]));check(resource,'Ressource introuvable.',404);
    await db.insert('resource_views',{user_id:user.id,resource_id:resource.id});return respond({file_id:resource.file_id,url:safeURL(resource.external_url)});
  }
  if(path==='/complaints'&&method==='POST'){
    check(has(user,'student'));const input=await body(),scope=await academicScope(db,user,refs);
    if(input.module_id)check(scope.modules.some(m=>m.id===id(input.module_id)),'Module inaccessible.');
    const type=pick(input.complaint_type,['pedagogical','technical'],'catégorie'),module=scope.modules.find(m=>m.id===input.module_id);let assignedTo=null;
    if(type==='pedagogical'&&module?.responsible_teacher_id&&module.responsible_teacher_id!==user.id){
      const responsible=await db.profile(module.responsible_teacher_id);
      if(responsible?.account_status==='active'&&responsible.roles.some(role=>['teacher','department_head','admin'].includes(role)))assignedTo=responsible.id;
    }
    return respond(one(await db.insert('complaints',{student_id:user.id,module_id:input.module_id||null,assigned_to:assignedTo,subject:required(input.subject,'objet'),description:required(input.description,'description',10,6000),complaint_type:type,status:'submitted'})),201);
  }
  const complaint=path.match(/^\/complaints\/([^/]+)(?:\/(messages))?$/);
  if(complaint){
    const row=await resolveComplaint(db,complaint[1],user,refs);
    if(method==='GET')return respond({complaint:row,messages:await db.all('complaint_messages',{complaint_id:'eq.'+row.id,order:'created_at.asc'})});
    if(method==='POST'&&complaint[2]){const input=await body();return respond(one(await db.insert('complaint_messages',{complaint_id:row.id,author_id:user.id,message:required(input.message,'message',1,4000)})),201)}
    if(method==='PATCH'&&!complaint[2]){
      check(row.manageable&&has(user,'teacher','department_head'));const input=await body(),status=pick(input.status,['under_review','resolved','rejected'],'statut');
      const allowed={submitted:['under_review','rejected'],under_review:['resolved','rejected'],resolved:[],rejected:[]};
      check(allowed[row.status]?.includes(status),'Cette transition de statut n’est pas autorisée.',409);
      const note=required(input.resolution_note,'réponse',3,4000);
      return respond(one(await db.update('complaints',row.id,{status,resolution_note:note,resolved_at:['resolved','rejected'].includes(status)?now():null},{status:'eq.'+row.status}))||(()=>{throw new ApiError('La réclamation a changé. Actualisez la page.',409)})());
    }
  }
  if(path==='/news'&&method==='POST'){
    check(has(user,'teacher','department_head','organizer'));const input=await body(),file=await ownedFile(db,input.cover_file_id,user);
    check(!file||file.mime_type.startsWith('image/'),'Choisissez une image pour la couverture.',400);
    const category=pick(input.category||'campus',['campus','research','clubs','partners'],'catégorie');
    const record={author_id:user.id,title:required(input.title,'titre'),content:required(input.content,'contenu',20,12000),cover_file_id:file?.id||null,status:'published',published_at:now()};
    const categorized=await supportsNewsCategories(db);
    if(categorized)record.category=category;
    else check(category==='campus','Cette catégorie n’est pas disponible. Publiez dans « Vie du campus ».',409);
    return respond(one(await db.insert('news_posts',record)),201);
  }
  if(path==='/lost-found'&&method==='POST'){
    const input=await body(),file=await ownedFile(db,input.image_file_id,user);check(!file||file.mime_type.startsWith('image/'),'Choisissez une image.',400);
    if(input.item_date)check(/^\d{4}-\d{2}-\d{2}$/.test(input.item_date)&&!isNaN(Date.parse(input.item_date)),'Date invalide.',400);
    return respond(one(await db.insert('lost_found_items',{owner_id:user.id,item_type:pick(input.item_type,['lost','found'],'type'),title:required(input.title,'objet'),description:clean(input.description,4000),location_text:required(input.location_text,'lieu'),contact_info:required(input.contact_info,'contact',3,300),item_date:input.item_date||null,image_file_id:file?.id||null,status:'open'})),201);
  }
  const lost=path.match(/^\/lost-found\/([^/]+)$/);
  if(lost&&method==='PATCH'){
    const row=await db.one('lost_found_items',{id:'eq.'+id(lost[1])});check(row,'Annonce introuvable.',404);check(row.owner_id===user.id||has(user,'admin'));
    const input=await body(),status=pick(input.status,['returned','closed'],'statut');check(['open','claimed'].includes(row.status),'Cette annonce est déjà clôturée.',409);
    return respond(one(await db.update('lost_found_items',row.id,{status,updated_at:now()},{status:'eq.'+row.status})));
  }
  if(path==='/collaboration'&&method==='POST'){
    const input=await body();return respond(one(await db.insert('collaboration_spaces',{created_by:user.id,title:required(input.title,'titre'),description:required(input.description,'description',10,4000),topic:clean(input.topic),status:'open'})),201);
  }
  const space=path.match(/^\/collaboration\/([^/]+)(?:\/(join|discussions|resources))?$/);
  if(space){
    if(space[2]==='join'&&method==='POST'){
      const row=await resolveSpace(db,space[1],user);check(row.status==='open','Cet espace est clôturé.',409);
      const member=await db.one('collaboration_members',{space_id:'eq.'+row.id,user_id:'eq.'+user.id});
      if(!member)await db.insert('collaboration_members',{space_id:row.id,user_id:user.id,member_role:'member'});return respond({ok:true});
    }
    const row=await resolveSpace(db,space[1],user,method!=='GET');
    if(method==='GET'){
      const data=await readCampus(db,user,refs);
      return respond({space:row,resources:data.resources.filter(r=>r.space_id===row.id),discussions:await db.all('campus_discussions',{space_id:'eq.'+row.id,order:'created_at.asc'})});
    }
    const input=await body();
    if(method==='POST'&&space[2]==='discussions')return respond(one(await db.insert('campus_discussions',{space_id:row.id,author_id:user.id,message:required(input.message,'message',1,4000)})),201);
    if(method==='POST'&&space[2]==='resources'){
      const file=await ownedFile(db,input.file_id,user);let resourceId=null;
      if(input.library_resource_id){const data=await readCampus(db,user,refs),resource=data.library.find(r=>r.id===id(input.library_resource_id));check(resource&&resource.visibility==='all_students','Partagez une ressource accessible à toutes les filières.',400);resourceId=resource.id}
      check(file||resourceId,'Ajoutez un fichier ou une ressource de bibliothèque.',400);
      return respond(one(await db.insert('shared_resources',{space_id:row.id,shared_by:user.id,file_id:file?.id||null,library_resource_id:resourceId,title:required(input.title,'titre'),description:clean(input.description,4000)})),201);
    }
    if(method==='PATCH'&&!space[2]){check(row.created_by===user.id||has(user,'admin'));return respond(one(await db.update('collaboration_spaces',row.id,{status:'closed'})))}
  }
  if(path==='/locations'&&method==='POST'){
    check(has(user,'admin'));const input=await body();
    for(const key of ['map_x','map_y'])check(input[key]!==''&&Number.isFinite(Number(input[key]))&&Number(input[key])>=0&&Number(input[key])<=100,'Position invalide (0 à 100).',400);
    return respond(one(await db.insert('campus_locations',{name:required(input.name,'nom'),location_type:pick(input.location_type,['classroom','amphitheatre','lab','department','library','service','other'],'type de lieu'),building:clean(input.building),description:clean(input.description,4000),map_x:Number(input.map_x),map_y:Number(input.map_y)})),201);
  }
  if(path==='/marketplace'&&method==='POST'){
    check(has(user,'student'));const input=await body(),kind=pick(input.listing_type,['sale','loan','donation','exchange'],'type d’offre');
    const price=kind==='sale'?Number(input.price):null;check(price===null||Number.isFinite(price)&&price>=0&&price<=100000,'Prix invalide.',400);
    const file=await ownedFile(db,input.image_file_id,user);check(!file||file.mime_type.startsWith('image/'),'Choisissez une image.',400);
    const category=input.category_id?await db.one('marketplace_categories',{id:'eq.'+id(input.category_id)}):null;
    const listing=one(await db.insert('marketplace_listings',{seller_id:user.id,title:required(input.title,'titre'),description:required(input.description,'description',10,4000),listing_type:kind,item_condition:pick(input.item_condition,['new','very_good','good','acceptable','not_applicable'],'état'),price,currency:'MAD',category_id:category?.id||null,status:'available',published_at:now()}));
    if(file)await db.insert('marketplace_images',{listing_id:listing.id,file_id:file.id,sort_order:0});return respond({id:listing.id},201);
  }
  const listing=path.match(/^\/marketplace\/([^/]+)(?:\/(request|images))?$/);
  if(listing){
    const listingId=id(listing[1]);
    if(method==='GET'&&listing[2]==='images'){
      const data=await readCampus(db,user,refs);check(data.listings.some(l=>l.id===listingId),'Offre introuvable.',404);
      return respond({images:await db.all('marketplace_images',{listing_id:'eq.'+listingId,order:'sort_order.asc'})});
    }
    if(method==='POST'&&listing[2]==='request'){
      check(has(user,'student'));const result=await db.rpc('campus_marketplace_request',{p_user_id:user.id,p_listing_id:listingId});check(result?.status==='ok',result?.status==='duplicate'?'Une demande est déjà en cours.':'Cette offre n’est plus disponible.',409);return respond(result,201);
    }
    if(method==='PATCH'&&!listing[2]){
      const row=await db.one('marketplace_listings',{id:'eq.'+listingId});check(row,'Offre introuvable.',404);check(row.seller_id===user.id||has(user,'admin'));
      const input=await body(),status=pick(input.status,['completed','withdrawn'],'statut');
      const result=await db.rpc('campus_marketplace_close',{p_user_id:user.id,p_listing_id:listingId,p_status:status});check(result?.status==='ok','Cette offre a changé. Actualisez la page.',409);return respond(result);
    }
  }
  const transaction=path.match(/^\/marketplace\/transactions\/([^/]+)$/);
  if(transaction&&method==='PATCH'){
    const input=await body(),result=await db.rpc('campus_marketplace_decide',{p_user_id:user.id,p_transaction_id:id(transaction[1]),p_status:pick(input.status,['accepted','rejected','completed','cancelled'],'statut')});
    check(result?.status==='ok','Cette demande a changé ou vous ne pouvez pas la modifier.',409);return respond(result);
  }
  if(path==='/assistant'&&method==='POST')return respond(await assistant(request,db,user,refs,env,await body()));
  if(path==='/assistant'&&method==='GET')return respond({conversations:await db.all('chat_conversations',{user_id:'eq.'+user.id,order:'updated_at.desc'})});
  const chat=path.match(/^\/assistant\/([^/]+)(?:\/(feedback))?$/);
  if(chat){
    if(method==='GET'){
      const conversation=await db.one('chat_conversations',{id:'eq.'+id(chat[1]),user_id:'eq.'+user.id});check(conversation,'Conversation introuvable.',404);
      const messages=await db.all('chat_messages',{conversation_id:'eq.'+conversation.id,order:'created_at.asc'}),citations=messages.length?await db.all('campus_message_citations',{message_id:'in.('+messages.map(m=>m.id).join(',')+')'}):[];
      return respond({conversation,messages:messages.map(m=>({...m,sources:citations.filter(s=>s.message_id===m.id).map(s=>({id:s.source_id,type:s.source_type,title:s.title,url:s.url}))}))});
    }
    if(method==='POST'&&chat[2]){
      const message=await db.one('chat_messages',{id:'eq.'+id(chat[1]),sender:'eq.assistant'});check(message,'Réponse introuvable.',404);
      const conversation=await db.one('chat_conversations',{id:'eq.'+message.conversation_id,user_id:'eq.'+user.id});check(conversation);
      const input=await body();check(typeof input.is_relevant==='boolean','Évaluation invalide.',400);
      const existing=await db.one('campus_chat_feedback',{message_id:'eq.'+message.id,user_id:'eq.'+user.id});
      if(existing)await db.update('campus_chat_feedback',existing.id,{is_relevant:input.is_relevant});else await db.insert('campus_chat_feedback',{message_id:message.id,user_id:user.id,is_relevant:input.is_relevant});return respond({ok:true});
    }
  }
  if(path==='/recommendations'&&method==='POST'){
    const data=await readCampus(db,user,refs),candidates=data.library.map(r=>({type:'library_resource',id:r.id,title:r.title,text:r.abstract||''})).concat(data.resources.map(r=>({type:'shared_resource',id:r.id,title:r.title,text:r.description||''})));
    const {loadEvents}=await import('./storage/catalog.mjs');
    candidates.push(...(await loadEvents(db,refs,user)).filter(e=>e.status==='published'&&new Date(e.starts_at)>new Date()&&(!e.targeted||e.programs.includes(user.program))).map(e=>({type:'event',id:e.id,title:e.title,text:e.description})));
    const terms=words(data.modules.map(m=>m.title).join(' '));
    const selected=candidates.map(r=>({...r,score:terms.reduce((n,w)=>n+(words(r.title+' '+r.text).includes(w)?1:0),0)})).sort((a,b)=>b.score-a.score).slice(0,3);
    if(selected.length)await db.insert('recommendations',selected.map(r=>({user_id:user.id,target_type:r.type,target_id:r.id,score:r.score,explanation:r.score?'En lien avec les modules de votre parcours.':'À découvrir parmi les contenus auxquels vous avez accès.',algorithm_version:'content-rules-v1',expires_at:new Date(Date.now()+86400000).toISOString()})));
    return respond({recommendations:selected});
  }
  const feedback=path.match(/^\/recommendations\/([^/]+)\/feedback$/);
  if(feedback&&method==='POST'){
    const row=await db.one('recommendations',{id:'eq.'+id(feedback[1]),user_id:'eq.'+user.id});check(row,'Recommandation introuvable.',404);const input=await body();check(typeof input.is_relevant==='boolean','Évaluation invalide.',400);
    const existing=await db.one('recommendation_feedback',{recommendation_id:'eq.'+row.id,user_id:'eq.'+user.id});
    if(existing)await db.update('recommendation_feedback',existing.id,{is_relevant:input.is_relevant});else await db.insert('recommendation_feedback',{recommendation_id:row.id,user_id:user.id,is_relevant:input.is_relevant});return respond({ok:true});
  }
  return respond({error:'Ressource introuvable.'},404);
}
