const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const cp=require('node:child_process');
const {envParse,mapPath,plist,prepare,backupSnapshot,checkDump,runtimeEnvironment}=require('../tools/mac-migration/helper.cjs');
test('env parser treats shell expressions as data without evaluating them',()=>{
 assert.deepEqual(envParse('A="$(touch /tmp/nope)"\nB=secret=token\n# c'),{A:'$(touch /tmp/nope)',B:'secret=token'});
});
test('stopping launchd removes persistent registration even when no live job remains',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mac-stop-'));const installed=path.join(root,'service.plist');
 const bash=process.platform==='win32'?'C:\\Program Files\\Git\\bin\\bash.exe':'/bin/bash';
 try {
  for(const running of ['0','1']) {
   fs.writeFileSync(installed,'synthetic private registration');
   const script='source "$1"; label() { LABEL=com.bigtuna.test; PLIST="$TEST_PLIST"; }; sudo() { "$@"; }; launchctl() { if [ "$1" = print ]; then [ "$TEST_RUNNING" = 1 ]; else return 0; fi; }; pm2_run() { :; }; stop_all; [ ! -e "$TEST_PLIST" ]';
   cp.execFileSync(bash,['-c',script,'test',path.resolve(__dirname,'../tools/mac-migration/common.sh').replace(/\\/g,'/')],{env:{...process.env,HOME:root.replace(/\\/g,'/'),TEST_PLIST:installed.replace(/\\/g,'/'),TEST_RUNNING:running}});
   assert.equal(fs.existsSync(installed),false);
  }
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('Mac backup preserves hidden secrets/Git, excludes dependencies, validates, and remaps generation roots',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mac-backup-'));const old=path.join(root,'old');const fresh=path.join(root,'fresh');
 try {
  fs.mkdirSync(path.join(old,'SERVER/.git'),{recursive:true});fs.mkdirSync(path.join(old,'SERVER/node_modules/pkg'),{recursive:true});fs.mkdirSync(path.join(old,'APPS'));fs.mkdirSync(path.join(old,'PRIVATE'));
  fs.writeFileSync(path.join(old,'SERVER/.hidden-key'),'secret');fs.writeFileSync(path.join(old,'SERVER/.git/index'),'dirty-git-index');fs.writeFileSync(path.join(old,'SERVER/node_modules/pkg/ignored'),'cache');
  fs.writeFileSync(path.join(old,'manifest.json'),JSON.stringify({roots:[{source:'C:\\SERVER',archivePath:'SERVER'}]}));
  backupSnapshot(old,fresh);
  const manifest=await require('../scripts/migration/validate.cjs').validateDirectory(fresh);
  assert.equal(manifest.consistency,'final-stopped-writers');assert.equal(fs.readFileSync(path.join(fresh,'SERVER/.hidden-key'),'utf8'),'secret');assert.equal(fs.existsSync(path.join(fresh,'SERVER/node_modules')),false);
  assert.equal(mapPath(path.join(old,'SERVER/data'),manifest.roots,fresh),path.join(fresh,'SERVER/data'));
  assert.equal(mapPath('C:\\SERVER\\data',manifest.roots,fresh),path.join(fresh,'SERVER/data'));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('Windows mapping respects root boundary, case, unknown roots and traversal',()=>{
 const roots=[{source:'C:\\SERVER',archivePath:'SERVER'},{source:'C:\\APPS',archivePath:'APPS'}]; const base=path.resolve('destination');
 assert.equal(mapPath('c:\\apps\\Test',roots,base),path.join(base,'APPS','Test'));
 assert.throws(()=>mapPath('C:\\SERVER2\\secret',roots,base));
 assert.throws(()=>mapPath('C:\\SERVER\\..\\..\\outside',roots,base));
});
test('launchd escapes XML values and uses exact Node/PM2 paths owner and timezone',()=>{
 const data=plist({node:'/opt/a & b/node',pm2:'/home/user/pm2',home:'/Users/A&B',owner:'a<b',label:'com.test',log:'/tmp/log'});
 assert.match(data,/a &amp; b/); assert.match(data,/a&lt;b/); assert.match(data,/America\/Halifax/); assert.match(data,/<string>resurrect<\/string>/); assert.match(data,/<key>UserName<\/key>/);
  assert.match(data,/<key>RunAtLoad<\/key><true\/>/);assert.match(data,/<key>KeepAlive<\/key><true\/>/);
  assert.match(data,/<key>PM2_HOME<\/key>/);assert.match(data,/<key>HOME<\/key>/);assert.match(data,/<key>PATH<\/key>/);
});
test('config restore preserves original env/secrets and builds isolated preview/final flags',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'mac-kit-'));
 try {
  fs.mkdirSync(path.join(root,'SERVER/mcp-server'),{recursive:true}); fs.mkdirSync(path.join(root,'SERVER/config'));
  fs.mkdirSync(path.join(root,'PRIVATE/runtime'),{recursive:true});
  fs.writeFileSync(path.join(root,'PRIVATE/runtime/pm2-dump.json'),JSON.stringify([{name:'apps-server',env:{OPENAI_API_KEY:'synthetic-saved-key',ASSIGNMENTS_ACTION_SECRET:'synthetic-saved-action',ANTHROPIC_API_KEY:'synthetic-nested-provider'},ASSIGNMENTS_ACTION_SECRET:'synthetic-direct-action',SECRET:'must-not-import',PATH:'must-not-import',HOMEKIT_BIND_ADDRESS:'192.168.1.2',OLLAMA_LLM_LIBRARY:'cpu',RESEND_API_KEY:'synthetic-direct-mail'}]));
  fs.writeFileSync(path.join(root,'PRIVATE/runtime-environment.json'),JSON.stringify({schemaVersion:1,environment:{OPENAI_API_KEY:'synthetic-captured-key',ASSIGNMENTS_ACTION_SECRET:'synthetic-captured-action',LIGHTS_DEVICE_API_TOKEN:'synthetic-captured-device',RESEND_API_KEY:'synthetic-captured-mail',PATH:'must-not-import',PM2_HOME:'must-not-import'}}));
  fs.writeFileSync(path.join(root,'manifest.json'),JSON.stringify({roots:[{source:'C:\\SERVER',archivePath:'SERVER'},{source:'C:\\APPS',archivePath:'APPS'},{source:'C:\\Users\\user\\.cloudflared',archivePath:'PRIVATE/cloudflared'},{source:'/Users/old/generations/first/SERVER',archivePath:'SERVER'}],consistency:'preliminary'}));
  const raw='SECRET=keep\nRESEND_API_KEY=synthetic-server-mail\nOPAQUE_SECRET=/unmapped/private/value\nBIG_TUNA_DATA_DIR=/Users/old/generations/first/SERVER/data\nHOMEKIT_BIND_ADDRESS=192.168.1.99\nBRIGHTSPACE_USER_DATA_DIR=C:\\SERVER\\data\\browser\nOLLAMA_LLM_LIBRARY=cpu\n'; fs.writeFileSync(path.join(root,'SERVER/server.env'),raw);
  fs.writeFileSync(path.join(root,'SERVER/mcp-server/token.txt'),'existing-token');
  fs.writeFileSync(path.join(root,'SERVER/config/apple-apps.json'),JSON.stringify({apps:[{workspacePath:'C:\\APPS\\Foo'}]}));
  fs.writeFileSync(path.join(root,'SERVER/cloudflared-config.yml'),'credentials-file: C:\\Users\\user\\.cloudflared\\abc.json\ningress:\n  - hostname: ssh.example.com\n    service: ssh://localhost:22\n  - service: http_status:404\n');
  prepare(root,'/node','/Applications/Google Chrome.app/Contents/MacOS/Google Chrome','en0');
  assert.equal(fs.readFileSync(path.join(root,'SERVER/server.env'),'utf8'),raw);
  const staging=JSON.parse(fs.readFileSync(path.join(root,'control/staging.json'))); const prod=JSON.parse(fs.readFileSync(path.join(root,'control/production.json')));
  assert.equal(staging.apps.length,2); assert.equal(staging.apps[0].env.SECRET,'keep'); assert.equal(staging.apps[0].env.BIG_TUNA_STAGING,'1'); assert.equal(staging.apps[0].env.BIG_TUNA_BIND_HOST,'127.0.0.1'); assert.equal(staging.apps[0].env.OLLAMA_LLM_LIBRARY,undefined);
  assert.ok(prod.apps.some(app=>app.name==='bigtuna-tunnel')); assert.equal(prod.apps[0].env.BIG_TUNA_STAGING,'0'); assert.equal(prod.apps[1].env.MCP_SECRET,'existing-token');
  assert.equal(prod.apps[0].env.HOMEKIT_BIND_ADDRESS,undefined);assert.equal(prod.apps[0].env.HOMEKIT_BIND_INTERFACE,'en0');
  assert.equal(prod.apps[0].env.BIG_TUNA_DATA_DIR,path.join(root,'SERVER/data'));assert.equal(prod.apps[0].env.OPAQUE_SECRET,'/unmapped/private/value');
  assert.equal(prod.apps[0].env.PUPPETEER_EXECUTABLE_PATH,'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  assert.equal(prod.apps[0].env.OPENAI_API_KEY,'synthetic-captured-key');assert.equal(prod.apps[0].env.ASSIGNMENTS_ACTION_SECRET,'synthetic-captured-action');
  assert.equal(prod.apps[0].env.RESEND_API_KEY,'synthetic-server-mail');assert.equal(prod.apps[0].env.ANTHROPIC_API_KEY,'synthetic-nested-provider');
  assert.equal(prod.apps[0].env.PATH,undefined);assert.equal(prod.apps[0].env.PM2_HOME,undefined);assert.equal(prod.apps[0].env.SECRET,'keep');
  const fallback=runtimeEnvironment(root);assert.equal(fallback.OPENAI_API_KEY,'synthetic-captured-key');assert.equal(fallback.ASSIGNMENTS_ACTION_SECRET,'synthetic-captured-action');
  const dump=prod.apps.map(app=>({name:app.name,pm_exec_path:app.script,exec_interpreter:app.interpreter,env:app.env}));
  const dumpPath=path.join(root,'dump.pm2');fs.writeFileSync(dumpPath,JSON.stringify(dump));assert.doesNotThrow(()=>checkDump(root,dumpPath));
  dump[0].env.BIG_TUNA_STAGING='1';fs.writeFileSync(dumpPath,JSON.stringify(dump));assert.throws(()=>checkDump(root,dumpPath),/preview/);
  dump.pop();fs.writeFileSync(dumpPath,JSON.stringify(dump));assert.throws(()=>checkDump(root,dumpPath),/process set/);
  assert.doesNotMatch(fs.readFileSync(path.join(root,'control/cloudflared.yml'),'utf8'),/ssh:\/\//);
 } finally {fs.rmSync(root,{recursive:true,force:true});}
});
