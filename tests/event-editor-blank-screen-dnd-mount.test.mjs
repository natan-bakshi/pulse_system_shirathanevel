import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('empty event editor avoids mounting drag-and-drop document-head styles before items exist',()=>{
 const form=fs.readFileSync('src/components/events/EventForm.jsx','utf8');
 const services=fs.readFileSync('src/components/events/EventServicesManager.jsx','utf8');
 assert.match(form,/\{formData\.schedule\.length>0&&<DragDropContext onDragEnd=\{handleDragEnd\}>/);
 assert.match(services,/\{\(groupedServices\.packages\.length>0\|\|groupedServices\.standalone\.length>0\)&&\s*<DragDropContext/);
 assert.match(form,/onClick=\{addScheduleItem\}/);
 assert.match(services,/handleDragEnd/);
 assert.match(form,/<EventServicesManager/);
});
test('event create/edit form render errors are isolated without writing a new event',()=>{
 const management=fs.readFileSync('src/pages/EventManagement.jsx','utf8');
 const boundary=fs.readFileSync('src/components/events/EventFormErrorBoundary.jsx','utf8');
 assert.match(management,/isFormOpen && \(/);
 assert.match(management,/<EventFormErrorBoundary/);
 assert.match(boundary,/getDerivedStateFromError/);
 assert.match(boundary,/componentDidCatch/);
 assert.match(boundary,/role="alert"/);
 assert.doesNotMatch(boundary,/Event\.create|Event\.update|WhatsApp|send|charge/i);
});
