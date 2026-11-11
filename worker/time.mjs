const partsFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Casablanca',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
export function moroccoParts(value) {
  const p=Object.fromEntries(partsFormatter.formatToParts(new Date(value)).map(x=>[x.type,x.value]));
  return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`};
}
/** Resolve the date-specific Casablanca offset, including Ramadan changes. */
export function moroccoInstant(date,time) {
  const desired=Date.parse(`${date}T${time}:00Z`);
  let instant=desired;
  for(let i=0;i<4;i++){
    const p=moroccoParts(instant),shown=Date.parse(`${p.date}T${p.time}:00Z`);
    const delta=desired-shown;if(!delta)break;instant+=delta;
  }
  const shown=moroccoParts(instant);
  if(shown.date!==date||shown.time!==time)throw new Error('Heure locale invalide.');
  return new Date(instant).toISOString();
}
