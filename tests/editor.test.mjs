import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {editorScript} from './helpers/editor-script.mjs';
import {renderFormattedText,encodeFormattedText} from '../shared/formatted-text.mjs';

const text=value=>({nodeType:3,textContent:value});
const node=(tag,...children)=>({nodeType:1,tagName:tag.toUpperCase(),childNodes:children,getAttribute(){return null}});
function fixture(original='Un programme ouvert aux étudiants.'){
  const handlers=new Map(),commands=[],value={value:original},error={hidden:true,textContent:''},counter={},label={textContent:'Description'},panel={hidden:true},input={value:'',focus(){this.focused=true}};
  panel.querySelector=()=>input;
  const editor={nodeType:1,tagName:'DIV',childNodes:[text(original)],attributes:{},setAttribute(key,value){this.attributes[key]=value},focus(){document.activeElement=this;this.focused=true},contains(target){const visit=parent=>parent===target||(parent.childNodes||[]).some(visit);return visit(this)}};
  const selection={rangeCount:1,anchorNode:editor,focusNode:editor,isCollapsed:false,getRangeAt(){return{commonAncestorContainer:editor,cloneRange(){return this}}},removeAllRanges(){},addRange(){}};
  const field={dataset:{richName:'description',richMin:'20',richMax:'6000'},querySelector(selector){return {'[data-rich-input]':editor,'[data-rich-value]':value,'[data-rich-error]':error,'[data-rich-count]':counter,'.rich-label':label,'.rich-link-panel':panel}[selector]},querySelectorAll(){return[]}};
  const root={querySelectorAll(){return[field]}};field.parentNode=root;
  editor.closest=selector=>selector==='[data-rich-input]'?editor:field;
  const document={activeElement:editor,addEventListener(name,fn){handlers.set(name,fn)},execCommand(command,unused,argument){commands.push({command,argument});editor.childNodes=[node('p',node('b',text('Un programme ouvert aux étudiants.')))]},queryCommandState(){return false},queryCommandValue(){return 'p'}};
  const window={getSelection:()=>selection};vm.runInNewContext(editorScript,{document,window,URL});window.CampusText.mount(root);
  const click=name=>{const control={dataset:{editorCommand:name},closest(selector){return selector==='[data-editor-command]'?this:field}};handlers.get('click')({target:control,preventDefault(){}})};
  return {api:window.CampusText,field,root,editor,value,error,counter,handlers,click,commands,input,panel,selection};
}

test('formatting commands retain the selection and form values contain the edited message',()=>{
  const f=fixture(),original=f.value.value;assert.equal(f.api.values(f.root).description,original);
  f.click('bold');assert.equal(f.commands[0].command,'bold');assert.ok(f.editor.focused);
  const saved=f.api.values(f.root).description;assert.match(renderFormattedText(saved),/<strong>Un programme ouvert aux étudiants\.<\/strong>/);assert.equal(f.value.value,saved);assert.match(f.counter.textContent,/caractères/);
  f.editor.childNodes=[node('p',text('Message modifié après la mise en forme.'))];f.handlers.get('input')({target:f.editor});assert.match(renderFormattedText(f.api.values(f.root).description),/Message modifié après/);
});

test('invalid editor content blocks submission without losing the editable text',()=>{
  const f=fixture();f.editor.childNodes=[node('p',node('b',text('')))];f.handlers.get('input')({target:f.editor});
  assert.throws(()=>f.api.values(f.root),/au moins 20/);assert.equal(f.error.hidden,false);assert.equal(f.editor.attributes['aria-invalid'],'true');assert.equal(f.editor.childNodes[0].childNodes[0].childNodes[0].textContent,'');
  f.editor.childNodes=[text('x'.repeat(6001))];f.handlers.get('input')({target:f.editor});assert.throws(()=>f.api.values(f.root),/trop long/);assert.equal(f.editor.childNodes[0].textContent.length,6001);
});

test('link entry rejects unsafe URLs and accepts a valid link without submitting the surrounding form',()=>{
  const f=fixture();f.click('link');assert.equal(f.panel.hidden,false);
  f.input.value='javascript:alert(1)';f.click('apply-link');assert.equal(f.commands.length,0);assert.equal(f.panel.hidden,false);assert.match(f.error.textContent,/lien/);
  f.input.value='https://example.test/programme';f.click('apply-link');assert.equal(f.commands[0].command,'createLink');assert.equal(f.commands[0].argument,'https://example.test/programme');assert.equal(f.panel.hidden,true);
});

test('rich fields expose accessible controls and preserve stored formatted values on edit',()=>{
  const f=fixture(),stored=encodeFormattedText([['p','Bonjour ',['strong','la communauté étudiante'],'.']]);
  const html=f.api.field({name:'body',label:'Message',value:stored,min:10});
  assert.match(html,/contenteditable="true" role="textbox" aria-multiline="true"/);assert.match(html,/aria-labelledby=/);assert.match(html,/name="body" data-rich-value hidden/);assert.match(html,/<strong>la communauté étudiante<\/strong>/);
  for(const command of ['bold','italic','underline','heading','insertUnorderedList','insertOrderedList','link','undo','redo'])assert.match(html,new RegExp('data-editor-command="'+command+'"'));
  assert.doesNotMatch(html,/id="rich-text-\d+-error"/);assert.match(html,/type="text" inputmode="url"/);
});
