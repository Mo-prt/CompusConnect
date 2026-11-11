import {moroccoParts} from '../time.mjs';
const uniq=items=>[...new Set(items.filter(Boolean))];
const inFilter=ids=>'in.('+uniq(ids).join(',')+')';
const fullName=p=>[p?.first_name,p?.last_name].filter(Boolean).join(' ')||'Non renseigné';
const semesterCode=s=>s?.number?'S'+s.number:s?.name||'';
const activeRegistration=r=>['registered','attended'].includes(r.status);
const categoryLabels={conference:'Conférence',workshop:'Atelier',competition:'Compétition',club_activity:'Vie associative',club:'Vie associative'};
export const eventCategory=value=>categoryLabels[value]||value;

export async function references(db){
  const [programs,departments,semesters,timetables,heads]=await Promise.all([
    db.all('programs',{is_active:'eq.true',order:'name.asc'}),db.all('departments'),
    db.all('semesters',{order:'academic_year.desc,number.asc'}),db.all('timetables',{is_current:'eq.true',order:'academic_year.desc,version_number.desc'}),db.all('department_heads')
  ]);
  const headIds=uniq(heads.map(h=>h.user_id));
  const people=headIds.length?await db.all('profiles',{id:inFilter(headIds),select:'id,first_name,last_name,email'}):[];
  const today=moroccoParts(Date.now()).date;
  const mapped=programs.map(p=>{
    const department=departments.find(d=>d.id===p.department_id);
    const head=heads.find(h=>h.department_id===p.department_id&&(!h.starts_on||h.starts_on<=today)&&(!h.ends_on||h.ends_on>=today));
    const person=people.find(x=>x.id===head?.user_id);
    const timetable=timetables.find(t=>t.program_id===p.id);
    const semester=semesters.find(s=>s.id===timetable?.semester_id)||semesters[0];
    return {id:p.code,uuid:p.id,departmentId:p.department_id,name:p.name,description:p.description||department?.description||'',department:department?.name||'Département non renseigné',semester:semesterCode(semester),academicYear:semester?.academic_year||'',head:fullName(person),initials:person?[person.first_name?.[0],person.last_name?.[0]].filter(Boolean).join('').toUpperCase():'FPK',email:department?.email||person?.email||'Non renseigné',office:department?.office_location||'Non renseigné',hours:head?.office_hours||'Non renseigné',guidance:head?.academic_guidance||'',color:'purple'};
  });
  return {programs:mapped,rawPrograms:programs,semesters,timetables};
}

export async function displayUser(db,authUser,refs){
  const profile=await db.profile(authUser.id);
  if(!profile)return null;
  const program=refs.programs.find(p=>p.uuid===profile.program_id)||refs.programs.find(p=>p.departmentId===profile.department_id)||refs.programs[0];
  const roles=profile.roles;
  const role=roles.includes('organizer')||roles.includes('admin')?'organizer':roles.includes('teacher')||roles.includes('department_head')?'teacher':roles.includes('student')?'student':null;
  return {id:profile.id,name:fullName(profile),email:authUser.email||profile.email||'',program:program?.id||'',programId:profile.program_id,departmentId:profile.department_id,semester:program?.semester||'',role,roles,accountStatus:profile.account_status,demo:false};
}

export async function loadEvents(db,refs,user){
  const query={order:'starts_at.asc'};
  if(user&&!user.roles.includes('admin'))query.or=`(status.eq.published,organizer_id.eq.${user.id})`;
  else if(!user)query.status='eq.published';
  let events=await db.all('events',query);
  if(user){
    const ownRegistrations=await db.all('event_registrations',{student_id:'eq.'+user.id,status:'in.(registered,attended)',select:'event_id'});
    const missing=ownRegistrations.filter(r=>!events.some(e=>e.id===r.event_id)).map(r=>r.event_id);
    if(missing.length)events.push(...await db.all('events',{id:inFilter(missing)}));
  }
  if(!events.length)return[];
  const ids=events.map(e=>e.id);
  const [targets,registrations,organizers]=await Promise.all([
    db.all('event_program_targets',{event_id:inFilter(ids)}),
    db.all('event_registrations',{event_id:inFilter(ids),status:'in.(registered,attended)',select:user?'event_id,student_id,status':'event_id,status'}),
    db.all('profiles',{id:inFilter(events.map(e=>e.organizer_id)),select:'id,first_name,last_name'})
  ]);
  return events.map(e=>{
    const programs=targets.filter(t=>t.event_id===e.id).map(t=>refs.programs.find(p=>p.uuid===t.program_id)?.id).filter(Boolean);
    const start=moroccoParts(e.starts_at),end=moroccoParts(e.ends_at),enrollments=registrations.filter(r=>r.event_id===e.id&&activeRegistration(r));
    const category=eventCategory(e.category);
    return {...e,category,owner_id:e.organizer_id,date:start.date,time:start.time,endTime:end.time,endDate:end.date,location:e.location_text,organizer:fullName(organizers.find(p=>p.id===e.organizer_id)),program:programs.length?programs.length===1?programs[0]:'Plusieurs filières':'Toutes',programs,targeted:targets.some(t=>t.event_id===e.id),registered:enrollments.length,joined:!!user&&enrollments.some(r=>r.student_id===user.id),image:category==='Conférence'?'ai':category==='Compétition'?'hack':category==='Vie associative'?'eco':'web'};
  }).sort((a,b)=>a.starts_at.localeCompare(b.starts_at));
}

export async function bootstrap(db,refs,programCode,semesterValue,user){
  const program=refs.programs.find(p=>p.id===programCode)||refs.programs.find(p=>p.id===user?.program)||refs.programs[0];
  const selectedSemester=refs.semesters.find(s=>s.id===semesterValue)||refs.semesters.find(s=>semesterCode(s)===(semesterValue||program?.semester))||refs.semesters[0];
  const eventsPromise=loadEvents(db,refs,user);
  let modules=[],schedule=[];
  if(program){
    const links=await db.all('program_modules',{program_id:'eq.'+program.uuid,...(selectedSemester?{academic_year:'eq.'+selectedSemester.academic_year}:{})});
    const moduleRows=links.length?await db.all('modules',{id:inFilter(links.map(l=>l.module_id)),...(selectedSemester?{semester_id:'eq.'+selectedSemester.id}:{})}):[];
    const timetable=refs.timetables.find(t=>t.program_id===program.uuid&&t.semester_id===selectedSemester?.id);
    const sessions=timetable?await db.all('timetable_sessions',{timetable_id:'eq.'+timetable.id,order:'weekday.asc,starts_at.asc'}):[];
    const teacherIds=uniq([...moduleRows.map(m=>m.responsible_teacher_id),...sessions.map(s=>s.teacher_id)]);
    const roomIds=uniq(sessions.map(s=>s.classroom_id));
    const [teachers,rooms]=await Promise.all([
      teacherIds.length?db.all('profiles',{id:inFilter(teacherIds),select:'id,first_name,last_name'}):[],
      roomIds.length?db.all('classrooms',{id:inFilter(roomIds)}):[]
    ]);
    modules=moduleRows.map(m=>[m.code,m.title,fullName(teachers.find(t=>t.id===m.responsible_teacher_id)),Number(m.weekly_hours||0),m.objectives||m.description||'Objectifs non renseignés',m.code.slice(0,3)]);
    schedule=sessions.map(s=>{
      const module=moduleRows.find(m=>m.id===s.module_id),room=rooms.find(r=>r.id===s.classroom_id);
      const label={lecture:'Cours',tutorial:'TD',practical:'TP',workshop:'Atelier',course:'Cours',td:'TD',tp:'TP'}[s.session_type]||s.session_type;
      return {day:s.weekday-1,start:s.starts_at.slice(0,5),end:s.ends_at.slice(0,5),sessionDate:s.session_date,title:module?.title||'Module non renseigné',teacher:fullName(teachers.find(t=>t.id===(s.teacher_id||module?.responsible_teacher_id))),room:room?[room.name,room.building].filter(Boolean).join(' · '):'Salle non renseignée',type:label,color:s.session_type==='practical'?'blue':'purple'};
    });
  }
  return {user,programs:refs.programs,semesters:refs.semesters.map(s=>({id:s.id,code:semesterCode(s),label:s.name,academicYear:s.academic_year})),program:program?.id||'',semester:semesterCode(selectedSemester),semesterId:selectedSemester?.id||'',academicYear:selectedSemester?.academic_year||'',modules,schedule,events:await eventsPromise,demoEnabled:false};
}
