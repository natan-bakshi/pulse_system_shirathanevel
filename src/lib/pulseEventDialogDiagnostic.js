// TEMPORARY, opt-in browser diagnostic for a read-only admin QA session.
// Remove this file and all references after isolating the modal blocker.
export function eventDialogDiagnosticEnabled(){
 return typeof window!=='undefined' &&
   window.location.pathname.toLowerCase().includes('eventmanagement') &&
   new URLSearchParams(window.location.search).get('pulse_diag_event_form')==='1';
}
const seen=new Set();
export function eventDialogMark(label){
 if(!eventDialogDiagnosticEnabled()||seen.has(label))return;
 seen.add(label);
 let el=document.getElementById('pulse-event-form-trace');
 if(!el){
  el=document.createElement('aside');
  el.id='pulse-event-form-trace';
  el.setAttribute('role','status');
  el.setAttribute('aria-label','Pulse event editor technical QA trace');
  Object.assign(el.style,{position:'fixed',inset:'4px auto auto 4px',
    zIndex:'2147483647',width:'360px',maxHeight:'55vh',overflow:'auto',
    background:'#fff',color:'#111',padding:'10px',border:'2px solid #c00',
    font:'12px monospace',pointerEvents:'none',whiteSpace:'pre-wrap'});
  document.body.appendChild(el);
 }
 el.textContent+=label+'\n';
}
export function eventDialogError(error){
 const frames=String(error?.stack||'').split('\n').slice(1,5)
   .map(line=>line.trim().replace(/https?:\/\/[^\s)]+/g,'[bundle]'))
   .join(' | ').slice(0,380);
 eventDialogMark('ERROR '+String(error?.name||'unknown')+' frames '+frames);
}
export function startEventDialogDomProbe(){
 if(!eventDialogDiagnosticEnabled())return ()=>{};
 const proto=Node.prototype,original=proto.removeChild;
 function describe(node){
  if(!node)return 'none';
  const tag=String(node.nodeName||'unknown');
  const role=node.nodeType===1?String(node.getAttribute('role')||''):'';
  const className=node.nodeType===1?String(node.getAttribute('class')||'').slice(0,85):'';
  const reactKey=Object.keys(node).find(k=>k.startsWith('__reactFiber$'));
  let fiber=reactKey?node[reactKey]:null,owner='';
  for(let i=0;i<6&&fiber;i++,fiber=fiber.return){
   const name=typeof fiber.type==='function'?(fiber.type.displayName||fiber.type.name):
    typeof fiber.type==='string'?fiber.type:'';
   if(name&&name!==tag.toLowerCase()){owner=name;break;}
  }
  return tag+' role='+role+' class='+className+' component='+owner;
 }
 proto.removeChild=function(child){
  if(child&&child.parentNode!==this){
   eventDialogMark('REMOVE_CHILD_MISMATCH expected={'+describe(this)+
    '} actual={'+describe(child.parentNode)+'} child={'+describe(child)+'}');
  }
  return original.call(this,child);
 };
 return ()=>{proto.removeChild=original;};
}

