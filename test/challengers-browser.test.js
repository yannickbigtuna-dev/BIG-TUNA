'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { before, after, test } = require('node:test');
const puppeteer = require('puppeteer');
const QRCode = require('qrcode');
const ROOT = path.join(__dirname, '..', 'apps');
const TOKEN = 'a'.repeat(43);
let server, browser, base, fixture;
const user = { id: 'fixture-user', username: 'runner' };
const challenge = { id: 'challenge_fixture', name: 'Autumn miles', template: 'weekly', participants: [{userId:user.id,role:'owner'}], rules: {cadence:{type:'weekly'}}, currentScore:{[user.id]:4} };
function reset() { fixture = {accepted:0,invites:0,revoked:0,previewStatus:200,acceptStatus:200,registrations:0}; }
function reply(res, status, data, type='application/json') { res.writeHead(status, {'Content-Type':type}); res.end(typeof data==='string'?data:JSON.stringify(data)); }
async function handler(req,res) {
  const url = new URL(req.url, 'http://fixture');
  if (url.pathname === '/topbar.js') return reply(res,200,'const Topbar = {identify(){},setTitle(){}};','text/javascript');
  if (url.pathname === '/api/auth/me') return reply(res,req.headers.authorization==='Bearer valid'?200:401,user);
  if (['/api/auth/login','/api/auth/register'].includes(url.pathname)) {
    if(url.pathname.endsWith('register')) fixture.registrations++;
    return reply(res,200,{...user,token:'valid'});
  }
  if (url.pathname === '/api/challenge-invites/preview') return reply(res,fixture.previewStatus,fixture.previewStatus===200?{challengeId:challenge.id,name:challenge.name,participantCount:1,expiresAt:'2099-10-01T12:00:00.000Z'}:{error:'Invite unavailable'});
  if (url.pathname === '/api/challenge-invites/accept') {
    if(fixture.acceptStatus!==200)return reply(res,fixture.acceptStatus,{error:'Sign in again'});
    fixture.accepted++; return reply(res,200,{challenge,alreadyMember:false});
  }
  if (url.pathname === '/api/challenges') return reply(res,200,{challenges:[challenge]});
  if (url.pathname === '/api/challenges/challenge_fixture') return reply(res,200,challenge);
  if (url.pathname === '/api/challenges/challenge_fixture/invites') {
    if(req.method==='DELETE'){fixture.revoked++;return reply(res,200,{revoked:true});}
    fixture.invites++; return reply(res,201,{token:TOKEN,url:`https://yannickmorgans.ca/challenge-invite/#token=${TOKEN}`,expiresAt:'2099-10-01T12:00:00.000Z',qrDataURL:await QRCode.toDataURL('https://yannickmorgans.ca/challenge-invite/#token='+TOKEN)});
  }
  if(req.method==='GET' && ['/auth.js','/styles/tokens.css','/challenge-invite/','/challenge-invite/invite.js','/challengers/','/challengers/challengers.js'].includes(url.pathname)) {
    const file=path.join(ROOT,url.pathname.replace(/^\//,'')+(url.pathname.endsWith('/')?'index.html':''));
    const body=fs.readFileSync(file,'utf8').replace(/^\s*@import[^\r\n]*\r?\n/gm,'');
    return reply(res,200,body,file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');
  }
  reply(res,404,{error:'Not found'});
}
before(async()=>{fs.mkdirSync(path.join(ROOT,'..','artifacts'),{recursive:true});server=http.createServer((req,res)=>handler(req,res).catch(error=>reply(res,500,{error:error.message})));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`;browser=await puppeteer.launch({headless:true,args:['--no-sandbox']});});
after(async()=>{await browser?.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
async function pageFor(url, signedIn=false) {
  reset(); const page=await browser.newPage(); page.setDefaultTimeout(8000); await page.setViewport({width:375,height:812});
  await page.evaluateOnNewDocument(() => { localStorage.clear(); });
  if(signedIn) await page.evaluateOnNewDocument(value=>{localStorage.setItem('auth_token','valid');localStorage.setItem('auth_user',JSON.stringify(value));},user);
  await page.goto(base+url); return page;
}
async function login(page,register=false) {
  await page.waitForSelector('#auth-username');
  if(register)await page.click('#auth-toggle-link');
  await page.type('#auth-username','runner');await page.type('#auth-password','test-password');await page.click('#auth-submit');
  await page.waitForSelector('#auth-modal-overlay',{hidden:true});
}
for(const register of [false,true]) test(`guest ${register?'registers':'logs in'} with shared Auth and explicitly joins after reload`,async()=>{
  const page=await pageFor(`/challenge-invite/#token=${TOKEN}`);
  try{
    await page.waitForFunction(()=>document.querySelector('#invite-name').textContent==='Autumn miles');
    assert.equal(await page.evaluate(()=>location.hash),'');
    await page.reload();await page.waitForSelector('#invite-actions button');
    await page.click('#invite-actions button');await login(page,register);
    await page.waitForSelector('#join-btn');assert.equal(fixture.accepted,0);
    await page.click('#join-btn');await page.waitForFunction(()=>document.querySelector('#invite-status').textContent.includes('You joined'));
    assert.equal(fixture.accepted,1);assert.equal(fixture.registrations,register?1:0);
    assert.equal(await page.evaluate(()=>sessionStorage.getItem('challengers_pending_invite')),null);
  }finally{await page.close();}
});
test('declining clears pending intent without membership mutation',async()=>{
  const page=await pageFor(`/challenge-invite/#token=${TOKEN}`,true);
  try{await page.waitForSelector('#later-btn');await page.click('#later-btn');assert.equal(fixture.accepted,0);assert.equal(await page.evaluate(()=>sessionStorage.getItem('challengers_pending_invite')),null);}
  finally{await page.close();}
});
test('invalid fresh fragment does not reuse a previous invitation',async()=>{
  const page=await pageFor(`/challenge-invite/#token=${TOKEN}`);
  try{await page.waitForFunction(()=>!location.hash);await page.goto(base+'/challenge-invite/#token=invalid');await page.waitForFunction(()=>document.querySelector('#invite-name').textContent==='Invitation link missing');assert.equal(await page.evaluate(()=>sessionStorage.getItem('challengers_pending_invite')),null);}
  finally{await page.close();}
});
test('preview transport failure is retryable and narrow layout fits',async()=>{
  const page=await pageFor('/challenge-invite/');
  try{fixture.previewStatus=503;await page.goto(`${base}/challenge-invite/#token=${TOKEN}`);await page.waitForFunction(()=>document.querySelector('#invite-actions button')?.textContent==='Try again');fixture.previewStatus=200;await page.click('#invite-actions button');await page.waitForFunction(()=>document.querySelector('#invite-name').textContent==='Autumn miles');await page.setViewport({width:320,height:700});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  finally{await page.close();}
});
test('expired session returns to shared login without automatic acceptance',async()=>{
  const page=await pageFor(`/challenge-invite/#token=${TOKEN}`,true);
  try{await page.waitForSelector('#join-btn');fixture.acceptStatus=401;await page.click('#join-btn');await login(page);fixture.acceptStatus=200;assert.equal(fixture.accepted,0);await page.click('#join-btn');await page.waitForFunction(()=>document.querySelector('#invite-status').textContent.includes('You joined'));assert.equal(fixture.accepted,1);}
  finally{await page.close();}
});
test('manager deliberately generates QR/link and can revoke after reopening',async()=>{
  const page=await pageFor('/challengers/',true);
  try{await page.waitForSelector('.challenge');await page.click('.challenge');await page.waitForSelector('#detail:not([hidden]) .btn');await page.click('#detail .btn');assert.equal(fixture.invites,0);await page.click('#generate-link');await page.waitForFunction(()=>document.querySelector('#share-url').textContent.startsWith('https://'));assert.equal(fixture.invites,1);assert.equal(await page.$eval('#share-qr',el=>el.hidden),false);await page.screenshot({path:path.join(ROOT,'..','artifacts','challengers-share-mobile.png')});await page.click('#share-dialog [data-close]');await page.click('#detail .btn');await page.click('#revoke-link');await page.waitForFunction(()=>document.querySelector('#share-status').textContent==='Invitation revoked.');assert.equal(fixture.revoked,1);assert.equal(await page.$eval('#share-url',el=>el.textContent),'');}
  finally{await page.close();}
});
