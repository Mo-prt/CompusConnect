// Versioned, compact text nodes. Stored HTML is never interpreted as markup.
export const richTextPrefix='CCRT1\n';
const tags=new Set(['p','h3','ul','ol','li','strong','em','u','a','br']);
const escape=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const invalid=()=>{throw new Error('La mise en forme du texte est invalide.');};

export function safeTextLink(value){
  if(typeof value!=='string'||value.length>2000||/[\u0000-\u0020\u007f]/.test(value)||!/^(https?:\/\/|mailto:)/i.test(value))return null;
  try{
    const url=new URL(value);
    if(url.username||url.password)return null;
    if(url.protocol==='mailto:')return /^[^\s@]+@[^\s@]+$/.test(url.pathname)?url.href:null;
    return ['https:','http:'].includes(url.protocol)&&url.hostname?url.href:null;
  }catch{return null}
}

function normalize(nodes){
  if(!Array.isArray(nodes))invalid();
  let count=0;
  const visit=(node,depth)=>{
    if(++count>1500||depth>12)invalid();
    if(typeof node==='string')return node;
    if(!Array.isArray(node)||!tags.has(node[0]))invalid();
    const [tag,...rest]=node;
    if(tag==='br'){if(rest.length)invalid();return ['br']}
    if(tag==='a'){
      const href=safeTextLink(rest.shift());if(!href)invalid();
      return ['a',href,...rest.map(child=>visit(child,depth+1))];
    }
    return [tag,...rest.map(child=>visit(child,depth+1))];
  };
  return nodes.map(node=>visit(node,0));
}

export function encodeFormattedText(nodes){return richTextPrefix+JSON.stringify(normalize(nodes))}
function decode(value){
  if(typeof value!=='string'||!value.startsWith(richTextPrefix))return null;
  if(value.length>12000)invalid();
  try{return normalize(JSON.parse(value.slice(richTextPrefix.length)))}catch{invalid()}
}
function nodeText(node){
  if(typeof node==='string')return node;
  const [tag,...rest]=node;
  if(tag==='br')return '\n';
  if(tag==='a')return rest.slice(1).map(nodeText).join('');
  if(tag==='ul'||tag==='ol')return rest.map((child,index)=>(tag==='ol'?(index+1)+'. ':'• ')+nodeText(child).trim()).join('\n')+'\n';
  return rest.map(nodeText).join('')+(['p','h3','li'].includes(tag)?'\n':'');
}
export function formattedTextPlain(value){
  value=String(value??'');
  try{const nodes=decode(value);return nodes?nodes.map(nodeText).join('').replace(/\n{3,}/g,'\n\n').trim():value}catch{return value}
}
export function renderFormattedText(value){
  value=String(value??'');
  let nodes;try{nodes=decode(value)}catch{/* Malformed legacy records stay inert. */}
  if(!nodes)return value.split(/\n{2,}/).map(text=>'<p>'+escape(text).replace(/\r?\n/g,'<br>')+'</p>').join('');
  const html=node=>{
    if(typeof node==='string')return escape(node);
    const [tag,...rest]=node;
    if(tag==='br')return '<br>';
    if(tag==='a')return '<a href="'+escape(rest[0])+'" target="_blank" rel="noopener noreferrer">'+rest.slice(1).map(html).join('')+'</a>';
    return '<'+tag+'>'+rest.map(html).join('')+'</'+tag+'>';
  };
  return nodes.map(html).join('');
}
export function validateFormattedText(value,{min=10,max=6000,label='texte'}={}){
  if(typeof value!=='string')throw new Error('Vérifiez le champ « '+label+' ».');
  value=value.trim();
  if(value.length>max)throw new Error('Le champ « '+label+' » est trop long. Réduisez le texte ou sa mise en forme.');
  // Validate the visible message, so empty formatting cannot bypass minimum length.
  const visible=node=>typeof node==='string'?node:node[0]==='br'?'\n':node.slice(node[0]==='a'?2:1).map(visible).join('')+(['p','h3','li'].includes(node[0])?'\n':'');
  const nodes=decode(value),plain=nodes?nodes.map(visible).join('').trim():value;
  if(plain.length<min)throw new Error('Le champ « '+label+' » doit contenir au moins '+min+' caractères.');
  const normalized=nodes?encodeFormattedText(nodes):value;
  if(normalized.length>max)throw new Error('Le champ « '+label+' » est trop long. Réduisez le texte ou sa mise en forme.');
  return normalized;
}

// This accepts only DOM text and the formatting above, never HTML attributes or CSS.
export function formattedNodesFromDOM(root){
  const read=node=>{
    if(node.nodeType===3)return [String(node.textContent||'').replace(/\u00a0/g,' ')];
    if(node.nodeType!==1&&node!==root)return [];
    const tag=String(node.tagName||'').toLowerCase();
    if(['script','style','iframe','object','embed','svg','math','template','noscript','img','video','audio'].includes(tag))return [];
    let children=Array.from(node.childNodes||[]).flatMap(read);
    if(node===root)return children;
    const mapped={div:'p',b:'strong',i:'em',h1:'h3',h2:'h3',h4:'h3',h5:'h3',h6:'h3'}[tag]||tag;
    if(mapped==='a'){
      const href=safeTextLink(node.getAttribute('href'));
      return href?[['a',href,...children]]:children;
    }
    if(tags.has(mapped))return [[mapped,...(mapped==='br'?[]:children)]];
    if(tag==='span'||tag==='font'){
      if(node.style?.fontWeight==='bold'||Number(node.style?.fontWeight)>=600)children=[['strong',...children]];
      if(node.style?.fontStyle==='italic')children=[['em',...children]];
      if(/underline/.test(node.style?.textDecoration||node.style?.textDecorationLine||''))children=[['u',...children]];
    }
    return children;
  };
  return normalize(read(root));
}
