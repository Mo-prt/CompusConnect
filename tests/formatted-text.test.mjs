import {test} from 'node:test';
import assert from 'node:assert/strict';
import {richTextPrefix,encodeFormattedText,renderFormattedText,formattedTextPlain,validateFormattedText,safeTextLink,formattedNodesFromDOM} from '../shared/formatted-text.mjs';

test('formatted messages retain headings, emphasis, lists and safe links without interpreting user HTML',()=>{
  const value=encodeFormattedText([['h3','Programme de la journée'],['p','Bonjour ',['strong','tout le monde'],', ',['em','bienvenue'],' ! ',['u','À lire']],['ol',['li','Apporter un ordinateur'],['li',['a','https://example.test/inscription?a=1&b=2','Inscription']]],['p','<img src=x onerror=alert(1)>']]);
  assert.equal(validateFormattedText(value,{min:20}),value);
  const html=renderFormattedText(value);assert.match(html,/<strong>tout le monde<\/strong>/);assert.match(html,/<em>bienvenue<\/em>/);assert.match(html,/<u>À lire<\/u>/);assert.match(html,/<ol><li>/);assert.match(html,/rel="noopener noreferrer"/);assert.match(html,/a=1&amp;b=2/);assert.doesNotMatch(html,/<img/);
  const plain=formattedTextPlain(value);assert.match(plain,/Bonjour tout le monde, bienvenue/);assert.match(plain,/1\. Apporter un ordinateur/);assert.ok(!plain.includes(richTextPrefix));
  const old='Message original\navec un retour.\n\n<b>Texte littéral</b>';
  assert.equal(formattedTextPlain(old),old);assert.equal(validateFormattedText(old),old);assert.match(renderFormattedText(old),/original<br>avec/);assert.match(renderFormattedText(old),/&lt;b&gt;Texte littéral/);
});

test('empty formatting, malformed trees, excessive nesting and oversized messages are rejected before saving',()=>{
  for(const nodes of [[['p',['strong','']]], [['ul',...Array.from({length:20},()=>['li',''])]], [['p','court']]])assert.throws(()=>validateFormattedText(encodeFormattedText(nodes)),/caractères/);
  for(const raw of ['{bad json}',JSON.stringify([['script','alert(1)']]),JSON.stringify([{tag:'p',html:'<img>'}]),JSON.stringify([['br','hidden text']]),JSON.stringify([['a','javascript:alert(1)','un lien']])]){
    const value=richTextPrefix+raw;assert.throws(()=>validateFormattedText(value),/invalide/);assert.doesNotMatch(renderFormattedText(value),/<script|<img|<a href/);
  }
  let deep='texte';for(let i=0;i<15;i++)deep=['strong',deep];assert.throws(()=>encodeFormattedText([deep]),/invalide/);
  assert.throws(()=>validateFormattedText('x'.repeat(6001)),/trop long/);
  assert.throws(()=>validateFormattedText(encodeFormattedText([['p','x'.repeat(5990)]])),/trop long/);
  const base=richTextPrefix+JSON.stringify([['p',''],['a','https://é.test','un lien']]);
  const unicodeURL=richTextPrefix+JSON.stringify([['p','x'.repeat(5998-base.length)],['a','https://é.test','un lien']]);
  assert.throws(()=>validateFormattedText(unicodeURL),/trop long/);
});

test('links cannot execute scripts, use protocol-relative URLs, hidden controls or credentials',()=>{
  for(const url of ['javascript:alert(1)','JAVASCRIPT:alert(1)','java\nscript:alert(1)','data:text/html,hello','//example.test','https://user:password@example.test','https://example.test\u0000.bad','javascript&#58;alert(1)','https://','mailto:'])assert.equal(safeTextLink(url),null,url);
  assert.equal(safeTextLink('https://example.test'), 'https://example.test/');assert.equal(safeTextLink('mailto:contact@usms.ac.ma'),'mailto:contact@usms.ac.ma');
});

const text=value=>({nodeType:3,textContent:value});
const element=(tag,children=[],attributes={},style={})=>({nodeType:1,tagName:tag.toUpperCase(),childNodes:children,style,getAttribute:key=>attributes[key]??null});
test('editor serialization discards pasted scripts, images, event handlers and arbitrary styles',()=>{
  const root=element('div',[
    element('p',[text('Bonjour '),element('b',[text('la classe')],{onclick:'alert(1)'})]),
    element('script',[text('alert(1)')]),element('img',[],{src:'evil',onerror:'alert(1)'}),
    element('span',[text('Important')],{}, {fontWeight:'700',fontStyle:'italic',backgroundImage:'url(evil)'}),
    element('a',[text('Mauvais lien')],{href:'javascript:alert(1)'}),
    element('a',[text('Page du campus')],{href:'https://example.test'})
  ]);
  const encoded=encodeFormattedText(formattedNodesFromDOM(root)),html=renderFormattedText(encoded);
  assert.match(html,/<strong>la classe<\/strong>/);assert.match(html,/<em><strong>Important<\/strong><\/em>/);assert.match(html,/Mauvais lien/);assert.match(html,/<a href="https:\/\/example.test\/"/);
  assert.doesNotMatch(encoded,/onclick|onerror|javascript|backgroundImage|alert\(1\)/);assert.doesNotMatch(html,/<img|<script|style=/);
});
