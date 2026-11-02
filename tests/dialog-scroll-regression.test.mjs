import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {twMerge} from 'tailwind-merge';

const read=p=>readFileSync(p,'utf8');
const manager=read('src/components/events/EventServicesManager.jsx');
const packageDialog=read('src/components/events/AddServiceToPackageDraftDialog.jsx');
const form=read('src/components/events/EventForm.jsx');

test('FIX-004: modal event form has seven true nested modal roots (not modal=false portals)',()=>{
 assert.match(form,/<Dialog open=\{isOpen\} onOpenChange=\{onClose\}>/);
 const nested=[...manager.matchAll(/<Dialog\s+open=\{[^}]+\}\s+onOpenChange=\{[^}]+\}(?:\s+modal=\{false\})?>/g)];
 assert.equal(nested.length,7,'six formerly nonmodal dialogs plus the existing supplier-assignment modal');
 assert.ok(nested.every(m=>!m[0].includes('modal={false}')));
 assert.match(packageDialog,/<Dialog open=\{open\} onOpenChange=\{onOpenChange\}>/);
 assert.doesNotMatch(packageDialog,/modal=\{false\}/);
 assert.doesNotMatch(manager,/modal=\{false\}/);
});

test('FIX-004: package service search list and parent are both vertically scrollable on touch',()=>{
 assert.match(packageDialog,/max-h-\[90dvh\] overflow-y-auto overscroll-y-contain/);
 assert.match(packageDialog,/max-h-64 min-h-0 overflow-y-auto overscroll-y-contain touch-pan-y/);
 assert.match(packageDialog,/filteredServices\.map\(service =>/);
 assert.match(packageDialog,/onCheckedChange=\{\(checked\) =>/);
 assert.match(packageDialog,/onClick=\{onAdd\}/);
 assert.match(manager,/<AddServiceToPackageDraftDialog\b/);
 assert.match(manager,/open=\{showDirectPackageServiceDialog\}/);
 assert.match(manager,/onAdd=\{handleAddServicesDirectlyToPackage\}/);
 for(const list of ['max-h-48','max-h-64','max-h-96','max-h-60'])
  assert.ok(manager.includes(list)&&manager.includes('overscroll-y-contain touch-pan-y'),
   'all service pickers keep a bounded native vertical scroll');
});

test('FIX-004: app dialogs and confirmation dialogs never exceed mobile viewport',()=>{
 for(const component of ['dialog.jsx','alert-dialog.jsx']){
  const source=read('src/components/ui/'+component);
  assert.match(source,/max-h-\[calc\(100dvh-2rem\)\]/);
  assert.match(source,/overflow-y-auto overscroll-y-contain/);
  assert.match(source,/\bref=\{ref\}/);
  assert.match(source,/\bclassName=\{cn\(/,
   'consumer classes may override defaults');
 }
 const sheet=read('src/components/ui/sheet.jsx');
 assert.match(sheet,/max-h-\[100dvh\] overflow-y-auto overscroll-y-contain/);
 assert.match(sheet,/sheetVariants\(\{ side \}\)/);
});

test('FIX-004: popovers and menus are bounded by Radix available viewport height',()=>{
 const popup=read('src/components/ui/popover.jsx');
 assert.match(popup,/max-h-\[var\(--radix-popover-content-available-height\)\]/);
 assert.match(popup,/overflow-y-auto overscroll-y-contain/);
 const dropdown=read('src/components/ui/dropdown-menu.jsx');
 assert.equal((dropdown.match(/max-h-\[var\(--radix-dropdown-menu-content-available-height\)\]/g)||[]).length,2);
 assert.equal((dropdown.match(/overflow-y-auto overscroll-y-contain/g)||[]).length,2);
 const select=read('src/components/ui/select.jsx');
 assert.match(select,/<SelectPrimitive\.ScrollUpButton/);
 assert.match(select,/<SelectPrimitive\.Viewport/);
 assert.match(select,/<SelectPrimitive\.ScrollDownButton/);
 const scrollArea=read('src/components/ui/scroll-area.jsx');
 assert.match(scrollArea,/<ScrollAreaPrimitive\.Viewport/);
 assert.match(scrollArea,/ScrollAreaPrimitive\.ScrollAreaScrollbar/);
});

test('FIX-004: Tailwind merged defaults honor deliberate per-dialog overrides',()=>{
 const original='max-h-[calc(100dvh-2rem)] overflow-y-auto overscroll-y-contain';
 const saved=twMerge(original,'max-h-[90vh] overflow-hidden');
 assert.ok(saved.includes('max-h-[90vh]'));
 assert.ok(saved.includes('overflow-hidden'));
 assert.ok(!saved.includes('max-h-[calc(100dvh-2rem)]'));
 assert.ok(!saved.includes('overflow-y-auto'));
 const normal=twMerge(original,'max-w-4xl');
 assert.ok(normal.includes('max-h-[calc(100dvh-2rem)]'));
 assert.ok(normal.includes('overflow-y-auto'));
});

test('FIX-004: nested scroll events are locally isolated, never prevented globally',()=>{
 const dialog=read('src/components/ui/dialog.jsx');
 assert.match(dialog,/NestedDialogScrollContext\s*=\s*React\.createContext\(false\)/);
 assert.match(dialog,/React\.useContext\(NestedDialogScrollContext\)/);
 assert.match(dialog,/onWheel=\{handleWheel\}/);
 assert.match(dialog,/onTouchMove=\{handleTouchMove\}/);
 assert.match(dialog,/NestedDialogScrollContext\.Provider value=\{true\}/);
 assert.equal((dialog.match(/if \(isNested\) event\.stopPropagation\(\)/g)||[]).length,2);
 assert.doesNotMatch(dialog,/event\.preventDefault\(\)/);
 for(const source of [manager,packageDialog,
  read('src/components/ui/alert-dialog.jsx'),
  read('src/components/ui/popover.jsx'),
  read('src/components/ui/dropdown-menu.jsx')]){
  assert.doesNotMatch(source,/onWheel(Capture)?=|onTouchMove(Capture)?=|addEventListener\(['"](?:wheel|touchmove)/);
  assert.doesNotMatch(source,/document\.body\.style\.overflow/);
 }
 assert.doesNotMatch(dialog,/document\.body\.style\.overflow|document\.addEventListener\(['"](?:wheel|touchmove)/);
});
