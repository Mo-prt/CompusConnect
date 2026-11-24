import {encodeFormattedText,formattedTextPlain,renderFormattedText,validateFormattedText,formattedNodesFromDOM,safeTextLink} from '../shared/formatted-text.mjs';

const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const states=new WeakMap();let sequence=0;
const button=(command,label,content=label,toggle=false)=>`<button type="button" data-editor-command="${command}" title="${label}" aria-label="${label}" ${toggle?'aria-pressed="false"':''}>${content}</button>`;
export function field({name,label,value='',min=10,max=6000}){
  const id='rich-text-'+(++sequence);
  return `<div class="rich-field span2" data-rich-field data-rich-name="${esc(name)}" data-rich-min="${min}" data-rich-max="${max}"><span class="rich-label" id="${id}-label">${esc(label)}</span><div class="rich-editor"><div class="rich-toolbar" role="group" aria-label="Mise en forme du texte">${button('bold','Gras (Ctrl+B)','<b>G</b>',true)}${button('italic','Italique (Ctrl+I)','<i>I</i>',true)}${button('underline','Souligné (Ctrl+U)','<u>S</u>',true)}${button('heading','Titre de paragraphe','Titre',true)}<span class="rich-toolbar-separator" aria-hidden="true"></span>${button('insertUnorderedList','Liste à puces','• Liste',true)}${button('insertOrderedList','Liste numérotée','1. Liste',true)}${button('link','Insérer un lien','Lien')}<span class="rich-toolbar-separator" aria-hidden="true"></span>${button('undo','Annuler la dernière modification','Annuler')}${button('redo','Rétablir la dernière modification','Rétablir')}</div><div class="rich-link-panel" hidden><label>Adresse du lien<input type="text" inputmode="url" data-editor-url placeholder="https://exemple.ma" aria-label="Adresse du lien"></label><div>${button('apply-link','Appliquer le lien','Appliquer')}${button('unlink','Retirer le lien','Retirer le lien')}${button('cancel-link','Fermer le choix du lien','Fermer')}</div></div><div class="rich-editable formatted-content" contenteditable="true" role="textbox" aria-multiline="true" aria-labelledby="${id}-label" aria-describedby="${id}-help ${id}-feedback" data-rich-input spellcheck="true">${renderFormattedText(value)}</div></div><textarea name="${esc(name)}" data-rich-value hidden>${esc(value)}</textarea><div class="rich-footer"><span id="${id}-help">Sélectionnez du texte pour le mettre en forme.</span><span data-rich-count></span></div><p class="rich-error" id="${id}-feedback" data-rich-error role="alert" hidden></p></div>`;
}
function elements(field){return {editor:field.querySelector('[data-rich-input]'),value:field.querySelector('[data-rich-value]'),error:field.querySelector('[data-rich-error]'),count:field.querySelector('[data-rich-count]'),panel:field.querySelector('.rich-link-panel')}}
export function mount(root=document){
  for(const field of root?.querySelectorAll?.('[data-rich-field]')||[]){
    if(states.has(field))continue;
    const {value,count}=elements(field);states.set(field,{original:value.value,dirty:false,range:null});
    count.textContent=formattedTextPlain(value.value).length+' caractères';
  }
}
function remember(field){
  const selection=window.getSelection?.(),{editor}=elements(field),state=states.get(field);
  if(state&&selection?.rangeCount&&editor.contains(selection.anchorNode)&&editor.contains(selection.focusNode))state.range=selection.getRangeAt(0).cloneRange();
}
function restore(field){
  const {editor}=elements(field),state=states.get(field);editor.focus();
  if(state?.range&&editor.contains(state.range.commonAncestorContainer)){
    const selection=window.getSelection();selection.removeAllRanges();selection.addRange(state.range);
  }
}
function errorMessage(field,message){const {editor,error}=elements(field);error.textContent=message;error.hidden=!message;editor.setAttribute('aria-invalid',String(!!message))}
function update(field,validate=false){
  const {editor,value,count}=elements(field),state=states.get(field);
  try{
    const encoded=state?.dirty?encodeFormattedText(formattedNodesFromDOM(editor)):state?.original||'';
    count.textContent=formattedTextPlain(encoded).length+' caractères';
    if(validate||encoded.length>Number(field.dataset.richMax))validateFormattedText(encoded,{min:Number(field.dataset.richMin),max:Number(field.dataset.richMax),label:field.querySelector('.rich-label').textContent});
    value.value=encoded;errorMessage(field,'');return encoded;
  }catch(error){errorMessage(field,error.message);if(validate){editor.focus();throw error}return null}
}
export function values(form){
  mount(form);const result=Object.create(null);
  for(const field of form?.querySelectorAll?.('[data-rich-field]')||[])result[field.dataset.richName]=update(field,true);
  return result;
}
function pressed(field){
  for(const control of field.querySelectorAll('[aria-pressed]')){
    let active=false;try{active=control.dataset.editorCommand==='heading'?/h3/i.test(document.queryCommandValue('formatBlock')):document.queryCommandState(control.dataset.editorCommand)}catch{}
    control.setAttribute('aria-pressed',String(active));
  }
}
function execute(field,command,value){
  restore(field);
  if(typeof document.execCommand!=='function'){errorMessage(field,'Cette mise en forme n’est pas disponible dans votre navigateur.');return}
  document.execCommand(command,false,value);states.get(field).dirty=true;remember(field);update(field);pressed(field);
}
function closeLink(field){elements(field).panel.hidden=true;restore(field)}
function command(field,name){
  mount(field.parentNode);
  if(name==='link'){
    remember(field);const {panel}=elements(field);panel.hidden=false;
    const input=panel.querySelector('[data-editor-url]'),selection=window.getSelection?.(),anchor=selection?.anchorNode?.parentElement?.closest('a');
    input.value=anchor&&elements(field).editor.contains(anchor)?anchor.getAttribute('href'):'';input.focus();return;
  }
  if(name==='cancel-link'){closeLink(field);return}
  if(name==='apply-link'){
    const {panel}=elements(field),input=panel.querySelector('[data-editor-url]'),href=safeTextLink(input.value.trim());
    if(!href){errorMessage(field,'Utilisez un lien http://, https:// ou une adresse mailto: valide.');input.focus();return}
    restore(field);
    if(window.getSelection()?.isCollapsed)execute(field,'insertHTML',`<a href="${esc(href)}">${esc(href)}</a>`);
    else execute(field,'createLink',href);
    closeLink(field);return;
  }
  if(name==='unlink'){execute(field,'unlink');closeLink(field);return}
  if(name==='heading'){
    restore(field);let heading=false;try{heading=/h3/i.test(document.queryCommandValue('formatBlock'))}catch{}
    execute(field,'formatBlock',heading?'p':'h3');return;
  }
  if(['bold','italic','underline','insertUnorderedList','insertOrderedList','undo','redo'].includes(name))execute(field,name);
}
document.addEventListener('mousedown',event=>{
  const control=event.target.closest?.('[data-editor-command]');if(!control)return;
  const field=control.closest('[data-rich-field]');if(field){remember(field);event.preventDefault()}
});
document.addEventListener('click',event=>{
  const control=event.target.closest?.('[data-editor-command]');if(!control)return;
  event.preventDefault();command(control.closest('[data-rich-field]'),control.dataset.editorCommand);
});
document.addEventListener('input',event=>{
  const editor=event.target.closest?.('[data-rich-input]');if(!editor)return;
  const field=editor.closest('[data-rich-field]');mount(field.parentNode);states.get(field).dirty=true;update(field);remember(field);
});
document.addEventListener('selectionchange',()=>{
  const field=document.activeElement?.closest?.('[data-rich-field]');if(field){remember(field);pressed(field)}
});
document.addEventListener('keydown',event=>{
  const field=event.target.closest?.('[data-rich-field]');if(!field)return;
  if(!elements(field).panel.hidden&&(event.key==='Escape'||event.key==='Enter')){
    event.preventDefault();event.stopImmediatePropagation();command(field,event.key==='Escape'?'cancel-link':'apply-link');return;
  }
  if((event.ctrlKey||event.metaKey)&&!event.altKey&&['b','i','u'].includes(event.key.toLowerCase())&&event.target.closest('[data-rich-input]')){
    event.preventDefault();command(field,{b:'bold',i:'italic',u:'underline'}[event.key.toLowerCase()]);
  }
},true);
function insertTransfer(event,transfer){
  const editor=event.target.closest?.('[data-rich-input]');if(!editor)return;
  event.preventDefault();const field=editor.closest('[data-rich-field]');mount(field.parentNode);remember(field);
  const html=transfer?.getData('text/html'),text=transfer?.getData('text/plain')||'';
  try{
    let clean=esc(text).replace(/\r?\n/g,'<br>');
    if(html){const template=document.createElement('template');template.innerHTML=html;clean=renderFormattedText(encodeFormattedText(formattedNodesFromDOM(template.content)))}
    if(clean)execute(field,'insertHTML',clean);
  }catch{errorMessage(field,'Ce contenu est trop complexe. Collez le texte sans mise en forme avec Ctrl+Maj+V.')}
}
document.addEventListener('paste',event=>insertTransfer(event,event.clipboardData));
document.addEventListener('drop',event=>insertTransfer(event,event.dataTransfer));
window.CampusText={field,mount,values,render:renderFormattedText,plain:formattedTextPlain};
