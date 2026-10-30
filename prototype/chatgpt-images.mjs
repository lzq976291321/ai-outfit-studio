/** Local-login Images adapter. A single request; no fallbacks or automatic retries. */
import crypto from 'node:crypto';
import {completePng,ImageResponseError} from './image-common.mjs';
export function safeProviderError(payload,secrets=[]){
 const error=payload?.error??payload??{};
 let message=typeof error==='string'?error:typeof error.message==='string'?error.message:'';
 for(const secret of secrets)if(secret)message=message.split(secret).join('[redacted]');
 message=message.replace(/Bearer\s+\S+/gi,'Bearer [redacted]').replace(/\beyJ[A-Za-z0-9_.-]{20,}/g,'[token]').replace(/\bsk-[A-Za-z0-9_-]+/g,'[key]').replace(/data:image\/[^\s"']+/g,'[image]').replace(/https?:\/\/[^\s"']+/g,'[url]').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[email]').replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,'[request-id]');
 return {code:typeof error.code==='string'&&/^[a-zA-Z0-9_.-]{1,100}$/.test(error.code)?error.code:'',message:message.slice(0,350)};
}
export function decodeImageResponse(text,status,secrets=[]){
 let payload;try{payload=JSON.parse(text);}catch{throw new ImageResponseError('INVALID_IMAGE_RESPONSE',`ChatGPT 图片接口未返回可用数据（HTTP ${status}）；执行结果待核对`,{route:'images/edits',httpStatus:status});}
 if(status<200||status>=300){
  const upstream=safeProviderError(payload,secrets);const diagnostics={route:'images/edits',httpStatus:status,upstreamCode:upstream.code,upstreamMessage:upstream.message};
  if(/^(moderation_blocked|content_policy_violation)$/.test(upstream.code)){
   const match=upstream.message.match(/safety_violations=\[([a-z_, ]{1,100})\]/i);
   const categories=match?match[1].split(',').map(s=>s.trim()).filter(Boolean):[];
   diagnostics.safetyCategories=categories;
   throw new ImageResponseError('CONTENT_REJECTED','参考素材或本次组合未通过 ChatGPT 内容安全检查'+(categories.length?'（'+categories.join('、')+'）':'')+'；请更换参考素材，不会自动重试',diagnostics);
  }
  let message=status===401?'本机 ChatGPT 登录已失效，请重新登录':status===429?'ChatGPT 图片接口达到额度或并发限制，请稍后手动再试':status>=500?'ChatGPT 图片服务返回内部错误，未取得成片':'ChatGPT 图片接口未接受本次请求';
  if(upstream.code)message+='（'+upstream.code+'）';
  if(upstream.message)message+='：'+upstream.message;
  throw new ImageResponseError(status===401?'AUTH_EXPIRED':status===429?'IMAGE_RATE_LIMIT':'IMAGE_API_ERROR',message,diagnostics);
 }
 const data=payload.data;
 if(!Array.isArray(data)||data.length!==1||typeof data[0]?.b64_json!=='string')throw new ImageResponseError('MISSING_IMAGE_DATA','图片接口没有返回最终图片；执行结果待核对，请勿重复提交',{route:'images/edits',httpStatus:status});
 const bytes=completePng(data[0].b64_json);
 if(!bytes)throw new ImageResponseError('INVALID_FINAL_IMAGE','返回的最终图片不完整；执行结果待核对，请勿重复提交',{route:'images/edits',httpStatus:status});
 return {image:'data:image/png;base64,'+bytes.toString('base64'),diagnostics:{route:'images/edits',httpStatus:status,finalImages:1}};
}
export async function editWithLocalChatGPT({auth,prompt,references},fetchImpl=fetch){
 const body={model:'gpt-image-2',prompt,images:references.map(image_url=>({image_url})),size:'864x1536',quality:'high',background:'opaque',output_format:'png',n:1};
 const response=await fetchImpl('https://chatgpt.com/backend-api/codex/images/edits',{method:'POST',redirect:'error',signal:AbortSignal.timeout(240000),headers:{Authorization:'Bearer '+auth.token,'ChatGPT-Account-ID':auth.account,'Content-Type':'application/json',Accept:'application/json',originator:'codex_cli_rs','User-Agent':'codex_cli_rs/0.156.1','x-codex-image-turn-id':crypto.randomUUID()},body:JSON.stringify(body)});
 return decodeImageResponse(await response.text(),response.status,[auth.token,auth.account]);
}
