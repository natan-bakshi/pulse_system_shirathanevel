import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import parser from '@babel/parser';
import traverseModule from '@babel/traverse';
const traverse=traverseModule.default||traverseModule;

function files(dir) {
  const out=[];
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})) {
    const file=dir+'/'+entry.name;
    if(entry.isDirectory()) out.push(...files(file));
    else if(/\.(?:js|jsx|ts|tsx)$/.test(file)) out.push(file);
  }
  return out;
}

test('every UI translation helper reference is lexically bound in its own component',()=>{
  const unbound=[];
  for(const file of files('src')) {
    const code=fs.readFileSync(file,'utf8');
    const ast=parser.parse(code,{sourceType:'module',plugins:['jsx','typescript']});
    traverse(ast,{Identifier(p){
      const name=p.node.name;
      if((name==='t'||name==='uiTranslate')&&p.isReferencedIdentifier()&&!p.scope.hasBinding(name))
        unbound.push(file+':'+p.node.loc.start.line+': '+name);
    }});
  }
  assert.deepEqual(unbound,[],'An undefined translation function crashes React during rendering');
});

test('event details outer authentication gate has a language hook',()=>{
  const src=fs.readFileSync('src/pages/EventDetails.jsx','utf8');
  assert.match(src,/export default function EventDetails\(\)\s*\{\s*const \{t\}=useLanguage\(\)/);
});
