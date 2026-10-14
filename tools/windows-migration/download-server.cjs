'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
function selectFiles(root) {
  const files = new Map([['BigTuna-Mac-Migration.zip', path.join(root, 'BigTuna-Mac-Migration.zip')]]);
  const final = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory() && !e.isSymbolicLink() && /^Final-\d{8}-\d{6}$/.test(e.name))
    .map(e => e.name).sort().reverse().find(name => {
      try { return JSON.parse(fs.readFileSync(path.join(root,name,'inventory.json'),'utf8')).consistency==='final-stopped-writers' && fs.existsSync(path.join(root,name,'migration.btm')); }
      catch { return false; }
    });
  if (final) files.set('final-migration.btm',path.join(root,final,'migration.btm'));
  return files;
}
function createDownloadServer(root, token = crypto.randomBytes(24).toString('hex')) {
  const realRoot=fs.realpathSync(root);
  const server = http.createServer((req,res) => {
    const prefix='/'+token+'/';
    if(req.method!=='GET' || !req.url.startsWith(prefix)) { res.writeHead(404);res.end();return; }
    const name=req.url.slice(prefix.length);
    const file=selectFiles(realRoot).get(name);
    if(!file) {res.writeHead(404);res.end();return;}
    let stat;
    try { stat=fs.lstatSync(file); if(!stat.isFile() || stat.isSymbolicLink() || !fs.realpathSync(file).startsWith(realRoot+path.sep)) throw Error('Unsafe file'); }
    catch {res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':'application/octet-stream','Content-Length':stat.size,'Content-Disposition':'attachment; filename="'+name+'"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    const stream=fs.createReadStream(file); stream.on('error',()=>res.destroy());stream.pipe(res);
  });
  return {server,token};
}
module.exports={createDownloadServer,selectFiles};
if(require.main===module) {
  const [host,root]=process.argv.slice(2);
  if(!/^\d{1,3}(\.\d{1,3}){3}$/.test(host||'') || !root) throw Error('Usage: node download-server.cjs <LAN IPv4> <migration directory>');
  const {server,token}=createDownloadServer(root);
  server.on('error',e=>{console.error('Download server: '+e.message);process.exitCode=1;});
  server.listen(8765,host,()=>{
    console.log('On the Mac, open Safari and enter:\nhttp://'+host+':8765/'+token+'/BigTuna-Mac-Migration.zip');
    console.log('\nAfter final export, use this same link with final-migration.btm as the filename.');
    console.log('Press Ctrl+C when downloads finish. Keep recovery keys separate.');
  });
}
