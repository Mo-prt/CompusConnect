import fs from 'node:fs/promises';
import {build} from 'esbuild';
await fs.rm('dist',{recursive:true,force:true});
await fs.mkdir('dist/server',{recursive:true});
await fs.mkdir('dist/.openai',{recursive:true});
const editor=await build({entryPoints:['src/editor.mjs'],bundle:true,write:false,platform:'browser',format:'iife',target:'es2022',minify:true,legalComments:'none'});
await build({
  entryPoints:['worker/index.mjs'],
  bundle:true,
  platform:'browser',
  format:'esm',
  target:'es2022',
  outfile:'dist/server/index.js',
  loader:{'.html':'text','.css':'text','.js':'text','.jpg':'binary'},
  legalComments:'none',
  define:{__CAMPUS_EDITOR_SCRIPT__:JSON.stringify(editor.outputFiles[0].text)},
});
await fs.copyFile('.openai/hosting.json','dist/.openai/hosting.json');
console.log('Built CampusConnect Worker with Supabase PostgreSQL.');
