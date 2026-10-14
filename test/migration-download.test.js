const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createDownloadServer}=require('../tools/windows-migration/download-server.cjs');
test('private transfer serves only whitelisted encrypted artifacts, never keys or traversal',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'tuna-download-'));
 fs.writeFileSync(path.join(root,'BigTuna-Mac-Migration.zip'),'synthetic-kit');
 fs.mkdirSync(path.join(root,'Final-20261014-120000'));
 fs.writeFileSync(path.join(root,'Final-20261014-120000','migration.btm'),'synthetic-encrypted-final');
 fs.writeFileSync(path.join(root,'Final-20261014-120000','inventory.json'),JSON.stringify({consistency:'final-stopped-writers'}));
 fs.writeFileSync(path.join(root,'RECOVERY-KEY.txt'),'synthetic-secret');
 const {server,token}=createDownloadServer(root);
 try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port+'/'+token+'/';
  assert.equal(await (await fetch(base+'BigTuna-Mac-Migration.zip')).text(),'synthetic-kit');
  assert.equal(await (await fetch(base+'final-migration.btm')).text(),'synthetic-encrypted-final');
  for(const name of ['RECOVERY-KEY.txt','%2e%2e/RECOVERY-KEY.txt','%2fRECOVERY-KEY.txt','BigTuna-Mac-Migration.zip?key=1']) assert.equal((await fetch(base+name)).status,404);
  assert.equal((await fetch(base+'BigTuna-Mac-Migration.zip',{method:'POST'})).status,404);
  assert.equal((await fetch(base.replace(token,'wrong')+'BigTuna-Mac-Migration.zip')).status,404);
 } finally {await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});}
});
