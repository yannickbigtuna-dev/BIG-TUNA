'use strict';
// Windows ZIP creation sets DOS creator metadata. Mark the already-assigned
// Unix file modes correctly so Finder extraction preserves executable scripts.
const fs=require('node:fs');
function setUnixCreator(file) {
 const fd=fs.openSync(file,'r+');
 try {
  const size=fs.fstatSync(fd).size;
  const tail=Buffer.alloc(Math.min(size,65557));fs.readSync(fd,tail,0,tail.length,size-tail.length);
  let end=-1;
  for(let i=tail.length-22;i>=0;i--)if(tail.readUInt32LE(i)===0x06054b50 && i+22+tail.readUInt16LE(i+20)===tail.length){end=i;break;}
  if(end<0)throw Error('Missing ZIP central directory');
  const count=tail.readUInt16LE(end+10);let pos=tail.readUInt32LE(end+16);
  if(count===65535 || pos===0xffffffff)throw Error('ZIP64 assembly needs explicit support');
  for(let i=0;i<count;i++) {
   const header=Buffer.alloc(46);if(fs.readSync(fd,header,0,46,pos)!==46 || header.readUInt32LE(0)!==0x02014b50)throw Error('Invalid ZIP central entry');
   const nameLength=header.readUInt16LE(28);const name=Buffer.alloc(nameLength);fs.readSync(fd,name,0,nameLength,pos+46);
   const unixMode=header.readUInt32LE(38)>>>16;
   if(/\.(command|sh)$/.test(name.toString()) && (unixMode&0o111)!==0o111)throw Error('ZIP script is missing executable permissions');
   header[5]=3;fs.writeSync(fd,header,0,46,pos);
   pos+=46+nameLength+header.readUInt16LE(30)+header.readUInt16LE(32);
  }
  return count;
 }finally{fs.closeSync(fd);}
}
module.exports={setUnixCreator};
if(require.main===module)console.log('ZIP Unix modes validated for '+setUnixCreator(process.argv[2])+' entries');
