const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
const source=fs.readFileSync('gcp/server.ts','utf8').replace('async function readBody','export async function readBody');
const loaded={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:loaded,require:n=>n==='node:http'?{createServer:()=>({listen(){}})}:n.includes('api/index')?{default:async()=>{}}:require(n),process:{env:{}},Buffer,Number,console,setTimeout,clearTimeout});
const request=(chunks,headers={})=>({headers,async *[Symbol.asyncIterator](){for(const c of chunks)yield Buffer.from(c)}});
test('rejects a body exceeding 64KiB while streaming',async()=>{await assert.rejects(()=>loaded.readBody(request(['x'.repeat(65537)])),/large/i)});
test('rejects oversized Content-Length before consuming stream',async()=>{await assert.rejects(()=>loaded.readBody(request([],{ 'content-length':'65537'})),/large/i)});
test('reads bounded JSON normally',async()=>assert.deepEqual(JSON.stringify(await loaded.readBody(request(['{"ok":true}'],{'content-type':'application/json'}))),' {"ok":true}'.trim()));
