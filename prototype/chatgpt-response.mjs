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
export function parseImageResponse(text){
  const diagnostics={events:{},outputTypes:{},completed:false,incomplete:false,failed:false,refused:false,partialImages:0,finalImages:0,malformedEvents:0};
  let image=null,seenImage=false,seenText=false;
  function item(value,terminal){
    if(!value||typeof value!=='object')return;
    const type=value.type;
    if(typeof type==='string'&&/^[a-z_]{1,64}$/.test(type))diagnostics.outputTypes[type]=(diagnostics.outputTypes[type]||0)+1;
    if(type==='image_generation_call'){
      seenImage=true;
      if(value.status==='failed')diagnostics.failed=true;
      if(terminal&&(!value.status||value.status==='completed')&&typeof value.result==='string'&&value.result){image=value.result;diagnostics.finalImages++;}
    }
    if(type==='message')for(const block of value.content||[]){if(block.type==='refusal')diagnostics.refused=true;if(block.type==='output_text')seenText=true;}
  }
  function event(e,fallback){
    const type=e.type||fallback;
    if(typeof type==='string'&&/^[a-z_.]{1,100}$/.test(type))diagnostics.events[type]=(diagnostics.events[type]||0)+1;
    if(type==='response.image_generation_call.partial_image')diagnostics.partialImages++;
    if(type==='response.refusal.delta'||type==='response.refusal.done')diagnostics.refused=true;
    if(type==='response.output_text.delta')seenText=true;
    if(type==='response.output_item.added')item(e.item,false);
    if(type==='response.output_item.done')item(e.item,true);
    if(type==='response.image_generation_call.completed'&&typeof e.result==='string'){image=e.result;seenImage=true;diagnostics.finalImages++;}
    if(['response.failed','error'].includes(type))diagnostics.failed=true;
    if(type==='response.incomplete')diagnostics.incomplete=true;
    if(['response.completed','response.incomplete','response.failed'].includes(type)){
      diagnostics.completed=type==='response.completed';
      for(const out of e.response?.output||[])item(out,type==='response.completed');
    }
  }
  const trimmed=text.trimStart();
  if(trimmed.startsWith('{')){
    let payload;try{payload=JSON.parse(text);}catch{throw new ImageResponseError('INVALID_RESPONSE','上游响应格式不完整；结果待核对，请勿重复提交',diagnostics);}
    diagnostics.completed=payload.status==='completed';diagnostics.failed=payload.status==='failed';diagnostics.incomplete=payload.status==='incomplete';
    for(const out of payload.output||[])item(out,diagnostics.completed);
  }else{
    // SSE data may omit the space after ':' or span several data lines.
    for(const frame of text.replace(/\r\n/g,'\n').replace(/\r/g,'\n').split(/\n\n+/)){
      let type='';const lines=[];
      for(const line of frame.split('\n')){if(line.startsWith('event:'))type=line.slice(6).trim();if(line.startsWith('data:'))lines.push(line.slice(5).replace(/^ /,''));}
      if(!lines.length)continue;const data=lines.join('\n');if(data==='[DONE]')continue;
      try{event(JSON.parse(data),type);}catch{diagnostics.malformedEvents++;}
    }
  }
  const fail=(code,message)=>{throw new ImageResponseError(code,message,diagnostics);};
  if(diagnostics.failed)fail('UPSTREAM_FAILED','上游报告生成失败，未取得最终成片；不会自动重试');
  if(diagnostics.refused)fail('UPSTREAM_REFUSED','上游拒绝了本次请求，未返回成片；可调整参考图或要求后再提交');
  if(image){
    const bytes=completePng(image);if(!bytes)fail('INVALID_FINAL_IMAGE','最终图片内容不完整；结果待核对，请勿重复提交');
    // A terminal image item is sufficient even if the trailing response.completed marker is lost.
    return {image:'data:image/png;base64,'+bytes.toString('base64'),diagnostics};
  }
  if(diagnostics.completed&&!seenImage&&!diagnostics.partialImages)fail('IMAGE_TOOL_NOT_CALLED',seenText?'上游只返回了文字，没有执行生图；本次未取得成片':'上游未执行生图工具，本次未取得成片');
  if(diagnostics.partialImages)fail('PREVIEW_ONLY','只收到生成预览，未收到最终图片；结果待核对，请勿重复提交');
  fail('MISSING_FINAL_IMAGE','生图响应已结束，但没有最终图片；结果待核对，请勿重复提交');
}
