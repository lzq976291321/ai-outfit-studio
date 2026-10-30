/** Parse only final image outputs. Diagnostics intentionally contain no content, IDs or secrets. */
export class ImageResponseError extends Error {
  constructor(code,message,diagnostics){super(message);this.code=code;this.diagnostics=diagnostics;}
}
export function completePng(base64){
  const clean=base64.replace(/^data:image\/png;base64,/,'').replace(/\s/g,'');
  if(!clean||clean.length>34000000||clean.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(clean))return null;
  const bytes=Buffer.from(clean,'base64');
  if(bytes.length>25000000||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return null;
  let offset=8,header=false,pixels=false;
  while(offset+12<=bytes.length){
    const size=bytes.readUInt32BE(offset),type=bytes.toString('ascii',offset+4,offset+8);
    if(size>bytes.length-offset-12)return null;
    if(offset===8){if(type!=='IHDR'||size!==13||!bytes.readUInt32BE(offset+8)||!bytes.readUInt32BE(offset+12))return null;header=true;}
    if(type==='IDAT')pixels=true;
    offset+=12+size;
    if(type==='IEND')return size===0&&offset===bytes.length&&header&&pixels?bytes:null;
  }
  return null;
}
