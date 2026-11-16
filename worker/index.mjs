import {handleApi} from './api.mjs';
import html from '../src/index.html';
import css from '../src/style.css';
import js from '../src/app.js';
import mine from '../src/assets/khouribga-mine.png';
import experience from '../src/experience.js';
import theme from '../src/experience.css';

export default {
  async fetch(request,env) {
    const path=new URL(request.url).pathname;
    if(path.startsWith('/api/')) return handleApi(request,env);
    if(path==='/assets/khouribga-mine.png')return new Response(mine,{headers:{'Content-Type':'image/png','Cache-Control':'public, max-age=86400','X-Content-Type-Options':'nosniff'}});
    const type=['/app.js','/experience.js'].includes(path)?'application/javascript':path==='/style.css'?'text/css':'text/html';
    return new Response(path==='/experience.js'?experience:path==='/app.js'?js:path==='/style.css'?css+'\n'+theme:html,{headers:{
      'Content-Type':type+'; charset=utf-8',
      'X-Content-Type-Options':'nosniff',
      'Referrer-Policy':'strict-origin-when-cross-origin',
      'Content-Security-Policy':"default-src 'self'; img-src 'self' data: https://images.unsplash.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com",
    }});
  },
};
