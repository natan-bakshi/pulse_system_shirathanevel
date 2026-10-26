import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('WhatsApp owner page avoids status/list API requests while collapsed',()=>{
 const ui=fs.readFileSync('src/components/admin/notifications/WhatsAppQueueSettings.jsx','utf8');
 assert.match(ui,/const \[expanded,setExpanded\]=useState\(reviewDeepLink\)/);
 assert.match(ui,/if\(!expanded\)return;\s*let alive=true;\s*base44\.functions\.invoke\('WhatsAppQueueAdmin',\{action:'status'\}\)/);
 assert.match(ui,/\},\[expanded\]\);/);
 assert.match(ui,/const \[messagesOpen,setMessagesOpen\]=useState\(reviewDeepLink\)/);
 assert.match(ui,/\{messagesOpen&&<div id="whatsapp-queue-messages-panel">\s*<WhatsAppQueueMessages/);
 assert.match(ui,/aria-expanded=\{messagesOpen\}/);
 // The review deep link still opens full queue so UNKNOWNs are not hidden.
 assert.match(ui,/get\('whatsappQueue'\)==='review'/);
});
