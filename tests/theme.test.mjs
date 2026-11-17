import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';

const source=await fs.readFile(new URL('../src/theme.js',import.meta.url),'utf8');
function fixture({saved,blocked=false}={}){
  const root={dataset:{},style:{}},values=new Map(saved===undefined?[]:[['campusconnect-theme',saved]]),events=new Map(),buttons=[];
  const meta={setAttribute(name,value){this[name]=value}};
  const document={documentElement:root,querySelector:()=>meta,querySelectorAll:()=>buttons};
  const window={localStorage:{getItem(key){if(blocked)throw Error('Storage unavailable');return values.get(key)??null},setItem(key,value){if(blocked)throw Error('Storage unavailable');values.set(key,value)}},addEventListener(name,fn){events.set(name,fn)}};
  const ctx=vm.createContext({document,window});vm.runInContext(source,ctx);
  return{theme:window.CampusTheme,root,values,events,buttons,meta};
}
test('dark mode is the default and a valid saved light preference is restored before rendering',()=>{
  for(const [saved,expected] of [[undefined,'dark'],['light','light'],['dark','dark'],['invalid','dark']]){
    const {theme,root,meta}=fixture({saved});assert.equal(theme.current(),expected);assert.equal(root.dataset.theme,expected);assert.equal(root.style.colorScheme,expected);assert.equal(meta.content,expected==='dark'?'#101b20':'#fbf7f0');
    assert.match(theme.button(),expected==='dark'?/Activer le mode clair/:/Activer le mode sombre/);assert.match(theme.button(),/type="button"/);
  }
});
test('switching themes updates existing controls in place and persists the preference for the next visit',()=>{
  const {theme,root,values,buttons}=fixture();
  const button={setAttribute(name,value){this[name]=value}},another={setAttribute(name,value){this[name]=value}};buttons.push(button,another);
  theme.toggle();assert.equal(root.dataset.theme,'light');assert.equal(values.get('campusconnect-theme'),'light');
  for(const control of buttons){assert.equal(control['aria-label'],'Activer le mode sombre');assert.equal(control.title,'Activer le mode sombre');assert.match(control.innerHTML,/<svg/)}
  assert.equal(fixture({saved:values.get('campusconnect-theme')}).theme.current(),'light');
  theme.toggle();assert.equal(root.dataset.theme,'dark');assert.equal(button['aria-label'],'Activer le mode clair');assert.equal(values.get('campusconnect-theme'),'dark');
});
test('theme controls still work when the browser refuses local storage',()=>{
  const {theme,root}=fixture({saved:'light',blocked:true});assert.equal(theme.current(),'dark');assert.doesNotThrow(()=>theme.toggle());assert.equal(root.dataset.theme,'light');
});
test('changes in another tab synchronize the theme and unrelated storage events are ignored',()=>{
  const {theme,events,values}=fixture(),onStorage=events.get('storage');
  onStorage({key:'unrelated',newValue:'light'});assert.equal(theme.current(),'dark');
  onStorage({key:'campusconnect-theme',newValue:'light'});assert.equal(theme.current(),'light');assert.equal(values.size,0);
  onStorage({key:'campusconnect-theme',newValue:'untrusted-value'});assert.equal(theme.current(),'dark');
  theme.toggle();onStorage({key:null,newValue:null});assert.equal(theme.current(),'dark');
});
test('theme initialization loads before styles and deferred application scripts',async()=>{
  const html=await fs.readFile(new URL('../src/index.html',import.meta.url),'utf8');
  assert.match(html,/<html[^>]*data-theme="dark"/);
  const script=html.indexOf('<script src="/theme.js"></script>');assert.ok(script>0);assert.ok(script<html.indexOf('href="/style.css"'));assert.ok(script<html.indexOf('src="/app.js"'));
});
