const inFilter=ids=>'in.('+[...new Set(ids)].join(',')+')';
const fullName=person=>[person?.first_name,person?.last_name].filter(Boolean).join(' ')||'Non renseigné';

/** Staff-only view of assigned modules and current teaching sessions. No role is granted here. */
export async function teachingWorkspace(db,user,refs,scope){
  const admin=user.roles.includes('admin'),teacher=user.roles.includes('teacher'),head=user.roles.includes('department_head');
  if(!admin&&!teacher&&!head)return null;
  const writable=scope.modules.filter(scope.canTeach),writableIds=new Set(writable.map(module=>module.id));
  const timetables=refs.timetables,current=new Map(timetables.map(t=>[t.id,t]));
  const allSessions=current.size?await db.all('timetable_sessions',{timetable_id:inFilter([...current.keys()]),order:'weekday.asc,starts_at.asc'}):[];
  const sessions=allSessions.filter(session=>{
    const timetable=current.get(session.timetable_id),program=refs.programs.find(p=>p.uuid===timetable?.program_id);
    return admin||head&&user.departmentId&&program?.departmentId===user.departmentId||teacher&&(session.teacher_id===user.id||!session.teacher_id&&writableIds.has(session.module_id));
  });
  const moduleIds=new Set([...writableIds,...sessions.map(session=>session.module_id)]);
  const modules=scope.allModules.filter(module=>moduleIds.has(module.id));
  const programs=refs.programs.filter(program=>scope.links.some(link=>link.program_id===program.uuid&&moduleIds.has(link.module_id))||sessions.some(session=>current.get(session.timetable_id)?.program_id===program.uuid));
  const teacherIds=[...new Set(sessions.map(session=>session.teacher_id||modules.find(module=>module.id===session.module_id)?.responsible_teacher_id).filter(Boolean))];
  const roomIds=[...new Set(sessions.map(session=>session.classroom_id).filter(Boolean))];
  const [people,rooms]=await Promise.all([
    teacherIds.length?db.all('profiles',{id:inFilter(teacherIds),select:'id,first_name,last_name'}):[],
    roomIds.length?db.all('classrooms',{id:inFilter(roomIds)}):[]
  ]);
  const semesterIds=new Set([...modules.map(module=>module.semester_id),...sessions.map(session=>current.get(session.timetable_id)?.semester_id)]);
  return {
    programs:programs.map(({id,uuid,name,department,departmentId})=>({id,uuid,name,department,departmentId})),
    semesters:refs.semesters.filter(semester=>semesterIds.has(semester.id)).map(semester=>({id:semester.id,label:semester.name,code:semester.number?'S'+semester.number:semester.name,academicYear:semester.academic_year})),
    modules:modules.map(module=>({
      id:module.id,code:module.code,title:module.title,description:module.description||'',objectives:module.objectives||'',weekly_hours:Number(module.weekly_hours||0),semester_id:module.semester_id,
      programs:programs.filter(program=>scope.links.some(link=>link.program_id===program.uuid&&link.module_id===module.id)).map(program=>program.id),writable:writableIds.has(module.id)
    })),
    schedule:sessions.map(session=>{
      const module=modules.find(module=>module.id===session.module_id),timetable=current.get(session.timetable_id),program=programs.find(program=>program.uuid===timetable?.program_id),room=rooms.find(room=>room.id===session.classroom_id);
      const person=people.find(person=>person.id===(session.teacher_id||module?.responsible_teacher_id));
      return {moduleId:session.module_id,program:program?.id||'',semesterId:timetable?.semester_id,day:session.weekday-1,start:session.starts_at.slice(0,5),end:session.ends_at.slice(0,5),sessionDate:session.session_date,title:module?.title||'Module non renseigné',teacher:fullName(person),room:room?[room.name,room.building].filter(Boolean).join(' · '):'Salle non renseignée',type:({lecture:'Cours',course:'Cours',tutorial:'TD',td:'TD',practical:'TP',tp:'TP',workshop:'Atelier'})[session.session_type]||session.session_type};
    })
  };
}
