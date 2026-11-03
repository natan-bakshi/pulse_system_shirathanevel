import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=(file)=>fs.readFileSync(file,'utf8');
test('client EventDetails reads one scoped backend bundle before mounting event editors',()=>{
 const event=read('src/pages/EventDetails.jsx');
 const outer=event.slice(event.indexOf('export default function EventDetails()'));
 assert.match(outer,/queryKey:\['clientEventDetailsFeed',eventId,user\?\.id,user\?\.email\]/);
 assert.match(outer,/base44\.functions\.invoke\('clientEventDetailsFeed',\{eventId\}\)/);
 assert.match(outer,/if\(isClient&&\(clientViewError\|\|!clientView\?\.event\)\)/);
 assert.match(outer,/return <EventDetailsBody\/>/);
 const body=event.slice(event.indexOf('function EventDetailsBody()'),event.indexOf('export default function EventDetails()'));
 assert.match(body,/queryKey: \['clientEventDetailsFeed', eventId, user\?\.id, user\?\.email\]/);
 assert.match(body,/const event = isAdmin \? adminEvent : clientDetail\?\.event;/);
 assert.match(body,/const eventServices = isAdmin \? adminEventServices/);
 assert.match(body,/const allServices = isAdmin \? adminServices : \(clientDetail\?\.catalog \|\| \[\]\)/);
 for(const source of ['Service','Supplier','Package','QuoteTemplate','Event','EventService']){
  const needle='base44.entities.'+source+'.';
  assert.match(body,new RegExp(needle.replace(/\./g,'\\.')+'(?:get|list|filter)'));
 }
 assert.equal((body.match(/enabled: isAdmin/g)||[]).length,6,
  'all six raw admin service, suppliers, packages, templates, event and eventServices must be admin-only');
 assert.match(body,/enabled: !!eventId && isAdmin/);
 assert.doesNotMatch(outer,/base44\.entities\.(Event|EventService)/);
});
test('client event backend fails closed, accepts only authenticated POST eventId and never responds with raw entity rows',()=>{
 const api=read('base44/functions/clientEventDetailsFeed/entry.ts');
 assert.match(api,/req\.method !== 'POST'/);
 assert.match(api,/await client\.auth\.me\(\)/);
 assert.match(api,/Object\.keys\(body\)\.join\(','\) !== 'eventId'/);
 assert.match(api,/readClientEventDetailsFeed\(client,user,body\.eventId\)/);
 assert.match(api,/Cache-Control.*no-store/);
 assert.match(api,/Event not available/);
 assert.doesNotMatch(api,/db\.Event\.get|entities\.Event\.get|asServiceRole\.entities\.Event\.list/);
});
test('only admin mounts raw event realtime subscription; route role gate executes before children',()=>{
 const layout=read('src/Layout.jsx');
 assert.match(layout,/if \(!user\?\.id \|\| user\.role !== 'admin'\) return;/);
 assert.match(layout,/return subscribeToEventStatus\(\);/);
 assert.match(layout,/canMountContent=canMountPulsePage\(user,location\.pathname,SYSTEM_CREATOR_EMAIL\)/);
 assert.match(layout,/\{canMountContent \? children :/);
 const routes=read('src/lib/routeRoleAccess.js');
 assert.match(routes,/canMountPulsePage/);
 assert.match(routes,/if\(ADMIN\.has\(first\)\)return user\.role==='admin'/);
});
test('interactive Green provider transport remains free of native quote request fields',()=>{
 const transport=read('base44/shared/whatsappSend.ts');
 const quotePlanner=read('base44/shared/greenVerifiedQuotePlanner.ts');
 assert.match(transport,/callGreenApi\('sendInteractiveButtons'/);
 assert.doesNotMatch(transport,/quotedMessageId/);
 assert.match(quotePlanner,/interactive_quote_not_documented/);
});
