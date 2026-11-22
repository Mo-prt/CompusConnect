/* Role-specific views. Permissions and assignments always come from the backend. */
function spaceRole(){
  if(state.activeRole&&roleAllowed(state.activeRole))return state.activeRole;
  let saved;try{saved=window.sessionStorage.getItem('campusconnect-space:'+state.user?.id)}catch{}
  for(const role of [saved,state.user?.role,'student','teacher','organizer'])if(role&&roleAllowed(role))return role;
  return '';
}
function rememberSpace(role){if(state.user&&roleAllowed(role)){try{window.sessionStorage.setItem('campusconnect-space:'+state.user.id,role)}catch{}}}
function spaceHome(role=spaceRole()){return role==='organizer'?'organizer':role==='teacher'?'teaching':'dashboard'}
function spaceLabel(role=spaceRole()){
  if(role==='teacher')return state.user?.roles.includes('department_head')?'Chef de département':'Enseignant';
  return role==='organizer'?'Organisateur':'Étudiant';
}
function spaceDenied(label){return heading('Espace '+label)+empty('Cet espace est réservé aux profils autorisés','Les autorisations sont attribuées par l’établissement.','shield','<a class="btn secondary" href="#choose-profile">Voir mes espaces</a>')}
function spaceMenu(){
  if(spaceRole()==='organizer')return [['organizer','briefcase','Mes événements'],['events','ticket','Catalogue des événements'],['news','home','Actualités'],['lost','search','Annonces communautaires']];
  if(spaceRole()==='teacher')return [['teaching','home','Tableau de bord'],['department','building','Mon département'],['teaching-modules','book',state.user.roles.includes('department_head')?'Modules du département':'Mes modules'],['teaching-schedule','calendar','Emploi du temps'],['announcements','mail','Annonces pédagogiques'],['documents','file','Documents de cours'],['complaints','help','Réclamations à traiter'],['events','ticket','Événements']];
  return [...campusNav,...(hasRole('student')?[['registrations','check','Mes inscriptions']]:[])];
}
function teachingRows(){
  const data=state.workspace.teaching||{modules:[],programs:[],semesters:[],schedule:[]};
  const program=data.programs.some(p=>p.id===state.staffProgram)?state.staffProgram:'all',semester=data.semesters.some(s=>s.id===state.staffSemester)?state.staffSemester:'all';
  return {...data,modules:data.modules.filter(m=>(program==='all'||m.programs.includes(program))&&(semester==='all'||m.semester_id===semester)),schedule:data.schedule.filter(s=>(program==='all'||s.program===program)&&(semester==='all'||s.semesterId===semester))};
}
function teachingFilters(){
  const data=state.workspace.teaching||{programs:[],semesters:[]};
  return `<div class="toolbar staff-filters"><label>Filière<select id="staff-program"><option value="all">Toutes mes filières</option>${data.programs.map(p=>`<option value="${esc(p.id)}" ${p.id===state.staffProgram?'selected':''}>${esc(p.id)} · ${esc(p.name)}</option>`).join('')}</select></label><label>Semestre<select id="staff-semester"><option value="all">Tous les semestres</option>${data.semesters.map(s=>`<option value="${esc(s.id)}" ${s.id===state.staffSemester?'selected':''}>${esc(s.label)} · ${esc(s.academicYear)}</option>`).join('')}</select></label></div>`;
}
function staffStats(items){return `<div class="quick-stats">${items.map(([i,title,value,page])=>`<a class="quick-stat" href="#${page}"><span>${icon(i)}</span><strong>${esc(title)}</strong><small>${esc(value)}</small></a>`).join('')}</div>`}
function teachingDashboard(){
  if(!roleAllowed('teacher'))return spaceDenied('enseignant');
  const data=state.workspace.teaching,manageable=state.workspace.complaints.filter(r=>r.manageable),ownAnnouncements=state.workspace.announcements.filter(r=>r.author_id===state.user.id),ownDocuments=state.workspace.documents.filter(r=>r.uploaded_by===state.user.id);
  if(!data)return heading('Espace enseignant')+notice(state.workspaceError?'L’espace pédagogique est momentanément indisponible. Réessayez.':'Chargement de votre espace pédagogique.')+action('retry','Actualiser','btn secondary');
  const today=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].indexOf(new Intl.DateTimeFormat('en-US',{weekday:'short',timeZone:'Africa/Casablanca'}).format(new Date()));
  const sessions=data.schedule.filter(s=>s.day===today&&(!s.sessionDate||s.sessionDate===todayKey()));
  return `<section class="dashboard-welcome"><div><div class="eyebrow">ESPACE ${esc(spaceLabel('teacher').toLocaleUpperCase('fr'))}</div><h1>Bonjour, ${esc(state.user.name.split(' ')[0])}</h1><p>Vos enseignements, vos publications et les réclamations de votre périmètre.</p></div><div class="welcome-campus"></div></section>`+
    staffStats([['book','Modules suivis',data.modules.length+' module(s)','teaching-modules'],['mail','Mes annonces',ownAnnouncements.length+' publication(s)','announcements'],['file','Mes documents',ownDocuments.length+' document(s)','documents'],['help','À traiter',manageable.filter(r=>['submitted','under_review'].includes(r.status)).length+' réclamation(s)','complaints']])+
    `<div class="staff-actions">${action('new-resource',icon('plus')+' Publier une annonce','btn','data-kind="announcement"')}${action('new-resource',icon('plus')+' Ajouter un document','btn secondary','data-kind="document"')}<a href="#teaching-schedule" class="btn secondary">${icon('calendar')} Mon emploi du temps</a></div>`+
    (!data.modules.some(m=>m.writable)?notice('Aucun module de publication ne vous est encore attribué. Contactez votre département pour configurer vos affectations.'):'')+
    `<div class="dashboard-grid"><section><div class="section-heading"><h2>Mes séances aujourd’hui</h2></div>${panelList(sessions,s=>`<div class="resource-row"><span class="file-symbol">${icon('calendar')}</span><div><small>${esc(s.start)} – ${esc(s.end)} · ${esc(s.program)}</small><h3>${esc(s.title)}</h3><p>${esc(s.room)} · ${esc(s.type)}</p></div></div>`,'Aucune séance prévue aujourd’hui')}</section><section><div class="section-heading"><h2>Réclamations à suivre</h2><a href="#complaints" class="text-btn">Voir tout ${icon('arrow')}</a></div>${panelList(manageable.filter(r=>['submitted','under_review'].includes(r.status)).slice(0,4),r=>`<button class="resource-row row-link" data-action="view-complaint" data-id="${esc(r.id)}"><span class="file-symbol">${icon('help')}</span><div><h3>${esc(r.subject)}</h3><small>${shortDate(r.submitted_at)}</small></div>${badge(complaintLabels[r.status])}</button>`,'Aucune réclamation en attente')}</section></div>`;
}
function teachingModules(){
  if(!roleAllowed('teacher'))return spaceDenied('enseignant');
  const data=teachingRows();
  return heading(state.user.roles.includes('department_head')?'Modules du département':'Mes enseignements','Les modules et les affectations enregistrés pour votre compte.')+teachingFilters()+
    `<div class="module-grid">${data.modules.map(m=>`<article class="module-card"><div class="module-top"><span class="module-icon">${icon('book')}</span>${badge(m.code)}</div><h3>${esc(m.title)}</h3><p>${esc(m.objectives||m.description||'Présentation du module à venir.')}</p><div class="module-bottom"><span>${esc(m.programs.join(' · ')||'Filière non renseignée')}</span><span>${esc(m.weekly_hours)} h / semaine</span></div>${m.writable?`<div class="staff-module-actions">${action('new-resource','Publier une annonce','btn small',`data-kind="announcement" data-parent="${esc(m.id)}"`)}${action('new-resource','Ajouter un document','btn secondary small',`data-kind="document" data-parent="${esc(m.id)}"`)}</div>`:badge('Consultation')}</article>`).join('')||empty('Aucun module pour cette sélection','Votre département attribue les modules aux enseignants. Modifiez les filtres ou contactez-le.','book')}</div>`;
}
function teachingSchedule(){
  if(!roleAllowed('teacher'))return spaceDenied('enseignant');
  const data=teachingRows(),start=monday(),end=new Date(start);end.setDate(end.getDate()+6);
  const startKey=start.toISOString().slice(0,10),endKey=end.toISOString().slice(0,10),sessions=data.schedule.filter(s=>!s.sessionDate||s.sessionDate>=startKey&&s.sessionDate<=endKey);
  return heading('Emploi du temps enseignant','Séances courantes correspondant à vos affectations.',action('print',icon('download')+' Imprimer','btn secondary'))+teachingFilters()+
    `<div class="staff-week week-controls">${action('prev-week','← Semaine précédente','btn secondary small')}<strong>${fmtDate(startKey)} – ${fmtDate(endKey)}</strong>${action('next-week','Semaine suivante →','btn secondary small')}${action('this-week','Cette semaine','text-btn')}</div>`+
    (sessions.length?`<div class="panel table-wrap"><table class="organizer-table"><thead><tr><th>Jour</th><th>Horaire</th><th>Module</th><th>Filière</th><th>Lieu</th><th>Enseignant</th></tr></thead><tbody>${sessions.map(s=>`<tr><td>${['Lundi','Mardi','Mercredi','Jeudi','Vendredi','Samedi','Dimanche'][s.day]}${s.sessionDate?`<small>${fmtDate(s.sessionDate)}</small>`:''}</td><td>${esc(s.start)} – ${esc(s.end)}</td><td><strong>${esc(s.title)}</strong><small>${esc(s.type)}</small></td><td>${esc(s.program)}</td><td>${esc(s.room)}</td><td>${esc(s.teacher)}</td></tr>`).join('')}</tbody></table></div>`:empty('Aucune séance pour cette semaine','Les séances apparaissent après leur affectation dans l’emploi du temps courant.','calendar'));
}
function organizerWorkspace(){
  if(!roleAllowed('organizer'))return spaceDenied('organisateur');
  const list=(state.data?.events||[]).filter(canManage),status=getTab('organizer-status','all'),rows=list.filter(matchesQuery).filter(e=>status==='all'||e.status===status);
  return heading('Espace organisateur','Créez vos événements et suivez leurs inscriptions.',`<div class="news-actions">${action('create-event',icon('plus')+' Créer un événement','btn')}${action('new-resource','Publier une actualité','btn secondary','data-kind="news"')}</div>`)+
    staffStats([['ticket','Publiés',list.filter(e=>e.status==='published').length+' événement(s)','organizer'],['edit','Brouillons',list.filter(e=>e.status==='draft').length+' événement(s)','organizer'],['users','Inscriptions',list.reduce((sum,e)=>sum+e.registered,0)+' inscription(s) actives','organizer'],['calendar','À venir',list.filter(e=>e.status==='published'&&isFuture(e)).length+' rendez-vous','organizer']])+
    tabs('organizer-status',[['all','Tous'],['draft','Brouillons'],['published','Publiés'],['cancelled','Annulés'],['completed','Terminés']],status)+searchBox('Rechercher dans mes événements…')+
    (rows.length?`<div class="panel table-wrap"><table class="organizer-table"><thead><tr><th>Événement</th><th>Date et lieu</th><th>Inscriptions</th><th>Statut</th><th>Actions</th></tr></thead><tbody>${rows.map(e=>`<tr><td><strong>${esc(e.title)}</strong><small>${esc(e.category)}</small></td><td>${fmtDate(e.date)} · ${esc(e.time)}<small>${esc(e.location)}</small></td><td>${esc(e.registered)} / ${e.capacity==null?'Sans limite':esc(e.capacity)}</td><td>${badge(({published:'Publié',draft:'Brouillon',cancelled:'Annulé',completed:'Terminé'})[e.status]||e.status,e.status==='published'?'green':e.status==='cancelled'?'red':'')}</td><td><div class="row-actions">${action('detail','Consulter','text-btn',`data-id="${esc(e.id)}"`)}${action('participants','Participants','btn secondary small',`data-id="${esc(e.id)}"`)}${['published','draft'].includes(e.status)?action('edit-event','Modifier','btn secondary small',`data-id="${esc(e.id)}"`)+action('cancel-event','Annuler','btn danger small',`data-id="${esc(e.id)}"`):''}</div></td></tr>`).join('')}</tbody></table></div>`:empty('Aucun événement pour cette sélection','Créez un événement ou modifiez les filtres pour retrouver vos publications.','ticket',action('create-event','Créer un événement','btn')));
}

let participantTimer=null,participantSequence=0,participantRefresh=null;
function stopParticipantWatch(){clearTimeout(participantTimer);participantTimer=null;participantRefresh=null;participantSequence++}
function participantsContent(rows){return rows.length?`<div class="table-wrap"><table class="organizer-table"><thead><tr><th>Étudiant</th><th>Email universitaire</th><th>Filière</th><th>Inscription</th></tr></thead><tbody>${rows.map(person=>`<tr><td>${esc(person.name)}</td><td>${esc(person.email)}</td><td>${esc(person.program)}</td><td>${shortDate(person.created_at)}</td></tr>`).join('')}</tbody></table></div>`:empty('Aucun étudiant inscrit','Les inscriptions apparaîtront ici automatiquement.','users')}
async function liveParticipants(id){
  stopParticipantWatch();const requestSequence=participantSequence,actor=state.user?.id,event=state.data?.events.find(event=>event.id===id);
  if(!roleAllowed('organizer')||!event||!canManage(event)){toast('Cet événement n’est pas accessible dans votre espace organisateur.');return}
  try{
    const data=await api('/events/'+encodeURIComponent(id)+'/participants');
    if(requestSequence!==participantSequence||state.user?.id!==actor)return;
    if(!Array.isArray(data.participants))throw new Error('La liste des participants est momentanément indisponible.');
    event.registered=data.participants.length;
    modal(`<div class="modal-content"><div class="eyebrow">SUIVI DES INSCRIPTIONS</div><h2 id="modal-title">Participants · ${esc(event.title)}</h2><p class="description">Actualisation automatique toutes les 5 secondes pendant l’ouverture de cette fenêtre.</p><div class="counter-label" id="participants-count">${data.participants.length} inscription(s) active(s) · ${event.capacity==null?'Sans limite de places':esc(event.capacity)+' places'}</div><div id="participants-live">${participantsContent(data.participants)}</div><p id="participants-status" class="subtle" role="status" aria-live="polite">Liste à jour.</p><div class="detail-footer">${action('refresh-participants','Actualiser maintenant','btn secondary',`data-id="${esc(id)}"`)}</div></div>`,true);
    const sequence=participantSequence;let refreshing=false;
    const schedule=()=>{participantTimer=setTimeout(update,5000)};
    async function update(){
      if(sequence!==participantSequence||state.user?.id!==actor||!document.getElementById('participants-live'))return;
      if(document.hidden){schedule();return}
      if(refreshing)return;refreshing=true;
      try{
        const result=await api('/events/'+encodeURIComponent(id)+'/participants');
        if(sequence!==participantSequence||state.user?.id!==actor)return;
        if(!Array.isArray(result.participants))throw new Error('Liste indisponible.');
        document.getElementById('participants-live').innerHTML=participantsContent(result.participants);
        document.getElementById('participants-count').textContent=result.participants.length+' inscription(s) active(s) · '+(event.capacity==null?'Sans limite de places':event.capacity+' places');
        document.getElementById('participants-status').textContent='Liste à jour.';event.registered=result.participants.length;
      }catch(error){
        if(sequence!==participantSequence)return;
        if([401,403,404].includes(error.status)){document.getElementById('participants-live').innerHTML=notice('L’accès à cette liste a été interrompu. Reconnectez-vous ou vérifiez vos autorisations.','error');document.getElementById('participants-count').textContent='';document.getElementById('participants-status').textContent='Actualisation arrêtée.';stopParticipantWatch();return}
        document.getElementById('participants-status').textContent='Actualisation momentanément indisponible. Nouvelle tentative dans quelques secondes.';
      }finally{refreshing=false}
      if(sequence===participantSequence)schedule();
    }
    participantRefresh=()=>{clearTimeout(participantTimer);return update()};
    schedule();
  }catch(error){if(requestSequence===participantSequence)toast(error.message)}
}
