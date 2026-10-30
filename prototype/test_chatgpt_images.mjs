import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {editWithLocalChatGPT,decodeImageResponse,safeProviderError} from './chatgpt-images.mjs';
const png=fs.readFileSync(new URL('../tests/fixtures/tiny.png',import.meta.url)).toString('base64');
test('direct route sends three ordered references once, no chat orchestration',async()=>{
 let calls=0;
 const result=await editWithLocalChatGPT({auth:{token:'test-token',account:'test-account'},prompt:'测试',references:['outfit','person','pose']},async(url,init)=>{
  calls++;assert.equal(url,'https://chatgpt.com/backend-api/codex/images/edits');assert.equal(init.redirect,'error');const body=JSON.parse(init.body);assert.equal(body.n,1);assert.deepEqual(body.images.map(i=>i.image_url),['outfit','person','pose']);assert.ok(!('tool_choice' in body));return new Response(JSON.stringify({data:[{b64_json:png}]}),{status:200});
 });assert.equal(calls,1);assert.ok(result.image.startsWith('data:image/png;'));
});
test('provider code and readable cause survive, secrets do not',()=>{
 const detail=safeProviderError({error:{code:'image_generation_failed',message:'bad secret-account Bearer abc123 https://example.com/private?q=token secret-token'}},['secret-account','secret-token']);
 assert.equal(detail.code,'image_generation_failed');for(const secret of ['secret-account','secret-token','abc123','example.com'])assert.ok(!detail.message.includes(secret));
});
test('explicit rejection is not hidden as unknown',()=>assert.throws(()=>decodeImageResponse(JSON.stringify({error:{code:'invalid_image',message:'reference image unreadable'}}),400),e=>e.code==='IMAGE_API_ERROR'&&e.diagnostics.upstreamCode==='invalid_image'&&e.message.includes('reference image unreadable')));
test('429 has a distinct quota/concurrency error',()=>assert.throws(()=>decodeImageResponse('{"error":{"message":"limited"}}',429),e=>e.code==='IMAGE_RATE_LIMIT'));
test('truncated final image is rejected',()=>assert.throws(()=>decodeImageResponse(JSON.stringify({data:[{b64_json:Buffer.from(png,'base64').subarray(0,-12).toString('base64')}]}),200),e=>e.code==='INVALID_FINAL_IMAGE'));
test('transport failure does not auto-retry or fall back',async()=>{let calls=0;await assert.rejects(editWithLocalChatGPT({auth:{token:'test',account:'test'},prompt:'test',references:['test']},async()=>{calls++;throw Error('transport');}));assert.equal(calls,1);});
test('moderation classification is explicit, not a generic transport error',()=>{
 assert.throws(()=>decodeImageResponse(JSON.stringify({error:{code:'moderation_blocked',message:'blocked safety_violations=[sexual].'}}),400),e=>e.code==='CONTENT_REJECTED'&&e.message.includes('sexual')&&e.diagnostics.safetyCategories[0]==='sexual');
});
test('request IDs are redacted from UI errors',()=>assert.ok(!safeProviderError({error:{message:'request 12345678-1234-1234-1234-123456789abc'}}).message.includes('12345678')));
