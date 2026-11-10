// Full React app + real Express routes. Only the Firebase provider and database are fixtures.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'../..'),modules=path.join(root,'client/node_modules/'),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'attendance-integration-'));
const webpack=require(modules+'webpack'),WebSocket=require(modules+'ws');
const chromeBinary=process.env.CHROME_BIN||['/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome','/opt/google/chrome/chrome'].find(file=>fs.existsSync(file));
if(!chromeBinary)throw Error('Install Chromium/Chrome or set CHROME_BIN before running browser integration checks.');
fs.writeFileSync(tmp+'/firebase.js', `const identity=new URLSearchParams(window.location.search).get('identity')||'hr';const emails={hr:'hr.fixture@shikshavertex.in',newbie:'new.employee@shikshavertex.in',viewer:'hr_pallavi@shikshavertex.in'};export function fixtureUser(){return {uid:identity,email:emails[identity],emailVerified:true,getIdToken:async()=>identity}}export const auth={currentUser:fixtureUser()};export const firebaseConfigured=true;`);
fs.writeFileSync(tmp+'/firebase-auth.js', `import {auth,fixtureUser} from './firebase';let observer=()=>{};export const onAuthStateChanged=(a,cb)=>{observer=cb;queueMicrotask(()=>cb(a.currentUser));return()=>{observer=()=>{}}};export async function signOut(){auth.currentUser=null;observer(null)}export async function signInWithEmailAndPassword(a,email,password){if(email!==fixtureUser().email||!password)throw {code:'auth/invalid-credential'};a.currentUser=fixtureUser();observer(a.currentUser);return {user:a.currentUser}}export const createUserWithEmailAndPassword=signInWithEmailAndPassword;export const reload=async()=>{};export const sendEmailVerification=async()=>{};export const sendPasswordResetEmail=async()=>{};`);
fs.writeFileSync(tmp+'/entry.jsx', `import React from 'react';import {createRoot} from 'react-dom/client';import App from '${root}/client/src/App';createRoot(document.getElementById('root')).render(<App/>);`);
function compile(){return new Promise((resolve,reject)=>webpack({mode:'development',devtool:false,entry:tmp+'/entry.jsx',output:{path:tmp+'/dist',filename:'app.js'},resolve:{modules:[root+'/client/node_modules','node_modules']},module:{rules:[{test:/\.[jt]sx?$/,exclude:/node_modules/,use:{loader:require.resolve(modules+'babel-loader'),options:{presets:[[require.resolve(modules+'@babel/preset-react'),{runtime:'automatic'}]]}}},{test:/\.css$/,use:[require.resolve(modules+'style-loader'),require.resolve(modules+'css-loader')]}]},plugins:[new webpack.DefinePlugin({'process.env.REACT_APP_API_URL':JSON.stringify('/api')}),new webpack.NormalModuleReplacementPlugin(/^\.\/firebase$/,tmp+'/firebase.js'),new webpack.NormalModuleReplacementPlugin(/^firebase\/auth$/,tmp+'/firebase-auth.js')]},(err,stats)=>err||stats.hasErrors()?reject(err||Error(stats.toString({all:false,errors:true}))):resolve()))}


const {createApp}=require(root+'/server/app'),{loadConfig}=require(root+'/server/config'),{createFakeFirestore}=require(root+'/server/test/fake-firestore'),express=require(root+'/server/node_modules/express'),{indiaDate}=require(root+'/server/security');
const date=indiaDate(Date.now()),past=indiaDate(Date.now()-86400000),config=loadConfig({HR_ADMIN_EMAIL:'',DEVICE_COOKIE_SECRET:'full-app-fixture-'.repeat(4)});
// This test exercises setup-mode orchestration, not a phone's real passkey/GPS/SSID.
config.biometrics.required=false;
// Hardware is never simulated by product code: only this fixture submits synthetic native evidence.
const emails={hr:'hr.fixture@shikshavertex.in',newbie:'new.employee@shikshavertex.in',viewer:'hr_pallavi@shikshavertex.in'};
const db=createFakeFirestore({['AllowedEmails/'+emails.hr]:{enabled:true,uid:'hr'},'Users/hr':{email:emails.hr,fullName:'HR Fixture'},'Employees/SV001':{fullName:'New Employee',designation:'Operations Executive',department:'Operations',team:'Campus',active:true}});
const tokens={hr:{uid:'hr',email:emails.hr,email_verified:true,committee:true},newbie:{uid:'newbie',email:emails.newbie,email_verified:true},viewer:{uid:'viewer',email:emails.viewer,email_verified:true}};
const app=createApp({db,config,auth:{verifyIdToken:async(token,revoked)=>{if(!revoked||!tokens[token])throw Error('Bad fixture identity');return {...tokens[token]}},getUser:async uid=>({uid,email:emails[uid],emailVerified:true,customClaims:{}}),getUsers:async ids=>({users:ids.map(({uid})=>({uid,email:emails[uid],emailVerified:true})),notFound:[]})}});
app.use(express.static(tmp+'/dist'));app.get('/fonts/inter.ttf',(_,res)=>res.sendFile(root+'/client/public/fonts/inter.ttf'));app.get('/',(_,res)=>res.send('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>@font-face{font-family:Inter;src:url(/fonts/inter.ttf)}#fixture{position:fixed;top:0;left:0;right:0;z-index:10000;background:#1e1b4b;color:white;font:12px Inter;padding:8px;text-align:center}</style></head><body><div id="fixture">Integration fixture · Sample data · Full React app + in-memory Express backend · Firebase provider simulated</div><div id="root"></div><script src="/app.js"></script></body></html>'));
let server,chrome,ws,id=0, session;const pending=new Map();
const send=(method,params={},sess=session)=>new Promise((resolve,reject)=>{const request=++id;pending.set(request,{resolve,reject});ws.send(JSON.stringify({id:request,method,params,...(sess?{sessionId:sess}:{})}));});
const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result.value;};
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function until(expression){for(let i=0;i<75;i++){if(await evaluate(`Boolean(${expression})`))return;await delay(200)}throw Error('Timed out waiting for '+expression)}
(async()=>{try{
 await compile();server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const devtools=new Promise((resolve,reject)=>{chrome=spawn(chromeBinary,['--headless=new','--no-sandbox','--disable-gpu','--disable-background-networking','--no-first-run','--remote-debugging-port=0','--user-data-dir='+tmp+'/profile-'+process.pid],{stdio:['ignore','ignore','pipe']});let err='';const timeout=setTimeout(()=>reject(Error('Chrome startup timeout: '+err.slice(-500))),20000);chrome.stderr.on('data',d=>{err+=d;const m=err.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timeout);resolve(m[1])}});});
 ws=new WebSocket(await devtools);await new Promise(r=>ws.once('open',r));ws.on('message',data=>{const m=JSON.parse(data);if(m.id&&pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result)}});
 const target=await send('Target.createTarget',{url:'about:blank'},null);session=(await send('Target.attachToTarget',{targetId:target.targetId,flatten:true},null)).sessionId;
 await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});






 async function assert(expression,message){if(!await evaluate(`Boolean(${expression})`))throw Error(message)}
 async function value(selector,val){await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing field '+${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(e.tagName==='SELECT'?HTMLSelectElement.prototype:e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(val)});e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));})()`)}
 async function click(text,scope='document'){await evaluate(`[...${scope}.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`)}
 async function open(identity){const context=(await send('Target.createBrowserContext',{},null)).browserContextId;const target=await send('Target.createTarget',{url:'about:blank',browserContextId:context},null);session=(await send('Target.attachToTarget',{targetId:target.targetId,flatten:true},null)).sessionId;await send('Page.enable');await send('Runtime.enable');await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});await send('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/?identity='+identity});return session}
 async function shot(name){if(!process.env.INTEGRATION_SCREENSHOTS)return;const folder=path.resolve(root,process.env.INTEGRATION_SCREENSHOTS);fs.mkdirSync(folder,{recursive:true});const r=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});fs.writeFileSync(path.join(folder,'workspace-integration-'+name+'.png'),Buffer.from(r.data,'base64'))}
 async function mobile(name){await send('Emulation.setDeviceMetricsOverride',{width:360,height:900,deviceScaleFactor:1,mobile:true});await evaluate('window.scrollTo(0,0)');await assert('document.documentElement.scrollWidth<=360','Full '+name+' workspace overflows at 360px');await shot(name+'-mobile');await send('Emulation.setDeviceMetricsOverride',{width:1440,height:1100,deviceScaleFactor:1,mobile:false});}
 const hr=await open('hr');await until(`document.querySelector('#hr-controls') && document.querySelector('#employee-search') && document.querySelector('#attendance-search')`);
 const emailFile=tmp+'/employee-emails.json';
 fs.writeFileSync(emailFile,JSON.stringify({employees:[{employeeId:'SV001',fullName:require(root+'/server/employees.json')[0].fullName,email:emails.newbie}]}));
 await evaluate(`document.querySelector('.email-import summary').click()`);
 const documentNode=await send('DOM.getDocument');
 const fileInput=await send('DOM.querySelector',{nodeId:documentNode.root.nodeId,selector:'#employee-email-file'});
 await send('DOM.setFileInputFiles',{nodeId:fileInput.nodeId,files:[emailFile]});
 await until(`document.querySelector('.email-import').innerText.includes('Ready to import 1 employee emails.')`);
 await assert(`![...document.querySelectorAll('.email-import button')].some(button=>!button.disabled)`,'Import must require explicit HR confirmation');
 await evaluate(`document.querySelector('.email-import input[type=checkbox]').click()`);await click('Save registration emails');
 await until(`document.querySelector('.email-import').innerText.includes('1 registration emails saved')`);
 if(db.dump()['Employees/SV001'].registrationEmail!==emails.newbie||db.dump()['AllowedEmails/'+emails.newbie])throw Error('Private email import changed permissions or failed to save metadata');
 await until(`document.querySelector('.employee-directory').innerText.includes('Official registration email; login not linked')`);
 await value('#attendance-search','New Employee');await click('Create attendance event');await value('#command-event-title','Daily employee attendance');await value('#command-event-date',date);await click('Create event');await until(`!!document.querySelector('[aria-label="Open check-in for Daily employee attendance"]')`);
 await until(`document.querySelector('#attendance-event option[value]:not([value=""])')`);await assert(`document.querySelector('#attendance-search').value==='New Employee'`,'HR event refresh lost report filters');
 const eventId=Object.entries(db.dump()).find(([key])=>key.startsWith('Events/'))[0].split('/')[1];
 await evaluate(`document.querySelector('[aria-label="Open check-in for Daily employee attendance"]').click()`);await until(`!!document.querySelector('[aria-label="Close check-in for Daily employee attendance"]')`);
 const employee=await open('newbie');await until(`document.body.innerText.includes('Employee access approval')`);await value('#employee-name','New Employee');await click('Request HR approval');await until(`document.body.innerText.includes('Your request is with HR')`);
 session=hr;await click('Refresh directory & requests');await until(`!!document.querySelector('#employee-newbie')`);await value('#employee-newbie','SV001');await evaluate(`document.querySelector('#employee-newbie').closest('article').querySelector('input[type=checkbox]').click()`);await click('Approve employee');await until(`!document.querySelector('#employee-newbie') && document.querySelector('.attendance-dashboard .report-table tbody')?.innerText.includes('New Employee')`);
 await assert(`document.querySelector('#attendance-search').value==='New Employee' && [...document.querySelector('#report-member').options].some(o=>o.value==='newbie')`,'Approval did not refresh reporting cohort/HR movement member choices');
 session=employee;await click('Check approval status');await until(`document.querySelector('#my-check-in #event option[value="${eventId}"]')`);
 await assert(`document.querySelector('#my-check-in button[type=submit]').disabled`,'Browser check-in must remain unavailable without native connection observation');
 await assert(`!/temporary setup mode|wi-fi|room.?code/i.test(document.body.innerText)`,'Obsolete prerequisite wording remains visible');
 async function nativeFixture(path,identity,body){
  const point={latitude:config.venue.latitude,longitude:config.venue.longitude,accuracyMeters:5,capturedAt:Date.now()};
  const wifi={transport:'wifi',ssid:'Shikshavertex_5G',observedAt:Date.now()};
  return evaluate(`fetch('/api'+${JSON.stringify(path)},{method:'POST',credentials:'include',headers:{'Content-Type':'application/json',Authorization:'Bearer '+${JSON.stringify(identity)}},body:JSON.stringify(${JSON.stringify({location:point,wifi,...body})})}).then(async r=>({status:r.status,data:await r.json()}))`);
 }
 const rejected=await nativeFixture('/attendance','newbie',{eventId,location:{latitude:13.1,longitude:77.6,accuracyMeters:5,capturedAt:Date.now()}});
 if(rejected.status!==403)throw Error('Offsite native fixture was not rejected');
 const marked=await nativeFixture('/attendance','newbie',{eventId});
 if(marked.status!==200||!marked.data.attendance?.locationVerified)throw Error('Matching native venue fixture failed: '+JSON.stringify(marked));
 await click('Refresh my attendance');await until(`document.querySelector('#my-history tbody')?.innerText.includes('Daily employee attendance')`);
 await assert(`!document.querySelector('#event option[value="${eventId}"]')`,'Confirmed receipt did not prevent a duplicate');await shot('employee');await mobile('employee');
 session=hr;await click('Refresh attendance records');await until(`document.querySelector('.attendance-dashboard tbody')?.innerText.includes('Marked')`);
 await assert(`[...document.querySelectorAll('button')].find(b=>b.textContent==='Committee attendance override').disabled`,'Browser HR could bypass attendance requirements');
 const duplicate=await nativeFixture('/attendance/manual','hr',{eventId,email:emails.newbie,reason:'Duplicate must preserve original self check-in'});
 if(duplicate.status!==200||duplicate.data.alreadyMarked!==true)throw Error('Duplicate native fixture override changed the original');
 const firstLogs=Object.values(db.dump()).filter(row=>row.uid==='newbie'&&row.eventId===eventId);if(firstLogs.length!==1||firstLogs[0].method!=='self')throw Error('HR duplicate replaced the employee receipt');
 const override=await nativeFixture('/attendance/manual','hr',{eventId,email:emails.hr,reason:'Identity confirmed for fixture manual attendance'});
 if(override.status!==200)throw Error('Native operator fixture could not record audited override');
 await evaluate(`document.querySelector('[aria-label="Refresh attendance sessions"]').click()`);await until(`document.querySelector('[aria-label="Manual attendance override audit"]')?.innerText.includes('Administrator UID: hr')`);
 await assert(`document.querySelector('#attendance-search').value==='New Employee'`,'Attendance refresh reset report filters');await shot('hr');await mobile('hr');
 await value('#report-date',past);await value('#report-member','newbie');await click('Load daily report');await until(`document.querySelector('.movement-panel .report-results')`);await assert(`document.querySelector('.movement-panel').innerText.includes('10h 0m') && document.querySelector('.movement-panel').innerText.includes('No confirmed movement observations')`,'Movement no-evidence snapshot invented time');
 const viewer=await open('viewer');await until(`document.querySelector('.attendance-dashboard tbody')?.innerText.includes('New Employee')`);await assert(`!document.querySelector('#my-check-in') && !document.querySelector('#hr-controls') && !document.querySelector('#hr-directory') && !document.querySelector('#movement-report') && document.body.innerText.includes('Attendance viewer')`,'Viewer-only scope leaked employee/HR/movement controls');await shot('viewer');await mobile('viewer');
 await db.collection('AttendanceViewers').doc(emails.viewer).set({enabled:false},{merge:true});await click('Refresh attendance records');await until(`document.querySelector('.attendance-dashboard [role=alert]') && !document.querySelector('.attendance-dashboard tbody')`);await assert(`!document.querySelector('.range-export')`,'Viewer revocation kept CSV controls');
 session=employee;await click('Sign out');await until(`document.body.innerText.includes('Sign in to check in')`);await assert(`document.body.innerText.includes('This browser was first registered to') && !document.querySelector('#my-history')`,'Sign-out lost browser binding or retained personal history');
 console.log('Full-app integration passed: private HR file import with explicit confirmation and no login grant, workspace opens without a location gate, browser check-in blocked, offsite native fixture rejected, matching location/connection fixture accepted, real API/session cookies, unapproved request -> explicit HR profile approval -> employee check-in -> personal history, shared report/session/member-list refresh with filters preserved, immutable duplicate override, saved manual audit, empty movement evidence, viewer-only controls/revocation and sign-out binding. Firebase Auth is a local provider fixture; biometrics are disabled only in this in-memory test, and native location/connection evidence is synthetic. This does not validate physical phone sensors. No real emails, Firebase or employee records changed.');
}catch(e){console.error(e.stack||e);if(ws&&session)try{console.error('Fixture page:',await evaluate('document.body.innerText.slice(0,5000)'))}catch{}process.exitCode=1}finally{if(ws)ws.close();if(chrome)chrome.kill('SIGTERM');if(server){server.close();server.closeAllConnections();}}})();
