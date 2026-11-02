/** Local ChatGPT bridge: credentials and image bytes never leave process memory except to ChatGPT. */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {editWithLocalChatGPT} from './chatgpt-images.mjs';

async function session() {
  const home=process.env.CODEX_HOME||path.join(os.homedir(),'.codex');
  let data;
  try {data=JSON.parse(await fs.readFile(path.join(home,'auth.json'),'utf8'));}
  catch {throw Error('未找到本机登录，请先在 Codex 中使用 ChatGPT 账号登录');}
  const token=data.tokens?.access_token, account=data.tokens?.account_id;
  if(typeof token!=='string'||typeof account!=='string'||!token||!account)throw Error('本机登录不可用，请先在 Codex 中使用 ChatGPT 账号登录');
  try {
    const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());
    if(claims.exp && claims.exp*1000<Date.now())throw Error('EXPIRED');
  }catch(e){if(e.message==='EXPIRED')throw Error('本机登录已过期，请在 Codex 中重新登录后再连接');}
  return {token,account};
}
async function main(){
  let input='';for await(const chunk of process.stdin)input+=chunk;
  const args=JSON.parse(input);const auth=await session();
  if(args.action==='connect')return {connected:true}; // Local readiness, not an upstream entitlement check.
  if(args.action!=='generate'||typeof args.prompt!=='string'||!Array.isArray(args.references)||!args.references.length)throw Error('本机生成参数无效');
  return editWithLocalChatGPT({auth,prompt:args.prompt,references:args.references});
}
main().then(result=>process.stdout.write(JSON.stringify(result))).catch(e=>{
  // Never print raw upstream errors, headers, bodies, auth objects, or stack traces.
  const message=e.diagnostics||/^(未找到本机登录|本机登录|本机生成参数|ChatGPT 返回)/.test(e.message)?e.message:'连接中断，执行结果待核对，请勿直接重复提交';
  process.stdout.write(JSON.stringify({error:message,outcome:/^(未找到本机登录|本机登录|本机生成参数)/.test(e.message)||(e.diagnostics&&e.diagnostics.httpStatus>=400&&e.diagnostics.httpStatus<500)?'failed':'unknown',...(e.code?{errorCode:e.code}:{}),...(e.diagnostics?{diagnostics:e.diagnostics}:{})}));process.exitCode=1;
});
