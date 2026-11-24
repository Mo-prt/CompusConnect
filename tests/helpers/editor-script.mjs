import {build} from 'esbuild';
const result=await build({entryPoints:[new URL('../../src/editor.mjs',import.meta.url).pathname],bundle:true,write:false,platform:'browser',format:'iife',target:'es2022'});
export const editorScript=result.outputFiles[0].text;
