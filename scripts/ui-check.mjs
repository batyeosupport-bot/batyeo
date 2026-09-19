import {createRequire} from 'node:module';
import {readFileSync,readdirSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {existsSync,statSync,createReadStream} from 'node:fs';
import {extname} from 'node:path';
// Smoke check du portail dans un vrai Chrome, sur une base D1 en mémoire (aucun lien avec .env ni la production). Prérequis : `pnpm build`. Usage : node scripts/ui-check.mjs ; captures et log.json dans $OUT (défaut : dossier temporaire). Le scénario suit les textes de l'interface : à ajuster si elle change.
import {tmpdir} from 'node:os';
const repo=process.cwd(),out=process.env.OUT??tmpdir()+'/batyeo-ui-check';mkdirSync(out,{recursive:true});
const wranglerRequire=createRequire(createRequire(repo+'/package.json').resolve('wrangler'));
const {Miniflare}=wranglerRequire('miniflare');
const files=readdirSync('dist/server',{recursive:true}).filter(f=>f.endsWith('.js'));files.sort((a,b)=>a==='index.js'?-1:b==='index.js'?1:0);
const PORT=8799;
const mf=new Miniflare({modules:files.map(path=>({type:'ESModule',path:repo+'/dist/server/'+path,contents:readFileSync('dist/server/'+path,'utf8')})),modulesRoot:repo+'/dist/server',compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:{DB:'ui-check'},cf:false,host:'127.0.0.1',port:PORT+1});
await mf.ready;
const db=await mf.getD1Database('DB');
for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint').map(x=>x.trim()).filter(Boolean))await db.prepare(sql).run();
const mime={'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json','.woff2':'font/woff2','.woff':'font/woff','.ico':'image/x-icon'};
createServer(async(req,res)=>{const url=new URL(req.url,'http://x');const file=repo+'/dist/client'+decodeURIComponent(url.pathname);
 if(url.pathname!=='/'&&existsSync(file)&&statSync(file).isFile()){res.writeHead(200,{'content-type':mime[extname(file)]??'application/octet-stream'});createReadStream(file).pipe(res);return;}
 const chunks=[];for await(const c of req)chunks.push(c);const body=Buffer.concat(chunks);
 const r=await fetch('http://127.0.0.1:'+(PORT+1)+req.url,{method:req.method,headers:{...req.headers,host:'127.0.0.1:'+(PORT+1),...(req.headers.origin?{origin:'http://127.0.0.1:'+(PORT+1)}:{})},body:['GET','HEAD'].includes(req.method)?undefined:body,redirect:'manual'});
 const headers={};r.headers.forEach((v,k)=>{if(!['content-encoding','content-length','transfer-encoding'].includes(k))headers[k]=v;});
 const sc=r.headers.getSetCookie?.();if(sc?.length)headers['set-cookie']=sc;
 res.writeHead(r.status,headers);res.end(Buffer.from(await r.arrayBuffer()));}).listen(PORT,'127.0.0.1');
const base=`http://127.0.0.1:${PORT}`;
const chrome=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=9333','--user-data-dir='+out+'/profile','--window-size=1400,1000','--no-first-run','--disable-gpu','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let targets;for(let i=0;i<40;i++){try{targets=await (await fetch('http://127.0.0.1:9333/json')).json();if(targets.length)break;}catch{}await sleep(500);}
const page=targets.find(t=>t.type==='page');const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r));
let id=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}});
const send=(method,params={})=>new Promise(res=>{const n=++id;pending.set(n,res);ws.send(JSON.stringify({id:n,method,params}));});
const evalJs=async expr=>{const r=await send('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});return r.result?.result?.value??r.result?.exceptionDetails?.text;};
const go=async(path,wait=3500)=>{await send('Page.navigate',{url:base+path});await sleep(wait);};
const shot=async name=>{const r=await send('Page.captureScreenshot',{format:'png'});writeFileSync(`${out}/${name}.png`,Buffer.from(r.result.data,'base64'));};
const login=async(email,path)=>{await go(path,1500);return evalJs(`fetch('/api/core/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:${JSON.stringify(email)},password:'BatyeoDemo!2026'})}).then(r=>r.status)`);};
const log=[];const step=async(name,fn)=>{try{log.push([name,await fn()]);}catch(e){log.push([name,'ERROR '+e.message]);}};
await send('Page.enable');await send('Runtime.enable');
try{

 const setInput=(sel,val)=>evalJs(`(()=>{const el=[...document.querySelectorAll(${JSON.stringify(sel)})].pop();if(!el)return 'no input '+${JSON.stringify(sel)};Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(val)});el.dispatchEvent(new Event('input',{bubbles:true}));return 'ok';})()`);
 const clickText=t=>evalJs(`(()=>{const b=[...document.querySelectorAll('button')].filter(b=>b.innerText.trim()===${JSON.stringify(t)}&&!b.disabled).pop();if(!b)return 'no button '+${JSON.stringify(t)};b.click();return 'clicked';})()`);
 await step('partner login',()=>login('partner@batyeo.demo','/partner/login'));
 await go('/partner/team');
 await step('open add dialog',()=>clickText('Ajouter un compte'));await sleep(600);
 await step('fill name',()=>setInput('[role=dialog] input[placeholder="Prénom Nom"]','Jean Test'));
 await step('fill email',()=>setInput('[role=dialog] input[type=email]','jean.test@partner.fr'));await sleep(300);
 await shot('partner-team-dialog');
 await step('create account',()=>clickText('Créer le compte'));await sleep(2000);
 await shot('partner-team-created');
 await step('dialog text after create',()=>evalJs('document.querySelector("[role=dialog]")?.innerText'));
 await go('/partner/team');await step('team rows now',()=>evalJs('document.querySelector("main")?.innerText.match(/\\d+ résultats?/)?.[0]'));
 await step('disable jean',()=>evalJs(`(()=>{const row=[...document.querySelectorAll('tr')].find(r=>r.innerText.includes('jean.test@partner.fr'));const b=[...row.querySelectorAll('button')].find(b=>b.innerText.trim()==='Désactiver');b.click();return 'clicked'})()`));await sleep(1500);
 await step('jean status',()=>evalJs(`[...document.querySelectorAll('tr')].find(r=>r.innerText.includes('jean.test@partner.fr'))?.innerText.replace(/\\s+/g,' ')`));await shot('partner-team-disabled');
 await go('/partner/settings');
 await step('pw fill current',()=>setInput('input[autocomplete=current-password]','BatyeoDemo!2026'));
 await step('pw fill new',()=>evalJs(`(()=>{const els=[...document.querySelectorAll('input[autocomplete=new-password]')];const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;for(const el of els){set.call(el,'NouveauSecret!2026');el.dispatchEvent(new Event('input',{bubbles:true}));}return els.length})()`));await sleep(300);
 await step('pw submit',()=>clickText('Changer le mot de passe'));await sleep(1500);
 await shot('partner-settings-after');
 await step('toast text',()=>evalJs('[...document.querySelectorAll("[data-sonner-toast]")].map(t=>t.innerText).join(" | ")'));
 await step('login old pw',()=>evalJs(`fetch('/api/core/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'partner@batyeo.demo',password:'BatyeoDemo!2026'})}).then(r=>r.status)`));
 await step('login new pw',()=>evalJs(`fetch('/api/core/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'partner@batyeo.demo',password:'NouveauSecret!2026'})}).then(r=>r.status)`));
 await go('/partner/display');await step('open media dialog',()=>clickText('Nouveau média'));await sleep(600);await shot('partner-media-dialog');
 await step('media dialog text',()=>evalJs('document.querySelector("[role=dialog]")?.innerText.slice(-500)'));
 await step('admin login',()=>login('admin@batyeo.demo','/admin/login'));
 await go('/admin/system');await shot('admin-system');
 await go('/rent/paris-demo');await shot('rent-paris');await step('rent text',()=>evalJs('document.body.innerText.slice(0,300)'));
}finally{
 writeFileSync(out+'/log.json',JSON.stringify(log,null,1));
 chrome.kill();await mf.dispose();process.exit(0);
}
