'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
function envParse(raw) {
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const i = line.indexOf('='); if (i < 1) continue;
    const key = line.slice(0,i).trim(); let v = line.slice(i+1).trim();
    if (!/^[A-Z_][A-Z0-9_]*$/i.test(key)) throw Error('Invalid env key');
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v=v.slice(1,-1);
    out[key]=v;
  } return out;
}
function allowedRuntimeKey(key) {
  return /^(?:OPENAI_|ANTHROPIC_|RESEND_|ASSIGNMENTS_|STRAVA_|CHALLENGE_|APNS_|LIGHTS_|LAMP_|HOMEKIT_|OLLAMA_|APPLE_APP_FACTORY_|BRIGHTSPACE_|BIG_TUNA_)[A-Z0-9_]*$/.test(key) || ['PUBLIC_BASE_URL','MCP_SECRET'].includes(key);
}
function runtimeEnvironment(target) {
  const env={};
  function readPrivateJson(file) {try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw Error('Cannot parse private runtime configuration; inspect it locally without sharing credentials');}}
  function merge(source) {
    if(!source||typeof source!=='object'||Array.isArray(source))return;
    for(const [key,value] of Object.entries(source))if(allowedRuntimeKey(key)&&['string','number','boolean'].includes(typeof value))env[key]=String(value);
  }
  const dumpFile=path.join(target,'PRIVATE/runtime/pm2-dump.json');
  if(fs.existsSync(dumpFile)) {
    const dump=readPrivateJson(dumpFile);
    if(!Array.isArray(dump))throw Error('Unsupported saved runtime dump');
    const app=dump.find(item=>item.name==='apps-server'||item.pm2_env?.name==='apps-server');
    if(app) {const saved=app.pm2_env||app;merge(saved.env);merge(saved);}
  }
  const capturedFile=path.join(target,'PRIVATE/runtime-environment.json');
  if(fs.existsSync(capturedFile)) {
    const captured=readPrivateJson(capturedFile);
    if(captured.schemaVersion!==1||!captured.environment||typeof captured.environment!=='object'||Array.isArray(captured.environment))throw Error('Unsupported captured runtime environment');
    merge(captured.environment);
  }
  return env;
}
function mapPath(v, roots, target) {
  if (!/^[A-Za-z]:[\\/]/.test(v) && !path.isAbsolute(v)) return v;
  const normal=v.replace(/\\/g,'/');
  for (const r of [...roots].sort((a,b)=>b.source.length-a.source.length)) {
    const prefix=r.source.replace(/\\/g,'/').replace(/\/$/,'');
    const windows=/^[A-Za-z]:/.test(prefix); const candidate=windows?normal.toLowerCase():normal; const match=windows?prefix.toLowerCase():prefix;
    if (candidate===match || candidate.startsWith(match+'/')) {
      const suffix=normal.slice(prefix.length).replace(/^\//,'');
      const mapped=path.resolve(target,r.archivePath,suffix);
      if (!mapped.startsWith(path.resolve(target)+path.sep)) throw Error('Mapped path escaped generation');
      return mapped;
    }
  } throw Error('Windows configuration path was not exported; inspect original configuration privately');
}
function xml(v) { return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c])); }
function plist({node,pm2,home,owner,label,log}) {
  return `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${xml(label)}</string><key>UserName</key><string>${xml(owner)}</string><key>ProgramArguments</key><array>${[node,pm2,'resurrect','--no-daemon'].map(v=>'<string>'+xml(v)+'</string>').join('')}</array><key>EnvironmentVariables</key><dict><key>HOME</key><string>${xml(home)}</string><key>PM2_HOME</key><string>${xml(path.join(home,'BigTuna/control/pm2'))}</string><key>TZ</key><string>America/Halifax</string><key>PATH</key><string>${xml(path.dirname(node))}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>StandardOutPath</key><string>${xml(log)}</string><key>StandardErrorPath</key><string>${xml(log)}</string></dict></plist>`;
}
function write(file,data) { fs.writeFileSync(file,data,{mode:0o600}); }
function prepare(target,node,chromium,ethernet) {
  const manifest=JSON.parse(fs.readFileSync(path.join(target,'manifest.json'),'utf8'));
  const server=path.join(target,'SERVER'); const control=path.join(target,'control'); fs.mkdirSync(control,{mode:0o700});
  const raw=fs.readFileSync(path.join(server,'server.env'),'utf8'); const env={...runtimeEnvironment(target),...envParse(raw)};
  const pathKeys=new Set(['BIG_TUNA_DATA_DIR','BRIGHTSPACE_USER_DATA_DIR','APPLE_APP_FACTORY_RELEASE_ROOT','APPLE_APP_FACTORY_DEPLOY_ROOT','APPLE_APP_FACTORY_DEPLOY_SSH_KEY_PATH','MCP_ROOT','BIG_TUNA_ROOT','BIG_TUNA_TERMINAL_CWD','PUPPETEER_EXECUTABLE_PATH']);
  for(const k of Object.keys(env)) {
    if (pathKeys.has(k) && (/^[A-Za-z]:[\\/]/.test(env[k]) || path.isAbsolute(env[k]))) env[k]=mapPath(env[k],manifest.roots,target);
  }
  // No shell ever sources server.env. Preserve the original; launch configs carry translations.
  delete env.OLLAMA_LLM_LIBRARY; delete env.OLLAMA_NUM_GPU;
  delete env.HOMEKIT_BIND_ADDRESS;
  Object.assign(env,{TZ:'America/Halifax',MCP_ROOT:server,BIG_TUNA_ROOT:server,BIG_TUNA_TERMINAL_CWD:server,PUPPETEER_EXECUTABLE_PATH:chromium,HOMEKIT_BIND_INTERFACE:ethernet});
  env.MCP_SECRET=fs.readFileSync(path.join(server,'mcp-server/token.txt'),'utf8').trim();
  const registryFile=path.join(server,'config/apple-apps.json');
  if(fs.existsSync(registryFile)) { const registry=JSON.parse(fs.readFileSync(registryFile)); for(const app of registry.apps) app.workspacePath=mapPath(app.workspacePath,manifest.roots,target); write(path.join(control,'apple-apps.original.json'),fs.readFileSync(registryFile)); write(registryFile,JSON.stringify(registry,null,2)+'\n'); }
  // Only translate actual browser profile path fields, never arbitrary user content.
  const configFile=path.join(server,'data/assignments/config.json');
  if(fs.existsSync(configFile)) { const cfg=JSON.parse(fs.readFileSync(configFile)); if(cfg.profileDir) { write(path.join(control,'assignments.original.json'),fs.readFileSync(configFile)); cfg.profileDir=mapPath(cfg.profileDir,manifest.roots,target); write(configFile,JSON.stringify(cfg,null,2)); } }
  const cloud=fs.readFileSync(path.join(server,'cloudflared-config.yml'),'utf8');
  const translated=cloud.replace(/^credentials-file:\s*(.+)$/m,(_,v)=>'credentials-file: '+JSON.stringify(mapPath(v.trim().replace(/^['"]|['"]$/g,''),manifest.roots,target)));
  // macOS SSH stays a deliberate owner step; do not expose an unconfigured remote login.
  const safeCloud=translated.replace(/\n\s*- hostname: ssh\.[^\n]+\n\s*service: ssh:\/\/localhost:22\s*/,'\n');
  write(path.join(control,'cloudflared.yml'),safeCloud);
  write(path.join(control,'cloudflared-with-ssh.yml'),translated);
  for(const staging of [true,false]) {
    const mode=staging?'staging':'production'; const runEnv={...env,BIG_TUNA_STAGING:staging?'1':'0',BIG_TUNA_BIND_HOST:staging?'127.0.0.1':'0.0.0.0'};
    const apps=[{name:'bigtuna-web',script:path.join(server,'server.js'),cwd:server,interpreter:node,env:runEnv,autorestart:true},{name:'bigtuna-mcp',script:path.join(server,'mcp-server/server.js'),cwd:path.join(server,'mcp-server'),interpreter:node,env:runEnv,autorestart:true}];
    if(!staging) {
      apps.push({name:'bigtuna-tunnel',script:'/opt/homebrew/bin/cloudflared',interpreter:'none',args:['--config',path.join(control,'cloudflared.yml'),'tunnel','run'],cwd:server,env:{TZ:'America/Halifax'},autorestart:true});
      if(fs.existsSync('/opt/homebrew/bin/ollama')) apps.push({name:'bigtuna-ollama',script:'/opt/homebrew/bin/ollama',interpreter:'none',args:['serve'],cwd:server,env:{HOME:osHome(),OLLAMA_HOST:'127.0.0.1:11434',TZ:'America/Halifax'},autorestart:true});
    }
    write(path.join(control,mode+'.json'),JSON.stringify({apps},null,2));
  }
  write(path.join(control,'restore-receipt.json'),JSON.stringify({schemaVersion:1,consistency:manifest.consistency,createdAt:manifest.createdAt,restoredAt:new Date().toISOString(),target},null,2));
}
function osHome() { return require('node:os').homedir(); }
function checkDump(target,dumpFile) {
  const expected=JSON.parse(fs.readFileSync(path.join(target,'control/production.json'))).apps;
  const saved=JSON.parse(fs.readFileSync(dumpFile));
  if(!Array.isArray(saved)||saved.length!==expected.length)throw Error('Persisted PM2 process set does not match production');
  for(const app of expected) {
    const entry=saved.find(item=>item.name===app.name);
    if(!entry||path.resolve(entry.pm_exec_path)!==path.resolve(app.script))throw Error('Persisted PM2 script does not match production');
    if(app.env.BIG_TUNA_STAGING==='0' && (entry.env||entry).BIG_TUNA_STAGING!=='0')throw Error('Persisted process has preview settings');
    if(app.interpreter!=='none'&&entry.exec_interpreter!==app.interpreter)throw Error('Persisted Node interpreter does not match installed path');
  }
  console.log('Saved PM2 boot snapshot contains all configured production services');
}
function backupSnapshot(source,target) {
  fs.mkdirSync(target,{mode:0o700});
  const previous=JSON.parse(fs.readFileSync(path.join(source,'manifest.json')));
  const manifest={schemaVersion:1,createdAt:new Date().toISOString(),consistency:'final-stopped-writers',roots:[...previous.roots],files:[],directories:[],exclusions:[]};
  const directories=new Map();const originals=new Map();
  function fileHash(file) {
    const hash=require('node:crypto').createHash('sha256');const fd=fs.openSync(file,'r');const chunk=Buffer.alloc(1024*1024);
    try {let count;while((count=fs.readSync(fd,chunk,0,chunk.length,null))>0)hash.update(chunk.subarray(0,count));}finally{fs.closeSync(fd);}
    return hash.digest('hex');
  }
  function sameStat(a,b) {return a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs&&a.ino===b.ino&&a.dev===b.dev&&a.mode===b.mode;}
  directories.set(source,{children:fs.readdirSync(source).sort(),stat:fs.lstatSync(source)});
  const originalManifest=path.join(source,'manifest.json');originals.set(originalManifest,{stat:fs.lstatSync(originalManifest),hash:fileHash(originalManifest)});
  for(const name of ['SERVER','APPS','PRIVATE']) {
    if(!fs.existsSync(path.join(source,name))) continue;
    manifest.roots.push({source:path.join(source,name),archivePath:name});
    function copy(relative) {
      const from=path.join(source,relative); const to=path.join(target,relative); const s=fs.lstatSync(from);
      if(s.isSymbolicLink()) throw Error('Backup refuses symlinks outside excluded dependency/cache folders');
      if(s.isDirectory()) {
        if(['node_modules','.cache','logs'].includes(path.basename(from))) {manifest.exclusions.push({source:from,reason:'rebuildable dependency/cache/log directory'});return;}
        fs.mkdirSync(to,{mode:0o700});manifest.directories.push(relative.replace(/\\/g,'/'));
        const children=fs.readdirSync(from).sort();directories.set(from,{children,stat:s});
        for(const child of children) copy(path.join(relative,child));
      } else if(s.isFile()) {
        const beforeHash=fileHash(from);
        fs.copyFileSync(from,to);fs.chmodSync(to,s.mode&0o700);
        const copiedHash=fileHash(to);const after=fs.lstatSync(from);const afterHash=fileHash(from);
        if(!sameStat(s,after)||beforeHash!==copiedHash||afterHash!==copiedHash)throw Error('Backup source changed during copy; close all writers and retry');
        originals.set(from,{stat:after,hash:copiedHash});
        manifest.files.push({path:relative.replace(/\\/g,'/'),size:s.size,sha256:copiedHash,source:from});
      } else throw Error('Backup refuses special files');
    } copy(name);
  }
  // Revisit the complete source after copying, detecting later writes/deletions/additions.
  for(const [file,original] of originals) {
    const stat=fs.lstatSync(file);if(!stat.isFile()||!sameStat(original.stat,stat)||fileHash(file)!==original.hash)throw Error('Backup source changed after copy; close all writers and retry');
  }
  for(const [dir,original] of directories) {
    const stat=fs.lstatSync(dir);
    if(!stat.isDirectory()||!sameStat(original.stat,stat)||JSON.stringify(fs.readdirSync(dir).sort())!==JSON.stringify(original.children))throw Error('Backup source directory changed; close all writers and retry');
  }
  write(path.join(target,'manifest.json'),JSON.stringify(manifest,null,2));
}
async function verify(target,node,pm2) {
  const snapshot=()=>JSON.parse(cp.execFileSync(node,[pm2,'jlist'],{encoding:'utf8',maxBuffer:20*1024*1024}));
  const first=snapshot();await new Promise(r=>setTimeout(r,3000)); const second=snapshot();
  const production=fs.existsSync(path.join(osHome(),'BigTuna/control/active'));
  const expectedApps=JSON.parse(fs.readFileSync(path.join(target,'control',production?'production.json':'staging.json'))).apps;
  for(const app of expectedApps) {
    const name=app.name;
    const before=first.find(p=>p.name===name);const after=second.find(p=>p.name===name);
    if(!before||!after||after.pm2_env.status!=='online'||before.pm2_env.restart_time!==after.pm2_env.restart_time) throw Error('Web/MCP not stable online; inspect private PM2 logs');
    const expected=path.resolve(app.script);
    if(path.resolve(after.pm2_env.pm_exec_path)!==expected) throw Error('PM2 process points to a different generation');
  }
  const discovery=await fetch('http://127.0.0.1:3001/mcp',{signal:AbortSignal.timeout(10000)});const info=await discovery.json();
  if(!discovery.ok||info.protocol!=='mcp')throw Error('MCP discovery failed');
  const token=fs.readFileSync(path.join(target,'SERVER/mcp-server/token.txt'),'utf8').trim();
  const result=await fetch('http://127.0.0.1:3001/mcp',{signal:AbortSignal.timeout(10000),method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json, text/event-stream'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'migration-verify',version:'1'}}})});
  const body=await result.text();
  if(!result.ok||!body.includes('protocolVersion')||body.includes('"error"'))throw Error('Authenticated MCP initialization failed');
  const sid=result.headers.get('mcp-session-id');
  if(sid) await fetch('http://127.0.0.1:3001/mcp',{signal:AbortSignal.timeout(10000),method:'DELETE',headers:{Authorization:'Bearer '+token,'mcp-session-id':sid}});
  console.log('Web/MCP generation, stable PM2 and authenticated MCP checks passed');
}
if(require.main===module) {
  try { const [action,...args]=process.argv.slice(2);
    if(action==='prepare') prepare(...args);
    else if(action==='snapshot') backupSnapshot(...args);
    else if(action==='check-dump') checkDump(...args);
    else if(action==='verify') verify(...args).catch(()=>{console.error('Web/MCP verification failed; inspect private PM2 logs without sharing secrets');process.exitCode=1;});
    else if(action==='final') { const r=JSON.parse(fs.readFileSync(path.join(args[0],'control/restore-receipt.json'))); if(r.consistency!=='final-stopped-writers') throw Error('Activation requires a final stopped-writers export, restored into a new generation'); }
    else if(action==='plist') write(args[0],plist(JSON.parse(fs.readFileSync(args[1]))));
    else throw Error('Unknown helper operation');
  } catch(e) { console.error(e.message); process.exitCode=1; }
}
module.exports={envParse,mapPath,xml,plist,prepare,backupSnapshot,checkDump,runtimeEnvironment};
