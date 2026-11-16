import {handleApi} from './api.mjs';
import html from '../src/index.html';
import css from '../src/style.css';
import js from '../src/app.js';
import campusPhoto from '../src/assets/fpk-campus.jpg';
import experience from '../src/experience.js';
import theme from '../src/experience.css';

export default {
  async fetch(request,env) {
    const path=new URL(request.url).pathname;
    if(path.startsWith('/api/')) return handleApi(request,env);
    if(path==='/assets/fpk-campus.jpg')return new Response(campusPhoto,{headers:{'Content-Type':'image/jpeg','Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff'}});
    if(path.startsWith('/assets/'))return new Response('Ressource introuvable.',{status:404,headers:{'Content-Type':'text/plain; charset=utf-8'}});
    const type=['/app.js','/experience.js'].includes(path)?'application/javascript':path==='/style.css'?'text/css':'text/html';
    return new Response(path==='/experience.js'?experience:path==='/app.js'?js:path==='/style.css'?css+'\n'+theme:html,{headers:{
      'Content-Type':type+'; charset=utf-8',
      'X-Content-Type-Options':'nosniff',
      'Referrer-Policy':'strict-origin-when-cross-origin',
      'Content-Security-Policy':"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com",
    }});
  },
};
