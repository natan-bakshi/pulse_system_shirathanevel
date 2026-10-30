import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const tables=[
 'base44/entities/WhatsAppInboundReceipt.jsonc',
 'base44/entities/WhatsAppOutbox.jsonc',
 'base44/entities/WhatsAppQueueControl.jsonc'
];
test('WhatsApp business evidence and queue control cannot be directly created/edited/deleted by an authenticated admin browser',()=>{
 for(const f of tables){
  const row=JSON.parse(fs.readFileSync(f,'utf8'));
  assert.deepEqual(row.rls.read,{user_condition:{role:'admin'}},f);
  for(const action of ['create','update','delete'])
   assert.equal(row.rls[action],false, f+' '+action);
 }
});
test('existing authenticated owner backend continues managing the same stores through server service role',()=>{
 const admin=fs.readFileSync('base44/functions/WhatsAppQueueAdmin/entry.ts','utf8');
 const ownerSwitch=fs.readFileSync('base44/functions/greenAssignmentProductionAdmin/entry.ts','utf8');
 const create=fs.readFileSync('base44/shared/whatsappOutbox.ts','utf8');
 const receipts=fs.readFileSync('base44/shared/whatsappInboundInbox.ts','utf8');
 const worker=fs.readFileSync('base44/shared/whatsappQueueWorker.ts','utf8');
 for(const s of [admin,ownerSwitch,create,receipts,worker])
  assert.match(s,/asServiceRole\.entities/,
   'existing protected backend writes must remain service-role only');
 assert.match(admin,/actor\.role!=='admin'/);
 assert.match(admin,/OWNER_EMAIL/);
 assert.match(ownerSwitch,/actor\.role!=='admin'/);
 assert.match(ownerSwitch,/OWNER/);
 const files=fs.readdirSync('src',{recursive:true}).filter(x=>
  /\.(jsx|js|tsx|ts)$/.test(x));
 for(const name of files){
  const src=fs.readFileSync('src/'+name,'utf8');
  for(const entity of ['WhatsAppInboundReceipt','WhatsAppOutbox','WhatsAppQueueControl'])
   assert.doesNotMatch(src,new RegExp('\\bentities\\.'+entity+'\\.(create|update|delete|updateMany)\\s*\\('),
    'UI must go through role-checked backend functions, not direct entity CRUD: '+name);
 }
});
