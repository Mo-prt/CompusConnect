import fs from 'node:fs/promises';
import {build} from 'esbuild';
await fs.mkdir('dist/server',{recursive:true});
await fs.mkdir('dist/.openai',{recursive:true});
await build({
  entryPoints:['worker/index.mjs'],
  bundle:true,
  platform:'browser',
  format:'esm',
  target:'es2022',
  outfile:'dist/server/index.js',
  loader:{'.html':'text','.css':'text','.js':'text'},
  legalComments:'none',
});
await fs.copyFile('.openai/hosting.json','dist/.openai/hosting.json');
await fs.cp('drizzle','dist/drizzle',{recursive:true});
console.log('Built CampusConnect Worker with D1 and Supabase adapters.');
