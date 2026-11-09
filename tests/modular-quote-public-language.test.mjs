import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';

let quote;
let signedCount=0;
const compiled=await build({
  entryPoints:['base44/functions/modularQuote/entry.ts'],bundle:true,
  platform:'node',format:'esm',write:false,
  plugins:[{name:'mock-platform',setup(b){
    b.onResolve({filter:/^npm:@base44\/sdk/},()=>({path:'sdk',namespace:'test'}));
    b.onResolve({filter:/\.\.\/\.\.\/shared\/modularQuote\.ts$/},
      ()=>({path:'composer',namespace:'test'}));
    b.onLoad({filter:/.*/,namespace:'test'},args=>({contents:args.path==='sdk'
      ? 'export const createClientFromRequest=()=>globalThis.__quoteClient;'
      : 'export const composeModularQuoteHtml=async quote=>({html:quote.content?.document_language===\'en\'?\'<html lang="en" dir="ltr"></html>\':\'<html lang="he" dir="rtl"></html>\',locale:quote.content?.document_language===\'en\'?\'en\':\'he\'});'}));
  }}]
});
const {default:handler}=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
globalThis.__quoteClient={
  asServiceRole:{
    entities:{ModularQuote:{filter:async()=>quote?[quote]:[]}},
    integrations:{Core:{CreateFileSignedUrl:async()=>{signedCount++;return {signed_url:'https://example.invalid/private.pdf'};}}}
  }
};
const token='a'.repeat(64);
const request=action=>new Request('https://test.invalid/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,token})});

test('English public quote keeps document language independent and hides legacy Hebrew PDF',async()=>{
  quote={content:{document_language:'en'},last_pdf_uri:'private/old.pdf'};
  signedCount=0;
  const res=await handler(request('view'));
  assert.equal(res.status,200);
  const body=await res.json();
  assert.equal(body.document_language,'en');
  assert.equal(body.has_pdf,false);
  assert.match(body.html,/lang="en"/);
  const download=await handler(request('download'));
  assert.equal(download.status,404);
  assert.equal(signedCount,0);
});

test('English public quote permits only a PDF explicitly generated in English',async()=>{
  quote={content:{document_language:'en'},last_pdf_uri:'private/new.pdf',last_pdf_language:'en'};
  signedCount=0;
  const result=await (await handler(request('view'))).json();
  assert.equal(result.has_pdf,true);
  assert.equal(result.document_language,'en');
  const download=await handler(request('download'));
  assert.equal(download.status,200);
  assert.equal(signedCount,1);
});

test('Existing Hebrew public quotes keep legacy PDF downloads',async()=>{
  quote={content:{document_language:'he'},last_pdf_uri:'private/hebrew.pdf'};
  signedCount=0;
  const result=await (await handler(request('view'))).json();
  assert.equal(result.document_language,'he');
  assert.equal(result.has_pdf,true);
  assert.equal((await handler(request('download'))).status,200);
  assert.equal(signedCount,1);
});

test('Modular PDF issuance stores the generated language with file metadata',async()=>{
  const {readFile}=await import('node:fs/promises');
  const source=await readFile('base44/functions/generateManualQuotePdf/entry.ts','utf8');
  assert.match(source,/last_pdf_language:manualQuote\.content\?\.document_language==='en'\?'en':'he'/);
  const schema=JSON.parse(await readFile('base44/entities/ModularQuote.jsonc','utf8'));
  assert.deepEqual(schema.properties.last_pdf_language.enum,['he','en']);
});
