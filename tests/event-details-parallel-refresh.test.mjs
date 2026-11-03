import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function refreshCallback(){
 const src=fs.readFileSync('src/pages/EventDetails.jsx','utf8');
 const begin='  const loadEventData = useCallback(async () => {';
 const end='  }, [eventId, queryClient, isAdmin]);';
 const start=src.indexOf(begin);
 const finish=src.indexOf(end,start+begin.length);
 assert.ok(start>=0 && finish>start,'Exact EventDetails data loader must exist');
 const body=src.slice(start+begin.length,finish);
 return vm.runInNewContext('(async (queryClient,eventId,isAdmin) => {'+body+'})',{Promise});
}
test('EventDetails refresh sends event, service and payment reads in parallel AFTER save',async()=>{
 const callback=refreshCallback();
 const started=[],finishers=[];
 const client={refetchQueries:({queryKey})=>{
   started.push(Array.from(queryKey));
   return new Promise(resolve=>finishers.push(resolve));
 }};
 let settled=false;
 const loading=callback(client,'event-qa123',true).then(()=>settled=true);
 assert.deepEqual(started,[
   ['event','event-qa123'],['eventServices','event-qa123'],['payments','event-qa123']
 ],'All independent queries must start without waiting for the previous one');
 assert.equal(settled,false);
 finishers[0]();finishers[2]();
 await Promise.resolve();
 assert.equal(settled,false,'The UI may not claim refresh finished before all results');
 finishers[1]();
 await loading;
 assert.equal(settled,true);
});
test('client refresh only starts the authenticated projection and payments in parallel',async()=>{
 const callback=refreshCallback(),started=[];
 const client={refetchQueries:({queryKey})=>{started.push([...queryKey]);return Promise.resolve();}};
 await callback(client,'client-event-qa123',false);
 assert.deepEqual(started,[['clientEventDetailsFeed','client-event-qa123'],['payments','client-event-qa123']]);
 assert.ok(!started.some(([key])=>key==='event'||key==='eventServices'));
});
test('a failed query still surfaces refresh error, never silently reports success',async()=>{
 const callback=refreshCallback();
 const client={refetchQueries:({queryKey})=>{
   if(queryKey[0]==='payments')return Promise.reject(Error('Simulated unavailable payments'));
   return Promise.resolve();
 }};
 await assert.rejects(callback(client,'event-qa123',true),/Simulated unavailable payments/);
});
