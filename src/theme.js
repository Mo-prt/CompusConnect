/* Applied before styles and app rendering so the saved theme is visible immediately. */
(()=>{
  const key='campusconnect-theme',root=document.documentElement;
  let current='dark';
  const valid=value=>value==='dark'||value==='light';
  const label=()=>current==='dark'?'Activer le mode clair':'Activer le mode sombre';
  const icon=()=>`<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${current==='dark'?'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>':'<path d="M20.7 13A9 9 0 0 1 11 3.3 9 9 0 1 0 20.7 13Z"/>'}</svg>`;
  const content=()=>icon()+`<span class="sr-only">${label()}</span>`;
  function apply(value,persist=false){
    current=valid(value)?value:'dark';root.dataset.theme=current;root.style.colorScheme=current;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',current==='dark'?'#101b20':'#fbf7f0');
    document.querySelectorAll('[data-action="toggle-theme"]').forEach(button=>{
      button.innerHTML=content();button.setAttribute('aria-label',label());button.setAttribute('title',label());
    });
    if(persist){try{window.localStorage.setItem(key,current)}catch{/* Browsing with storage disabled still supports theme switching. */}}
  }
  let saved;try{saved=window.localStorage.getItem(key)}catch{}
  apply(saved);
  window.CampusTheme={
    current:()=>current,
    toggle:()=>apply(current==='dark'?'light':'dark',true),
    button:()=>`<button type="button" class="theme-toggle" data-action="toggle-theme" aria-label="${label()}" title="${label()}">${content()}</button>`
  };
  window.addEventListener('storage',event=>{if(event.key===key||event.key===null)apply(event.newValue)});
})();
