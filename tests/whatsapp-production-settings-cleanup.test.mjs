import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import esbuild from 'esbuild';

const ui=()=>fs.readFileSync('src/components/admin/notifications/WhatsAppQueueSettings.jsx','utf8');
const buttons=()=>fs.readFileSync('src/components/admin/notifications/WhatsAppLiveButtonSettings.jsx','utf8');
const owner=()=>fs.readFileSync('base44/functions/WhatsAppQueueAdmin/entry.ts','utf8');

test('production WhatsApp management screen is organized and does not render obsolete tests/pilots',()=>{
 const src=ui();
 for(const heading of [
  'מצב המערכת','שליחה וקצב','כפתורי WhatsApp לספקים','הודעות ותקלות',
  'איתור שיבוץ לפי אסמכתא','חיבור Green וקליטת תגובות',
  'אבחון תקלות וביצועים','הפעלה ידנית של עובד התור'
 ])assert.match(src,new RegExp(heading));
 for(const retired of [
  /greenButtonQaEnroll/,/greenButtonQaProvisionWebhook/,
  /manageLegacyPilot/,/greenButtonQaLiveResult/,/qaPilotNewSendsEnabled/,
  /WhatsAppWebhookCreditsEstimator/,/WhatsAppInteractiveDraftSettings/,
  /run\('greenButtonQaReadiness'\)/,/run\('interactiveReadiness'\)/,
  /run\('assignmentV2Readiness'\)/
 ])assert.doesNotMatch(src,retired);
 assert.match(src,/id="whatsapp-queue"/);
 assert.match(src,/open=\{expanded\}/);
 assert.match(src,/get\('whatsappQueue'\)==='review'/);
});
test('new active-policy editor preserves three immutable actions and updates only office/labels via server CAS',()=>{
 const src=buttons();
 for(const action of ['assignment_approve','assignment_reject','contact_office'])
  assert.match(src,new RegExp(action));
 assert.match(src,/action:'interactiveGet'/);
 assert.match(src,/action:'interactiveSave'/);
 assert.match(src,/expectedVersion:saved.version/);
 assert.match(src,/policy:\{\.\.\.draft.policy,enabled:false\}/);
 assert.match(src,/window.confirm\(/);
 assert.doesNotMatch(src,/greenButtonQaEnroll|greenButtonQaProvisionWebhook|legacyGreenPilotAdmin/);
 assert.doesNotMatch(src,/setInterval\(|setTimeout\(/);
});
test('retired owner test routes are terminal 410 before any legacy enrollment or webhook provisioning',()=>{
 const src=owner();
 const marker=src.indexOf("if(action==='greenButtonQaEnroll'||action==='greenButtonQaProvisionWebhook')");
 assert.ok(marker>0);
 assert.match(src.slice(marker,marker+420),/legacy_qa_retired/);
 assert.match(src.slice(marker,marker+420),/410/);
 const idx=src.indexOf("if(action==='interactiveGet')");
 assert.ok(marker<idx,'retirement guard must run before owner reads or writes');
 const pilot=fs.readFileSync('base44/functions/legacyGreenPilotAdmin/entry.ts','utf8');
 assert.match(pilot,/if\(body.action==='arm'\)return reply\(\{success:false,/);
 assert.match(pilot,/noMessagesSent:true,noSupplierWrites:true,noProviderRequests:true\},410/);
 assert.match(pilot,/if\(body.action==='status'\)return reply\(present\(\)\)/);
 assert.match(pilot,/inboundHistoryPreserved:true/);
});
test('settings are lazy, production status reuses singleton DB read and no extra testing API calls occur on open',()=>{
 const src=ui(),api=owner();
 assert.match(src,/if\(!expanded\)return/);
 assert.match(src,/WhatsAppQueueAdmin',\{action:'status'\}/);
 assert.match(src,/\{messagesOpen&&<div id="whatsapp-queue-messages-panel">/);
 assert.match(src,/setView\(/);
 assert.match(api,/interactiveButtonsEnabled:control.interactive_assignment_production_enabled===true/);
 assert.doesNotMatch(src,/useEffect\([^]*?greenButtonQa/);
 esbuild.transformSync(src,{loader:'jsx',target:'es2022'});
 esbuild.transformSync(buttons(),{loader:'jsx',target:'es2022'});
});
